# ADR 0005: Stages one through four use no synchronous service dependencies

The API Gateway is the sole external REST entry point. Payment requests are coordinated through Kafka commands and events; the Payment Service never calls the Ledger Service synchronously. This avoids distributed transactions and preserves service ownership.
