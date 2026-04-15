# Event Catalog

| Message                                | Owner / producer | Consumers       | Idempotency and failure handling                                                                                 |
| -------------------------------------- | ---------------- | --------------- | ---------------------------------------------------------------------------------------------------------------- |
| `identity.user-registered.v1`          | Identity Service | None in Stage 2 | Transactional outbox; future consumers must deduplicate by `messageId`.                                          |
| `account.customer-created.v1`          | Account Service  | None in Stage 2 | Transactional outbox; at-least-once delivery.                                                                    |
| `account.created.v1`                   | Account Service  | None in Stage 2 | Transactional outbox; partition key is account ID.                                                               |
| `account.status-changed.v1`            | Account Service  | None in Stage 2 | Transactional outbox; partition key is account ID.                                                               |
| `ledger.transaction-posted.v1`         | Ledger Service   | None in Stage 3 | Transactional outbox; consumers deduplicate by `messageId`.                                                      |
| `payment.created.v1`                   | Payment Service  | None            | `PaymentCreatedV1`; payment ID partition key; additive v1 payload; outbox retries then DLQ.                      |
| `ledger.reserve-funds.v1`              | Payment Service  | Ledger Service  | `LedgerReserveFundsV1`; deterministic payment idempotency key; inbox deduplication; retry up to five then DLQ.   |
| `ledger.funds-reserved.v1`             | Ledger Service   | Payment Service | `LedgerFundsReservedV1`; reservation is held, not posted; payment inbox deduplicates by message ID.              |
| `ledger.post-internal-transfer.v1`     | Payment Service  | Ledger Service  | `LedgerPostInternalTransferV1`; no cross-payment ordering guarantee; retry up to five then DLQ.                  |
| `ledger.internal-transfer-posted.v1`   | Ledger Service   | Payment Service | `LedgerInternalTransferPostedV1`; idempotently transitions the payment to `SETTLED`.                             |
| `ledger.funds-reservation-rejected.v1` | Ledger Service   | Payment Service | Carries payment ID and reason only; idempotently transitions an awaiting payment to `REJECTED`.                  |
| `rail.submit-payment.v1`               | Payment Service  | Rail Simulator  | `RailSubmitPaymentV1`; payment-keyed, inbox-deduplicated command; deterministic simulator scenario is persisted. |
| `rail.payment-accepted.v1`             | Rail Simulator   | Payment Service | Acceptance is not settlement; duplicate/out-of-order scenarios are intentional.                                  |
| `rail.payment-settled.v1`              | Rail Simulator   | Payment Service | Idempotently emits one ledger settlement request after acceptance or an out-of-order arrival.                    |
| `rail.payment-rejected.v1`             | Rail Simulator   | Payment Service | Payment rejects and asks Ledger to release its reservation.                                                      |
| `rail.payment-timed-out.v1`            | Rail Simulator   | Payment Service | Simulates timeout after acceptance; Payment fails and compensates by releasing funds.                            |
| `rail.payment-temporarily-failed.v1`   | Rail Simulator   | Payment Service | Informational retry signal; Rail retries deterministically after the supplied delay.                             |
| `ledger.release-funds.v1`              | Payment Service  | Ledger Service  | Deterministic compensation key; release is idempotent.                                                           |
| `ledger.post-adjustment.v1`            | Payment Service  | Ledger Service  | Refund/reversal request; Ledger posts a new balanced transaction and never mutates the original.                 |
| `ledger.adjustment-posted.v1`          | Ledger Service   | Payment Service | Inbox-deduplicated confirmation that changes the payment to refunded or reversed.                                |

All messages use version 1 `MessageEnvelope`; their payloads are additive-only within that version. There is no cross-aggregate ordering guarantee. Publisher failure leaves an outbox record unpublished for retry.

All Stage 4 payment messages use version 1 `MessageEnvelope`; their payloads are additive-only. Kafka delivery is at least once, ordering is only meaningful within a payment aggregate key, and all consumers deduplicate envelope IDs. Publisher retry is bounded to five attempts with failed records moved to the producer's dead-letter table; deployment topic policies should route equivalent exhausted consumer failures to a `.dlq` topic.
