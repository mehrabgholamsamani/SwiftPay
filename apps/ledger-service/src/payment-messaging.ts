import { correlation } from '@corebank/correlation';
import {
  messageEnvelope,
  type LedgerPostInternalTransferV1,
  type LedgerPostAdjustmentV1,
  type LedgerReleaseFundsV1,
  type LedgerReserveFundsV1,
  type MessageEnvelope,
} from '@corebank/event-contracts';
import { Kafka } from 'kafkajs';
import { randomUUID } from 'node:crypto';
import { ledgerDataSource } from './data-source';
import { LedgerService } from './ledger.service';

const brokers = () => (process.env.KAFKA_BROKERS ?? '').split(',').filter(Boolean);
const publishEvent = async (
  type: string,
  aggregateId: string,
  correlationId: string,
  payload: unknown,
) => {
  const event = messageEnvelope(
    {
      messageId: randomUUID(),
      messageType: type,
      messageVersion: 1,
      aggregateId,
      correlationId,
      producer: 'ledger-service',
      occurredAt: new Date().toISOString(),
    },
    payload,
  );
  await ledgerDataSource.query(
    'insert into outbox_messages(id,message_type,payload) values($1,$2,$3::jsonb)',
    [event.messageId, type, JSON.stringify(event)],
  );
};

/** Thin Kafka adapter; ledger invariants remain in LedgerService and account locks. */
export const startLedgerPaymentConsumer = async (ledger: LedgerService): Promise<void> => {
  if (!brokers().length) return;
  const consumer = new Kafka({ brokers: brokers() }).consumer({ groupId: 'ledger-service-stage4' });
  await consumer.connect();
  await consumer.subscribe({
    topics: [
      'ledger.reserve-funds.v1',
      'ledger.post-internal-transfer.v1',
      'ledger.release-funds.v1',
      'ledger.post-adjustment.v1',
    ],
    fromBeginning: false,
  });
  await consumer.run({
    eachMessage: async ({ message, topic }) => {
      if (!message.value) return;
      const command = JSON.parse(message.value.toString()) as MessageEnvelope<unknown>;
      await correlation.run({ correlationId: command.correlationId }, async () => {
        try {
          if (topic === 'ledger.reserve-funds.v1') {
            const p = command.payload as LedgerReserveFundsV1;
            const reservation = await ledger.reserve(
              p.sourceLedgerAccountId,
              p.amountMinor,
              p.currency,
              p.idempotencyKey,
              p.paymentId,
            );
            await publishEvent('ledger.funds-reserved.v1', p.paymentId, command.correlationId, {
              paymentId: p.paymentId,
              reservationId: reservation.id,
              sourceLedgerAccountId: p.sourceLedgerAccountId,
              amountMinor: p.amountMinor,
              currency: p.currency,
            });
          }
          if (topic === 'ledger.post-internal-transfer.v1') {
            const p = command.payload as LedgerPostInternalTransferV1;
            const posted = await ledger.internalTransfer(
              p.reservationId,
              p.sourceLedgerAccountId,
              p.destinationLedgerAccountId,
              p.amountMinor,
              p.currency,
              p.idempotencyKey,
            );
            await publishEvent(
              'ledger.internal-transfer-posted.v1',
              p.paymentId,
              command.correlationId,
              { paymentId: p.paymentId, transactionId: posted.id, reservationId: p.reservationId },
            );
          }
          if (topic === 'ledger.release-funds.v1') {
            const p = command.payload as LedgerReleaseFundsV1;
            await ledger.releaseReservation(p.reservationId, p.idempotencyKey);
            await publishEvent('ledger.funds-released.v1', p.paymentId, command.correlationId, {
              paymentId: p.paymentId,
              reservationId: p.reservationId,
            });
          }
          if (topic === 'ledger.post-adjustment.v1') {
            const p = command.payload as LedgerPostAdjustmentV1;
            const result =
              p.action === 'REVERSAL'
                ? await ledger.reverse(p.originalTransactionId, p.idempotencyKey)
                : await ledger.post(p.idempotencyKey, [
                    {
                      accountId: p.destinationLedgerAccountId,
                      side: 'DEBIT',
                      amountMinor: p.amountMinor,
                      currency: p.currency,
                    },
                    {
                      accountId: p.sourceLedgerAccountId,
                      side: 'CREDIT',
                      amountMinor: p.amountMinor,
                      currency: p.currency,
                    },
                  ]);
            await publishEvent('ledger.adjustment-posted.v1', p.paymentId, command.correlationId, {
              adjustmentId: p.adjustmentId,
              paymentId: p.paymentId,
              transactionId: result.id,
              amountMinor: p.amountMinor,
              action: p.action,
            });
          }
        } catch (error) {
          const paymentId = (command.payload as { paymentId?: string }).paymentId;
          if (paymentId)
            await publishEvent(
              'ledger.funds-reservation-rejected.v1',
              paymentId,
              command.correlationId,
              {
                paymentId,
                reason: error instanceof Error ? error.message : 'ledger command failed',
              },
            );
        }
      });
    },
  });
};
