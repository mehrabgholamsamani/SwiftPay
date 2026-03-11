import type { Pool } from 'pg';
export const migrateRefunds = async (pool: Pool): Promise<void> => {
  await pool.query(
    'alter table payments add column if not exists refunded_minor bigint not null default 0',
  );
};
