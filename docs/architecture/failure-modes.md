# Failure Modes

The Stage 1 service shells remain live when their database is unavailable, but `/ready` returns HTTP 503 until it can execute `select 1`. `/health` reports process liveness without a dependency check. Configuration validation prevents startup with missing or malformed required environment values.

Kafka delivery will be treated as at least once when producers and consumers are introduced. The outbox, inbox, retries, and dead-letter handling are reserved for their applicable later stages.

In Stage 4, Payment writes its aggregate update and command outbox record in one local PostgreSQL transaction. A failed or insufficient reservation leaves ledger entries untouched and Payment becomes `REJECTED`; a failed internal-transfer command leaves the active reservation in place for explicit compensation. Outbox publication retries five times before recording the message in the service dead-letter table. No payment path uses a distributed transaction or synchronous Payment-to-Ledger call.

In Stage 5, simulated rail acceptance never changes a ledger balance. Only `rail.payment-settled.v1` requests settlement posting. A simulated rejection or timeout releases the reservation. Duplicate and out-of-order rail events are retained as at-least-once delivery cases; the Payment inbox permits one effective transition. Refunds and reversals create new Ledger postings, preserving the immutable journal.

Stage 6 reconciliation imports are checksum-idempotent. A failed run leaves the imported file and any already-created immutable records intact for investigation. Resolution is an auditable operational action only; it never modifies money. Gateway requests receive correlation IDs, conservative security headers, and a local 120-request-per-minute limit per source address.
