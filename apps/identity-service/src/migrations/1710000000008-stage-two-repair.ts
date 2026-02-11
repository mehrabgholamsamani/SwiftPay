import type { MigrationInterface, QueryRunner } from 'typeorm';
export class StageTwoIdentityRepair1710000000008 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `alter table users add column if not exists audit jsonb not null default '{}'::jsonb; alter table refresh_tokens add column if not exists token_hash text; alter table refresh_tokens add column if not exists audit jsonb not null default '{}'::jsonb; alter table outbox_messages add column if not exists topic text; alter table outbox_messages add column if not exists message jsonb; alter table outbox_messages add column if not exists message_type text; alter table outbox_messages add column if not exists payload jsonb; alter table outbox_messages add column if not exists published_at timestamptz;`,
    );
  }
  async down(): Promise<void> {}
}
