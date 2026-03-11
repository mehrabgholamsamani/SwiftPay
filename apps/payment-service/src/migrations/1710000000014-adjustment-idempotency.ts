import type { Pool } from 'pg';
export const migrateAdjustmentIdempotency = async (pool: Pool): Promise<void> => {
  await pool.query(`create table if not exists payment_adjustments (
    id uuid primary key, payment_id uuid not null references payments(id), idempotency_key varchar not null unique,
    request_hash varchar not null, amount_minor bigint not null check(amount_minor > 0), action varchar not null check(action in ('REFUND','REVERSAL')),
    status varchar not null default 'PENDING', created_at timestamptz not null default now());`);
};
