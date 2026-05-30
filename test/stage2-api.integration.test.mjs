import assert from 'node:assert/strict';
import test from 'node:test';

const baseUrl = process.env.BANK_API_URL ?? 'http://localhost:3010';
const enabled = process.env.RUN_INTEGRATION === '1';

test(
  'registers, authenticates, rotates a refresh token, and manages an account through the gateway',
  { skip: !enabled },
  async () => {
    const request = async (path, options = {}) => {
      const response = await fetch(`${baseUrl}${path}`, options);
      if (!response.ok) assert.fail(`${path}: ${response.status} ${await response.text()}`);
      return response.json();
    };
    const email = `stage2-${crypto.randomUUID()}@example.test`;
    await request('/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'correct-horse-battery-staple' }),
    });
    const session = await request('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'correct-horse-battery-staple' }),
    });
    const rotated = await request('/auth/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    });
    assert.ok(rotated.accessToken);
    const headers = {
      'content-type': 'application/json',
      authorization: `Bearer ${rotated.accessToken}`,
    };
    const customer = await request('/customers', {
      method: 'POST',
      headers,
      body: JSON.stringify({ displayName: 'Sandbox Customer' }),
    });
    const account = await request('/accounts', {
      method: 'POST',
      headers,
      body: JSON.stringify({ customerId: customer.id, currency: 'EUR' }),
    });
    assert.equal(account.balanceMinor, '0');
    await request(`/accounts/${account.id}/status`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ status: 'SUSPENDED' }),
    });
    const accounts = await request('/accounts', { headers });
    assert.equal(accounts[0].status, 'SUSPENDED');
  },
);
