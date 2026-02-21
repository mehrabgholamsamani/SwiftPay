import './tracing';
import 'reflect-metadata';
import {
  Body,
  Controller,
  Get,
  Module,
  Param,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { validateConfig } from '@corebank/config';
import { correlation, correlationIdFrom } from '@corebank/correlation';
import { logger } from '@corebank/logging';
import type { NextFunction, Request, Response } from 'express';
import { ledgerDataSource } from './data-source';
import { LedgerService, type Posting } from './ledger.service';
import { publishLedgerOutbox } from './outbox-publisher';
import { startLedgerPaymentConsumer } from './payment-messaging';
const service = 'ledger-service';
const config = validateConfig(process.env);
const log = logger.child({ service });
@Controller()
class LedgerController {
  constructor(private readonly ledger: LedgerService) {}
  @Post('ledger/accounts') account(@Body() b: { ownerId?: string; currency?: string }) {
    return this.ledger.createAccount(b.ownerId ?? '', b.currency ?? '');
  }
  @Post('ledger/transactions') post(@Body() b: { idempotencyKey?: string; postings?: Posting[] }) {
    return this.ledger.post(b.idempotencyKey ?? '', b.postings ?? []);
  }
  @Post('ledger/test-funding') fund(
    @Body()
    b: {
      customerAccountId?: string;
      fundingAccountId?: string;
      amountMinor?: string;
      currency?: string;
      idempotencyKey?: string;
    },
  ) {
    return this.ledger.post(b.idempotencyKey ?? '', [
      {
        accountId: b.fundingAccountId ?? '',
        side: 'DEBIT',
        amountMinor: b.amountMinor ?? '',
        currency: b.currency ?? '',
      },
      {
        accountId: b.customerAccountId ?? '',
        side: 'CREDIT',
        amountMinor: b.amountMinor ?? '',
        currency: b.currency ?? '',
      },
    ]);
  }
  @Post('ledger/transactions/:id/reverse') reverse(
    @Param('id') id: string,
    @Body() b: { idempotencyKey?: string },
  ) {
    return this.ledger.reverse(id, b.idempotencyKey ?? '');
  }
  @Get('ledger/accounts/:id/balance') balance(@Param('id') id: string) {
    return this.ledger.balance(id);
  }
  @Get('ledger/accounts/:id/entries') history(@Param('id') id: string) {
    return this.ledger.history(id);
  }
  @Post('ledger/reservations') reserve(
    @Body()
    b: {
      accountId?: string;
      amountMinor?: string;
      currency?: string;
      idempotencyKey?: string;
      paymentId?: string;
    },
  ) {
    return this.ledger.reserve(
      b.accountId ?? '',
      b.amountMinor ?? '',
      b.currency ?? '',
      b.idempotencyKey ?? '',
      b.paymentId,
    );
  }
  @Post('ledger/reservations/:id/release') release(
    @Param('id') id: string,
    @Body() b: { idempotencyKey?: string },
  ) {
    return this.ledger.releaseReservation(id, b.idempotencyKey ?? '');
  }
  @Post('ledger/internal-transfers') transfer(
    @Body()
    b: {
      reservationId?: string;
      sourceAccountId?: string;
      destinationAccountId?: string;
      amountMinor?: string;
      currency?: string;
      idempotencyKey?: string;
    },
  ) {
    return this.ledger.internalTransfer(
      b.reservationId ?? '',
      b.sourceAccountId ?? '',
      b.destinationAccountId ?? '',
      b.amountMinor ?? '',
      b.currency ?? '',
      b.idempotencyKey ?? '',
    );
  }
  @Get('health') health() {
    return { status: 'ok', service };
  }
  @Get('metrics') metrics() {
    return 'corebank_service_up{service="ledger-service"} 1\n';
  }
  @Get('ready') async ready() {
    try {
      await ledgerDataSource.query('select 1');
      return { status: 'ready', service };
    } catch {
      throw new ServiceUnavailableException({ status: 'not_ready', service });
    }
  }
}
@Module({ controllers: [LedgerController], providers: [LedgerService] })
class AppModule {}
async function bootstrap() {
  await ledgerDataSource.initialize();
  await ledgerDataSource.runMigrations();
  const app = await NestFactory.create(AppModule);
  app.use((r: Request, s: Response, n: NextFunction) => {
    const correlationId = correlationIdFrom(r.headers['x-correlation-id']);
    s.setHeader('x-correlation-id', correlationId);
    correlation.run({ correlationId }, n);
  });
  await startLedgerPaymentConsumer(app.get(LedgerService));
  setInterval(() => void publishLedgerOutbox().catch(() => undefined), 1000);
  await app.listen(config.PORT);
  log.info({ port: config.PORT }, 'service started');
}
void bootstrap();
