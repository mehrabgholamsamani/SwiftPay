import { loadServiceConfig } from './index';

describe('loadServiceConfig', () => {
  it('parses the required service environment', () => {
    expect(
      loadServiceConfig({
        DATABASE_URL: 'postgres://corebank:corebank@localhost:5432/corebank',
        PORT: '3000',
        KAFKA_BROKERS: 'localhost:9092',
      }),
    ).toMatchObject({ PORT: 3000, NODE_ENV: 'development' });
  });

  it('rejects an incomplete environment', () => {
    expect(() => loadServiceConfig({ PORT: '3000' })).toThrow();
  });
});
