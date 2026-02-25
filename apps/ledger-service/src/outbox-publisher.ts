import { Kafka } from 'kafkajs';
import { ledgerDataSource } from './data-source';

export const publishLedgerOutbox = async (): Promise<void> => {
  const rows = await ledgerDataSource.query(
    'select id,message_type,payload from outbox_messages where published_at is null order by created_at limit 50',
  );
  if (!rows.length) return;
  const producer = new Kafka({ brokers: (process.env.KAFKA_BROKERS ?? '').split(',') }).producer();
  await producer.connect();
  try {
    for (const row of rows) {
      await producer.send({
        topic: row.message_type,
        messages: [{ value: JSON.stringify(row.payload) }],
      });
      await ledgerDataSource.query(
        'update outbox_messages set published_at=now() where id=$1::uuid',
        [row.id],
      );
    }
  } finally {
    await producer.disconnect();
  }
};
