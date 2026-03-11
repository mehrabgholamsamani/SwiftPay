import type { Pool } from 'pg';
export const migrateRailPayments = async (pool: Pool): Promise<void> => {
  await pool.query(`
  alter table payments drop constraint if exists payments_kind_check;
  alter table payments add constraint payments_kind_check check(kind in ('INTERNAL_TRANSFER','RAIL_TRANSFER'));
  alter table payments add column if not exists rail_scenario varchar;
  alter table payments add column if not exists rail_reference varchar;
`);
};
