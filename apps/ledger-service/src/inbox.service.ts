import { ledgerDataSource } from './data-source';

/** Runs a consumer operation once per message ID in the same local transaction. */
export const processLedgerInbox = async (
  messageId: string,
  operation: () => Promise<void>,
): Promise<boolean> => {
  const runner = ledgerDataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const inserted = await runner.query(
      'insert into inbox_messages(message_id) values($1::uuid) on conflict do nothing returning message_id',
      [messageId],
    );
    if (!inserted.length) {
      await runner.commitTransaction();
      return false;
    }
    await operation();
    await runner.commitTransaction();
    return true;
  } catch (error) {
    await runner.rollbackTransaction();
    throw error;
  } finally {
    await runner.release();
  }
};
