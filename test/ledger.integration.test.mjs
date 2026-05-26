import assert from 'node:assert/strict';
import test from 'node:test';

const baseUrl = process.env.BANK_API_URL ?? 'http://localhost:3010';
const enabled = process.env.RUN_INTEGRATION === '1';

test(
  'posts balanced test funding, returns a historical balance, and reverses it',
  { skip: !enabled },
  async () => {
    const request = async (path, body) => {
      const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) assert.fail(`${path}: ${response.status} ${await response.text()}`);
      return response.json();
    };
    const customer = await request('/ledger/accounts', {
      ownerId: crypto.randomUUID(),
      currency: 'EUR',
    });
    const funding = await request('/ledger/accounts', {
      ownerId: crypto.randomUUID(),
      currency: 'EUR',
    });
    const posted = await request('/ledger/test-funding', {
      customerAccountId: customer.id,
      fundingAccountId: funding.id,
      amountMinor: '10000',
      currency: 'EUR',
      idempotencyKey: crypto.randomUUID(),
    });
    const balance = await (await fetch(`${baseUrl}/ledger/accounts/${customer.id}/balance`)).json();
    assert.equal(balance.balanceMinor, '10000');
    await request(`/ledger/transactions/${posted.id}/reverse`, {
      idempotencyKey: crypto.randomUUID(),
    });
    const reversed = await (
      await fetch(`${baseUrl}/ledger/accounts/${customer.id}/balance`)
    ).json();
    assert.equal(reversed.balanceMinor, '0');
  },
);

test(
  'concurrent reservations cannot exceed a 10000 minor-unit available balance',
  { skip: !enabled },
  async () => {
    const request = async (path, body) => {
      const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    };
    const customer = await request('/ledger/accounts', {
      ownerId: crypto.randomUUID(),
      currency: 'EUR',
    });
    const funding = await request('/ledger/accounts', {
      ownerId: crypto.randomUUID(),
      currency: 'EUR',
    });
    await request('/ledger/test-funding', {
      customerAccountId: customer.body.id,
      fundingAccountId: funding.body.id,
      amountMinor: '10000',
      currency: 'EUR',
      idempotencyKey: crypto.randomUUID(),
    });
    const reservations = await Promise.all(
      Array.from({ length: 10 }, () =>
        request('/ledger/reservations', {
          accountId: customer.body.id,
          amountMinor: '2000',
          currency: 'EUR',
          idempotencyKey: crypto.randomUUID(),
        }),
      ),
    );
    assert.equal(
      reservations.filter((result) => result.status === 200).length,
      5,
      JSON.stringify(reservations),
    );
    assert.equal(
      reservations.filter((result) => result.status === 409).length,
      5,
      JSON.stringify(reservations),
    );
  },
);
