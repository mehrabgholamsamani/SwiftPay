import './tracing';
import 'reflect-metadata';
import {
  Body,
  Controller,
  Get,
  Header,
  HttpException,
  Module,
  Param,
  Post,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { validateConfig } from '@corebank/config';
import { correlation, correlationIdFrom } from '@corebank/correlation';
import { createHash, randomUUID } from 'node:crypto';
import { Kafka } from 'kafkajs';
import type { MessageEnvelope, RailSettlementFileGeneratedV1 } from '@corebank/event-contracts';
import { Pool } from 'pg';
import type { NextFunction, Request, Response } from 'express';
import { migrateReconciliation } from './migrations/1710000000015-reconciliation';
import { logger } from '@corebank/logging';

const service = 'reconciliation-service';
const config = validateConfig(process.env);
const pool = new Pool({ connectionString: config.DATABASE_URL });
const log = logger.child({ service });
let requestCount = 0;
let errorCount = 0;
type SettlementRow = {
  externalReference?: string;
  expectedMinor?: string;
  actualMinor?: string;
  currency?: string;
};
const validAmount = (value: string | undefined) => value === undefined || /^-?\d+$/.test(value);
async function startSettlementConsumer() {
  const consumer = new Kafka({ brokers: config.KAFKA_BROKERS.split(',') }).consumer({
    groupId: 'reconciliation-service-stage6',
  });
  await consumer.connect();
  await consumer.subscribe({ topic: 'rail.settlement-file-generated.v1', fromBeginning: false });
  await consumer.run({
    eachMessage: async ({ message }) => {
      if (!message.value) return;
      const event = JSON.parse(
        message.value.toString(),
      ) as MessageEnvelope<RailSettlementFileGeneratedV1>;
      const c = await pool.connect();
      await c.query('begin');
      try {
        const inserted = await c.query(
          'insert into reconciliation_inbox(message_id) values($1::uuid) on conflict do nothing returning message_id',
          [event.messageId],
        );
        if (inserted.rowCount) {
          const checksum = createHash('sha256')
            .update(JSON.stringify(event.payload.rows))
            .digest('hex');
          await c.query(
            'insert into settlement_files(id,source,checksum,rows) values($1,$2,$3,$4::jsonb) on conflict(checksum) do nothing',
            [
              randomUUID(),
              event.payload.fileReference,
              checksum,
              JSON.stringify(event.payload.rows),
            ],
          );
        }
        await c.query('commit');
      } catch (error) {
        await c.query('rollback');
        throw error;
      } finally {
        c.release();
      }
    },
  });
}
@Controller()
class ReconciliationController {
  @Post('reconciliation/files') async importFile(
    @Body() body: { source?: string; rows?: SettlementRow[] },
  ) {
    if (
      !body.source?.trim() ||
      !Array.isArray(body.rows) ||
      body.rows.some(
        (r) =>
          !r.externalReference ||
          !validAmount(r.expectedMinor) ||
          !validAmount(r.actualMinor) ||
          !['EUR', 'USD', 'SEK'].includes(r.currency ?? ''),
      )
    )
      throw new HttpException('invalid settlement file', 400);
    const checksum = createHash('sha256').update(JSON.stringify(body.rows)).digest('hex');
    const id = randomUUID();
    try {
      await pool.query(
        'insert into settlement_files(id,source,checksum,rows) values($1,$2,$3,$4::jsonb)',
        [id, body.source.trim(), checksum, JSON.stringify(body.rows)],
      );
    } catch {
      throw new HttpException('settlement file already imported', 409);
    }
    return { id, checksum, rowCount: body.rows.length };
  }
  @Post('reconciliation/files/:id/runs') async run(@Param('id') fileId: string) {
    const file = (await pool.query('select rows from settlement_files where id=$1::uuid', [fileId]))
      .rows[0];
    if (!file) throw new HttpException('settlement file not found', 404);
    const id = randomUUID();
    const rows = file.rows as SettlementRow[];
    await pool.query(
      "insert into reconciliation_runs(id,settlement_file_id,status,completed_at) values($1,$2::uuid,'COMPLETED',now())",
      [id, fileId],
    );
    const discrepancies = rows
      .filter(
        (r) =>
          r.expectedMinor === undefined ||
          r.actualMinor === undefined ||
          r.expectedMinor !== r.actualMinor,
      )
      .map((r) => ({
        id: randomUUID(),
        kind:
          r.expectedMinor === undefined
            ? 'MISSING_EXPECTED'
            : r.actualMinor === undefined
              ? 'MISSING_ACTUAL'
              : 'AMOUNT_MISMATCH',
        externalReference: r.externalReference ?? '',
        expectedMinor: r.expectedMinor ?? null,
        actualMinor: r.actualMinor ?? null,
        currency: r.currency,
      }));
    for (const d of discrepancies)
      await pool.query(
        'insert into discrepancies(id,run_id,external_reference,expected_minor,actual_minor,currency,kind) values($1,$2::uuid,$3,$4::bigint,$5::bigint,$6,$7)',
        [d.id, id, d.externalReference, d.expectedMinor, d.actualMinor, d.currency, d.kind],
      );
    return { id, status: 'COMPLETED', discrepancyCount: discrepancies.length };
  }
  @Get('reconciliation/runs/:id/discrepancies') async discrepancies(@Param('id') id: string) {
    return (
      await pool.query(
        'select id,external_reference as "externalReference",expected_minor::text as "expectedMinor",actual_minor::text as "actualMinor",currency,kind,status,resolution,created_at as "createdAt",resolved_at as "resolvedAt" from discrepancies where run_id=$1::uuid order by created_at',
        [id],
      )
    ).rows;
  }
  @Post('reconciliation/discrepancies/:id/resolve') async resolve(
    @Param('id') id: string,
    @Body() body: { resolution?: string },
    @Req() req: Request,
  ) {
    if (!body.resolution?.trim() || body.resolution.length > 500)
      throw new HttpException('resolution is required', 400);
    const c = await pool.connect();
    await c.query('begin');
    try {
      const row = (await c.query('select * from discrepancies where id=$1::uuid for update', [id]))
        .rows[0];
      if (!row) throw new HttpException('discrepancy not found', 404);
      if (row.status !== 'OPEN') throw new HttpException('discrepancy already resolved', 409);
      const correlationId = correlation.get()?.correlationId ?? randomUUID();
      const actorId = req.headers['x-actor-id']?.toString() ?? 'operator';
      const details = { resolution: body.resolution.trim() };
      await c.query(
        "update discrepancies set status='RESOLVED',resolution=$1::jsonb,resolved_at=now() where id=$2::uuid",
        [JSON.stringify(details), id],
      );
      await c.query(
        'insert into reconciliation_audit(id,discrepancy_id,action,actor_id,correlation_id,details) values($1,$2::uuid,$3,$4,$5,$6::jsonb)',
        [randomUUID(), id, 'RESOLVED', actorId, correlationId, JSON.stringify(details)],
      );
      await c.query('commit');
      return { id, status: 'RESOLVED' };
    } catch (e) {
      await c.query('rollback');
      throw e;
    } finally {
      c.release();
    }
  }
  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  metrics() {
    return `corebank_reconciliation_service_up 1\ncorebank_http_requests_total{service="reconciliation-service"} ${requestCount}\ncorebank_http_errors_total{service="reconciliation-service"} ${errorCount}\n`;
  }
  @Get('health') health() {
    return { status: 'ok', service };
  }
  @Get('ready') async ready() {
    try {
      await pool.query('select 1');
      return { status: 'ready', service };
    } catch {
      throw new ServiceUnavailableException({ status: 'not_ready', service });
    }
  }
}
@Module({ controllers: [ReconciliationController] })
class AppModule {}
async function bootstrap() {
  await migrateReconciliation(pool);
  const app = await NestFactory.create(AppModule);
  app.use((r: Request, s: Response, n: NextFunction) => {
    const id = correlationIdFrom(r.headers['x-correlation-id']);
    s.setHeader('x-correlation-id', id);
    correlation.run({ correlationId: id }, n);
  });
  app.use((r: Request, s: Response, n: NextFunction) => {
    const started = Date.now();
    s.on('finish', () => {
      requestCount += 1;
      if (s.statusCode >= 400) errorCount += 1;
      log.info(
        {
          correlationId: correlation.get()?.correlationId,
          method: r.method,
          path: r.path,
          statusCode: s.statusCode,
          durationMs: Date.now() - started,
        },
        'http request completed',
      );
    });
    n();
  });
  app.enableShutdownHooks();
  await startSettlementConsumer();
  await app.listen(config.PORT);
}
void bootstrap();
