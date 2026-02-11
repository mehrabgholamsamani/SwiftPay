import type { MigrationInterface, QueryRunner } from 'typeorm';
export class IdentityOutboxCompatibility1710000000012 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'alter table outbox_messages add column if not exists message_type text; alter table outbox_messages add column if not exists payload jsonb;',
    );
  }
  async down(): Promise<void> {}
}
