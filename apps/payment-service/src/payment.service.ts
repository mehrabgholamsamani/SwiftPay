import { HttpException, Injectable } from '@nestjs/common';
import { correlation } from '@corebank/correlation';
import {
  messageEnvelope,
  type LedgerFundsReservedV1,
  type LedgerInternalTransferPostedV1,
  type MessageEnvelope,
  type PaymentCreatedV1,
  type PaymentStatus,
  type RailScenario,
} from '@corebank/event-contracts';
import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { paymentPool } from './data-source';

type CreatePayment = {
  sourceLedgerAccountId?: string;
  destinationLedgerAccountId?: string;
  amountMinor?: string;
  currency?: 'EUR' | 'USD' | 'SEK';
  idempotencyKey?: string;
  kind?: 'INTERNAL_TRANSFER' | 'RAIL_TRANSFER';
  railScenario?: RailScenario;
};
const allowed: Record<PaymentStatus, PaymentStatus[]> = {
  CREATED: ['VALIDATING', 'CANCELLED', 'FAILED'],
  VALIDATING: ['RESERVING_FUNDS', 'REJECTED', 'FAILED'],
  RESERVING_FUNDS: ['AUTHORIZED', 'REJECTED', 'FAILED'],
  AUTHORIZED: ['SUBMITTED', 'CANCELLED', 'FAILED'],
  SUBMITTED: ['ACCEPTED', 'SETTLED', 'REJECTED', 'FAILED'],
  ACCEPTED: ['SETTLED', 'FAILED'],
  SETTLED: ['PARTIALLY_REFUNDED', 'REFUNDED', 'REVERSED'],
  REJECTED: [],
  CANCELLED: [],
  FAILED: [],
  PARTIALLY_REFUNDED: ['REFUNDED'],
  REFUNDED: [],
  REVERSED: [],
};
const valid = (body: CreatePayment): body is Required<CreatePayment> =>
  !!body.sourceLedgerAccountId &&
  !!body.destinationLedgerAccountId &&
  body.sourceLedgerAccountId !== body.destinationLedgerAccountId &&
  !!body.idempotencyKey &&
  /^[1-9]\d*$/.test(body.amountMinor ?? '') &&
  ['EUR', 'USD', 'SEK'].includes(body.currency ?? '') &&
  (!body.kind || ['INTERNAL_TRANSFER', 'RAIL_TRANSFER'].includes(body.kind));

@Injectable()
export class PaymentService {
  private readonly pool: Pool = paymentPool;
  private envelope<T>(type: string, aggregateId: string, payload: T): MessageEnvelope<T> {
    return messageEnvelope(
      {
        messageId: randomUUID(),
        messageType: type,
        messageVersion: 1,
        aggregateId,
        correlationId: correlation.get()?.correlationId ?? randomUUID(),
        producer: 'payment-service',
        occurredAt: new Date().toISOString(),
      },
      payload,
    );
  }
  private async outbox(client: PoolClient, topic: string, message: MessageEnvelope<unknown>) {
    await client.query(
      'insert into payment_outbox_messages(id,topic,message) values($1,$2,$3::jsonb)',
      [message.messageId, topic, JSON.stringify(message)],
    );
  }
  async create(body: CreatePayment, audit: Record<string, unknown>) {
    if (!valid(body)) throw new HttpException('invalid payment request', 400);
    const hash = createHash('sha256')
      .update(JSON.stringify({ ...body, idempotencyKey: undefined }))
      .digest('hex');
    const client = await this.pool.connect();
    await client.query('begin');
    try {
      const existing = (
        await client.query('select * from payments where idempotency_key=$1 for update', [
          body.idempotencyKey,
        ])
      ).rows[0];
      if (existing) {
        if (existing.request_hash !== hash) throw new HttpException('idempotency conflict', 409);
        await client.query('commit');
        return this.view(existing);
      }
      const id = randomUUID();
      const kind = body.kind ?? 'INTERNAL_TRANSFER';
      await client.query(
        "insert into payments(id,idempotency_key,request_hash,source_ledger_account_id,destination_ledger_account_id,amount_minor,currency,kind,status,audit,rail_scenario) values($1,$2,$3,$4::uuid,$5::uuid,$6::bigint,$7,$8,'RESERVING_FUNDS',$9::jsonb,$10)",
        [
          id,
          body.idempotencyKey,
          hash,
          body.sourceLedgerAccountId,
          body.destinationLedgerAccountId,
          body.amountMinor,
          body.currency,
          kind,
          JSON.stringify(audit),
          body.railScenario ?? 'SUCCESS',
        ],
      );
      const created: PaymentCreatedV1 = {
        paymentId: id,
        sourceLedgerAccountId: body.sourceLedgerAccountId,
        destinationLedgerAccountId: body.destinationLedgerAccountId,
        amountMinor: body.amountMinor,
        currency: body.currency,
        kind,
      };
      await this.outbox(
        client,
        'payment.created.v1',
        this.envelope('payment.created.v1', id, created),
      );
      await this.outbox(
        client,
        'ledger.reserve-funds.v1',
        this.envelope('ledger.reserve-funds.v1', id, {
          paymentId: id,
          sourceLedgerAccountId: body.sourceLedgerAccountId,
          amountMinor: body.amountMinor,
          currency: body.currency,
          idempotencyKey: `payment:${id}:reserve`,
        }),
      );
      await client.query('commit');
      return { id, status: 'RESERVING_FUNDS', ...created };
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
  }
  private view(row: Record<string, unknown>) {
    return {
      id: row.id,
      status: row.status,
      sourceLedgerAccountId: row.source_ledger_account_id,
      destinationLedgerAccountId: row.destination_ledger_account_id,
      amountMinor: String(row.amount_minor),
      currency: row.currency,
      reservationId: row.reservation_id,
      ledgerTransactionId: row.ledger_transaction_id,
      failureReason: row.failure_reason,
    };
  }
  async get(id: string) {
    const row = (await this.pool.query('select * from payments where id=$1::uuid', [id])).rows[0];
    if (!row) throw new HttpException('payment not found', 404);
    return this.view(row);
  }
  async fundsReserved(event: MessageEnvelope<LedgerFundsReservedV1>) {
    await this.consume(event, async (c) => {
      const p = (
        await c.query('select * from payments where id=$1::uuid for update', [
          event.payload.paymentId,
        ])
      ).rows[0];
      if (!p || p.status !== 'RESERVING_FUNDS') return;
      if (p.kind === 'RAIL_TRANSFER') {
        await c.query(
          "update payments set status='SUBMITTED',reservation_id=$1::uuid,updated_at=now() where id=$2::uuid",
          [event.payload.reservationId, p.id],
        );
        await this.outbox(
          c,
          'rail.submit-payment.v1',
          this.envelope('rail.submit-payment.v1', p.id, {
            paymentId: p.id,
            amountMinor: String(p.amount_minor),
            currency: p.currency,
            scenario: p.rail_scenario ?? 'SUCCESS',
          }),
        );
        return;
      }
      await c.query(
        "update payments set status='AUTHORIZED',reservation_id=$1::uuid,updated_at=now() where id=$2::uuid",
        [event.payload.reservationId, p.id],
      );
      await this.outbox(
        c,
        'ledger.post-internal-transfer.v1',
        this.envelope('ledger.post-internal-transfer.v1', p.id, {
          paymentId: p.id,
          reservationId: event.payload.reservationId,
          sourceLedgerAccountId: p.source_ledger_account_id,
          destinationLedgerAccountId: p.destination_ledger_account_id,
          amountMinor: String(p.amount_minor),
          currency: p.currency,
          idempotencyKey: `payment:${p.id}:post`,
        }),
      );
    });
  }
  async transferPosted(event: MessageEnvelope<LedgerInternalTransferPostedV1>) {
    await this.consume(event, async (c) => {
      const p = (
        await c.query('select * from payments where id=$1::uuid for update', [
          event.payload.paymentId,
        ])
      ).rows[0];
      if (!p || !allowed[p.status as PaymentStatus].includes('SETTLED')) return;
      await c.query(
        "update payments set status='SETTLED',ledger_transaction_id=$1::uuid,updated_at=now() where id=$2::uuid",
        [event.payload.transactionId, p.id],
      );
    });
  }
  async reservationRejected(event: MessageEnvelope<{ paymentId: string; reason: string }>) {
    await this.consume(event, async (c) => {
      await c.query(
        "update payments set status='REJECTED',failure_reason=$1,updated_at=now() where id=$2::uuid and status='RESERVING_FUNDS'",
        [event.payload.reason, event.payload.paymentId],
      );
    });
  }
  async railAccepted(event: MessageEnvelope<{ paymentId: string; railReference: string }>) {
    await this.consume(event, async (c) => {
      await c.query(
        "update payments set status='ACCEPTED',rail_reference=$1,updated_at=now() where id=$2::uuid and status='SUBMITTED'",
        [event.payload.railReference, event.payload.paymentId],
      );
    });
  }
  async railSettled(event: MessageEnvelope<{ paymentId: string }>) {
    await this.consume(event, async (c) => {
      const p = (
        await c.query('select * from payments where id=$1::uuid for update', [
          event.payload.paymentId,
        ])
      ).rows[0];
      if (!p || !['SUBMITTED', 'ACCEPTED'].includes(p.status)) return;
      await c.query("update payments set status='ACCEPTED',updated_at=now() where id=$1::uuid", [
        p.id,
      ]);
      await this.outbox(
        c,
        'ledger.post-internal-transfer.v1',
        this.envelope('ledger.post-internal-transfer.v1', p.id, {
          paymentId: p.id,
          reservationId: p.reservation_id,
          sourceLedgerAccountId: p.source_ledger_account_id,
          destinationLedgerAccountId: p.destination_ledger_account_id,
          amountMinor: String(p.amount_minor),
          currency: p.currency,
          idempotencyKey: `payment:${p.id}:settle`,
        }),
      );
    });
  }
  async railFailed(
    event: MessageEnvelope<{ paymentId: string; reason?: string }>,
    status: 'REJECTED' | 'FAILED',
  ) {
    await this.consume(event, async (c) => {
      const p = (
        await c.query('select * from payments where id=$1::uuid for update', [
          event.payload.paymentId,
        ])
      ).rows[0];
      if (!p || !['SUBMITTED', 'ACCEPTED'].includes(p.status)) return;
      await c.query(
        'update payments set status=$1,failure_reason=$2,updated_at=now() where id=$3::uuid',
        [status, event.payload.reason ?? 'rail timeout', p.id],
      );
      if (p.reservation_id)
        await this.outbox(
          c,
          'ledger.release-funds.v1',
          this.envelope('ledger.release-funds.v1', p.id, {
            paymentId: p.id,
            reservationId: p.reservation_id,
            idempotencyKey: `payment:${p.id}:release`,
          }),
        );
    });
  }
  async railTemporarilyFailed(event: MessageEnvelope<{ paymentId: string }>) {
    await this.consume(event, async () => undefined);
  }
  async cancel(id: string) {
    const c = await this.pool.connect();
    await c.query('begin');
    try {
      const p = (await c.query('select * from payments where id=$1::uuid for update', [id]))
        .rows[0];
      if (!p) throw new HttpException('payment not found', 404);
      if (!['RESERVING_FUNDS', 'AUTHORIZED', 'SUBMITTED'].includes(p.status))
        throw new HttpException('payment cannot be cancelled', 409);
      await c.query("update payments set status='CANCELLED',updated_at=now() where id=$1::uuid", [
        id,
      ]);
      if (p.reservation_id)
        await this.outbox(
          c,
          'ledger.release-funds.v1',
          this.envelope('ledger.release-funds.v1', id, {
            paymentId: id,
            reservationId: p.reservation_id,
            idempotencyKey: `payment:${id}:cancel`,
          }),
        );
      await c.query('commit');
      return { id, status: 'CANCELLED' };
    } catch (e) {
      await c.query('rollback');
      throw e;
    } finally {
      c.release();
    }
  }
  async refund(id: string, amountMinor: string, idempotencyKey: string) {
    if (!/^[1-9]\d*$/.test(amountMinor) || !idempotencyKey)
      throw new HttpException('valid amount and idempotency key required', 400);
    return this.adjust(id, amountMinor, idempotencyKey, 'REFUND');
  }
  async reverse(id: string, idempotencyKey: string) {
    if (!idempotencyKey) throw new HttpException('idempotency key required', 400);
    const p = (await this.get(id)) as { amountMinor: string };
    return this.adjust(id, p.amountMinor, idempotencyKey, 'REVERSAL');
  }
  private async adjust(
    id: string,
    amountMinor: string,
    idempotencyKey: string,
    action: 'REFUND' | 'REVERSAL',
  ) {
    const c = await this.pool.connect();
    await c.query('begin');
    try {
      const p = (await c.query('select * from payments where id=$1::uuid for update', [id]))
        .rows[0];
      if (
        !p ||
        (action === 'REFUND'
          ? !['SETTLED', 'PARTIALLY_REFUNDED'].includes(p.status)
          : p.status !== 'SETTLED')
      )
        throw new HttpException('only settled payments can be adjusted', 409);
      const hash = createHash('sha256')
        .update(JSON.stringify({ id, amountMinor, action }))
        .digest('hex');
      const existing = (
        await c.query('select * from payment_adjustments where idempotency_key=$1 for update', [
          idempotencyKey,
        ])
      ).rows[0];
      if (existing) {
        if (existing.request_hash !== hash) throw new HttpException('idempotency conflict', 409);
        await c.query('commit');
        return { id, status: existing.status };
      }
      const pending = (
        await c.query(
          "select coalesce(sum(amount_minor),0)::text as amount from payment_adjustments where payment_id=$1::uuid and status='PENDING'",
          [id],
        )
      ).rows[0].amount;
      if (BigInt(p.refunded_minor) + BigInt(pending) + BigInt(amountMinor) > BigInt(p.amount_minor))
        throw new HttpException('refund exceeds settled amount', 409);
      const adjustmentId = randomUUID();
      await c.query(
        'insert into payment_adjustments(id,payment_id,idempotency_key,request_hash,amount_minor,action) values($1,$2::uuid,$3,$4,$5::bigint,$6)',
        [adjustmentId, id, idempotencyKey, hash, amountMinor, action],
      );
      await this.outbox(
        c,
        'ledger.post-adjustment.v1',
        this.envelope('ledger.post-adjustment.v1', id, {
          adjustmentId,
          paymentId: id,
          originalTransactionId: p.ledger_transaction_id,
          sourceLedgerAccountId: p.source_ledger_account_id,
          destinationLedgerAccountId: p.destination_ledger_account_id,
          amountMinor,
          currency: p.currency,
          action,
          idempotencyKey,
        }),
      );
      await c.query('commit');
      return { id, status: 'ADJUSTMENT_PENDING' };
    } catch (e) {
      await c.query('rollback');
      throw e;
    } finally {
      c.release();
    }
  }
  async adjustmentPosted(
    event: MessageEnvelope<{
      adjustmentId: string;
      paymentId: string;
      amountMinor: string;
      action: 'REFUND' | 'REVERSAL';
    }>,
  ) {
    await this.consume(event, async (c) => {
      const p = (
        await c.query('select * from payments where id=$1::uuid for update', [
          event.payload.paymentId,
        ])
      ).rows[0];
      if (!p || !['SETTLED', 'PARTIALLY_REFUNDED'].includes(p.status)) return;
      const adjustment = (
        await c.query(
          "update payment_adjustments set status='POSTED' where id=$1::uuid and status='PENDING' returning id",
          [event.payload.adjustmentId],
        )
      ).rows[0];
      if (!adjustment) return;
      const refunded = (
        await c.query(
          "select coalesce(sum(amount_minor),0)::text as amount from payment_adjustments where payment_id=$1::uuid and status='POSTED'",
          [p.id],
        )
      ).rows[0].amount;
      const status =
        event.payload.action === 'REVERSAL'
          ? 'REVERSED'
          : BigInt(refunded) === BigInt(p.amount_minor)
            ? 'REFUNDED'
            : 'PARTIALLY_REFUNDED';
      await c.query(
        'update payments set status=$1,refunded_minor=$2::bigint,updated_at=now() where id=$3::uuid',
        [status, refunded, p.id],
      );
    });
  }
  private async consume(
    event: MessageEnvelope<unknown>,
    operation: (c: PoolClient) => Promise<void>,
  ) {
    const c = await this.pool.connect();
    await c.query('begin');
    try {
      const inserted = await c.query(
        'insert into payment_inbox_messages(message_id) values($1::uuid) on conflict do nothing returning message_id',
        [event.messageId],
      );
      if (inserted.rowCount) await operation(c);
      await c.query('commit');
    } catch (e) {
      await c.query('rollback');
      throw e;
    } finally {
      c.release();
    }
  }
}
