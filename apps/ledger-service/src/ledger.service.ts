import { HttpException, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { ledgerDataSource } from './data-source';
export type Posting = {
  accountId: string;
  side: 'DEBIT' | 'CREDIT';
  amountMinor: string;
  currency: string;
};
@Injectable()
export class LedgerService {
  async createAccount(ownerId: string, currency: string) {
    if (!ownerId || !['EUR', 'USD', 'SEK'].includes(currency))
      throw new HttpException('invalid ledger account', 400);
    const id = randomUUID();
    await ledgerDataSource.query(
      "insert into ledger_accounts(id,owner_id,currency,status) values($1,$2::uuid,$3,'ACTIVE')",
      [id, ownerId, currency],
    );
    return { id, ownerId, currency, status: 'ACTIVE' };
  }
  async post(key: string, postings: Posting[]) {
    if (!key || postings.length < 2)
      throw new HttpException('idempotency key and two entries required', 400);
    const hash = createHash('sha256').update(JSON.stringify(postings)).digest('hex');
    const r = ledgerDataSource.createQueryRunner();
    await r.connect();
    await r.startTransaction();
    try {
      const old = (
        await r.query('select * from ledger_transactions where idempotency_key=$1 for update', [
          key,
        ])
      )[0];
      if (old) {
        if (old.request_hash !== hash) throw new HttpException('idempotency conflict', 409);
        await r.commitTransaction();
        return { id: old.id, status: old.status };
      }
      const totals = new Map<string, [bigint, bigint]>();
      for (const p of postings) {
        if (!/^[1-9]\d*$/.test(p.amountMinor) || !['DEBIT', 'CREDIT'].includes(p.side))
          throw new HttpException('invalid posting', 400);
        const t = totals.get(p.currency) ?? [0n, 0n];
        t[p.side === 'DEBIT' ? 0 : 1] += BigInt(p.amountMinor);
        totals.set(p.currency, t);
      }
      for (const [d, c] of totals.values())
        if (d !== c) throw new HttpException('unbalanced entries', 400);
      const ids = [...new Set(postings.map((p) => p.accountId))];
      const accounts = await r.query(
        'select * from ledger_accounts where id=any($1::uuid[]) for update',
        [ids],
      );
      if (accounts.length !== ids.length) throw new HttpException('ledger account not found', 404);
      for (const p of postings) {
        const a = accounts.find((x: { id: string }) => x.id === p.accountId);
        if (!a || a.status !== 'ACTIVE' || a.currency !== p.currency)
          throw new HttpException('invalid ledger account', 400);
      }
      const id = randomUUID();
      await r.query(
        "insert into ledger_transactions(id,idempotency_key,request_hash,status) values($1,$2,$3,'POSTED')",
        [id, key, hash],
      );
      for (const p of postings)
        await r.query(
          'insert into ledger_entries(id,transaction_id,ledger_account_id,side,amount_minor,currency) values($1,$2,$3::uuid,$4,$5::bigint,$6)',
          [randomUUID(), id, p.accountId, p.side, p.amountMinor, p.currency],
        );
      await r.query(
        'insert into outbox_messages(id,message_type,payload) values($1,$2,$3::jsonb)',
        [randomUUID(), 'ledger.transaction-posted.v1', JSON.stringify({ transactionId: id })],
      );
      await r.commitTransaction();
      return { id, status: 'POSTED' };
    } catch (e) {
      await r.rollbackTransaction();
      throw e;
    } finally {
      await r.release();
    }
  }
  async reverse(id: string, key: string) {
    const rows = await ledgerDataSource.query(
      'select ledger_account_id as "accountId",side,amount_minor as "amountMinor",currency from ledger_entries where transaction_id=$1::uuid',
      [id],
    );
    if (!rows.length) throw new HttpException('transaction not found', 404);
    const tx = await this.post(
      key,
      rows.map((e: Posting) => ({
        ...e,
        side: e.side === 'DEBIT' ? 'CREDIT' : 'DEBIT',
        amountMinor: String(e.amountMinor),
      })),
    );
    await ledgerDataSource.query(
      'update ledger_transactions set reversal_of=$1::uuid where id=$2::uuid',
      [id, tx.id],
    );
    return tx;
  }
  async balance(id: string) {
    const a = (
      await ledgerDataSource.query('select id,currency from ledger_accounts where id=$1::uuid', [
        id,
      ])
    )[0];
    if (!a) throw new HttpException('ledger account not found', 404);
    const r = (
      await ledgerDataSource.query(
        "select coalesce(sum(case when side='CREDIT' then amount_minor else -amount_minor end),0)::text as balance from ledger_entries where ledger_account_id=$1::uuid",
        [id],
      )
    )[0];
    return { accountId: id, currency: a.currency, balanceMinor: r.balance };
  }
  async history(id: string) {
    return ledgerDataSource.query(
      'select id,transaction_id as "transactionId",side,amount_minor::text as "amountMinor",currency,created_at as "createdAt" from ledger_entries where ledger_account_id=$1::uuid order by created_at,id',
      [id],
    );
  }
  async reserve(
    accountId: string,
    amountMinor: string,
    currency: string,
    idempotencyKey = '',
    paymentId?: string,
  ) {
    if (!/^[1-9]\d*$/.test(amountMinor) || !idempotencyKey)
      throw new HttpException('idempotency key and valid amount required', 400);
    const r = ledgerDataSource.createQueryRunner();
    await r.connect();
    await r.startTransaction();
    try {
      const previous = (
        await r.query('select * from balance_reservations where idempotency_key=$1 for update', [
          idempotencyKey,
        ])
      )[0];
      if (previous) {
        if (
          previous.ledger_account_id !== accountId ||
          String(previous.amount_minor) !== amountMinor ||
          previous.currency !== currency
        )
          throw new HttpException('idempotency conflict', 409);
        await r.commitTransaction();
        return { id: previous.id, accountId, amountMinor, currency, status: previous.status };
      }
      const account = (
        await r.query('select * from ledger_accounts where id=$1::uuid for update', [accountId])
      )[0];
      if (!account || account.status !== 'ACTIVE' || account.currency !== currency)
        throw new HttpException('invalid ledger account', 400);
      const posted = (
        await r.query(
          "select coalesce(sum(case when side='CREDIT' then amount_minor else -amount_minor end),0)::text as amount from ledger_entries where ledger_account_id=$1::uuid",
          [accountId],
        )
      )[0].amount;
      const reserved = (
        await r.query(
          "select coalesce(sum(amount_minor),0)::text as amount from balance_reservations where ledger_account_id=$1::uuid and status='ACTIVE'",
          [accountId],
        )
      )[0].amount;
      if (BigInt(posted) - BigInt(reserved) < BigInt(amountMinor))
        throw new HttpException('insufficient available balance', 409);
      const id = randomUUID();
      await r.query(
        "insert into balance_reservations(id,ledger_account_id,amount_minor,currency,status,payment_id,idempotency_key) values($1,$2::uuid,$3::bigint,$4,'ACTIVE',$5::uuid,$6)",
        [id, accountId, amountMinor, currency, paymentId ?? null, idempotencyKey],
      );
      await r.commitTransaction();
      return { id, accountId, amountMinor, currency, status: 'ACTIVE' };
    } catch (error) {
      await r.rollbackTransaction();
      throw error;
    } finally {
      await r.release();
    }
  }
  async releaseReservation(reservationId: string, idempotencyKey: string) {
    if (!idempotencyKey) throw new HttpException('idempotency key required', 400);
    const r = ledgerDataSource.createQueryRunner();
    await r.connect();
    await r.startTransaction();
    try {
      const row = (
        await r.query('select * from balance_reservations where id=$1::uuid for update', [
          reservationId,
        ])
      )[0];
      if (!row) throw new HttpException('reservation not found', 404);
      if (row.status === 'ACTIVE')
        await r.query(
          "update balance_reservations set status='RELEASED',released_at=now() where id=$1::uuid",
          [reservationId],
        );
      await r.commitTransaction();
      return { id: reservationId, status: 'RELEASED' };
    } catch (error) {
      await r.rollbackTransaction();
      throw error;
    } finally {
      await r.release();
    }
  }
  async internalTransfer(
    reservationId: string,
    sourceAccountId: string,
    destinationAccountId: string,
    amountMinor: string,
    currency: string,
    idempotencyKey: string,
  ) {
    const r = ledgerDataSource.createQueryRunner();
    await r.connect();
    await r.startTransaction();
    try {
      const reservation = (
        await r.query('select * from balance_reservations where id=$1::uuid for update', [
          reservationId,
        ])
      )[0];
      if (
        !reservation ||
        reservation.status !== 'ACTIVE' ||
        reservation.ledger_account_id !== sourceAccountId ||
        String(reservation.amount_minor) !== amountMinor ||
        reservation.currency !== currency
      )
        throw new HttpException('invalid active reservation', 409);
      const result = await this.post(idempotencyKey, [
        { accountId: sourceAccountId, side: 'DEBIT', amountMinor, currency },
        { accountId: destinationAccountId, side: 'CREDIT', amountMinor, currency },
      ]);
      await r.query(
        "update balance_reservations set status='RELEASED',released_at=now() where id=$1::uuid",
        [reservationId],
      );
      await r.commitTransaction();
      return { ...result, reservationId };
    } catch (error) {
      await r.rollbackTransaction();
      throw error;
    } finally {
      await r.release();
    }
  }
}
