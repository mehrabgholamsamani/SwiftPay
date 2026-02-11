import type { MigrationInterface, QueryRunner } from 'typeorm';
export class InitialIdentity1710000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `create table if not exists users (id uuid primary key, email text not null unique, password_hash text not null, role text not null check(role in ('CUSTOMER','ADMIN')), audit jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()); create table if not exists refresh_tokens (id uuid primary key, token_hash text unique, user_id uuid not null references users(id), expires_at timestamptz not null, revoked_at timestamptz, audit jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()); create table if not exists outbox_messages (id uuid primary key, topic text not null, message jsonb not null, published_at timestamptz, created_at timestamptz not null default now()); alter table users add column if not exists audit jsonb not null default '{}'::jsonb; alter table refresh_tokens add column if not exists token_hash text; alter table refresh_tokens add column if not exists audit jsonb not null default '{}'::jsonb; alter table outbox_messages add column if not exists topic text; alter table outbox_messages add column if not exists message jsonb; alter table outbox_messages add column if not exists published_at timestamptz;`,
    );
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'drop table outbox_messages; drop table refresh_tokens; drop table users;',
    );
  }
}
