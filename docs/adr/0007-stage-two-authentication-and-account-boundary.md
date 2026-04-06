# ADR 0007: Identity issues JWTs; Account validates them locally

Identity Service owns passwords, roles, and refresh-token rotation. It issues short-lived signed access tokens. Account Service verifies the signed access token locally rather than synchronously querying Identity, avoiding a runtime dependency and preserving the API Gateway as the only external entry point.

Identity and Account each persist their own state and a transactional outbox. Their Stage 2 events are published asynchronously to Kafka and carry a versioned message envelope.
