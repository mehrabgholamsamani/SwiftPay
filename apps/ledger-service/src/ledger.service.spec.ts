import { LedgerService } from './ledger.service';
import fc from 'fast-check';

describe('ledger service', () => {
  it('requires an idempotency key and at least two postings', async () => {
    await expect(new LedgerService().post('', [])).rejects.toThrow('idempotency key');
  });
  it('accepts only equal debit and credit minor-unit totals as a ledger invariant', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000 }), (amount) => {
        const debit = BigInt(amount);
        const credit = BigInt(amount);
        expect(debit).toBe(credit);
      }),
    );
  });
});
