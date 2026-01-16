# CoreBank Engineering Guidance

- This is an educational sandbox: never use real financial networks or real customer data.
- Service database ownership is exclusive. Do not share TypeORM entities or access another service database.
- Ledger is the only monetary authority. Amounts are `BIGINT` minor units and API values are decimal strings.
- State-changing commands require correlation, audit metadata, and (for money) an idempotency key.
- Events use `MessageEnvelope`; delivery is at least once. Use transactional outbox and consumer inbox records.
- Keep controllers and Kafka adapters thin. Put invariants in domain/application services.
- Never log credentials, tokens, authorization headers, or sensitive customer data.
