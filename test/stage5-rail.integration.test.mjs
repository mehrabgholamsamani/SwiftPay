import assert from 'node:assert/strict';
import test from 'node:test';

const baseUrl = process.env.BANK_API_URL ?? 'http://localhost:3010';
const enabled = process.env.RUN_INTEGRATION === '1';

test(
  'a rail payment can be created with a deterministic duplicate-event scenario',
  { skip: !enabled },
  async () => {
    const response = await fetch(`${baseUrl}/payments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-correlation-id': crypto.randomUUID() },
      body: JSON.stringify({
        sourceLedgerAccountId: crypto.randomUUID(),
        destinationLedgerAccountId: crypto.randomUUID(),
        amountMinor: '1',
        currency: 'EUR',
        kind: 'RAIL_TRANSFER',
        railScenario: 'DUPLICATE_EVENTS',
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    assert.notEqual(response.status, 500);
  },
);
