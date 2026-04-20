# Lightweight threat model

## Scope

CoreBank is an educational, local-only simulation. It must not process real customer data, connect to real financial networks, or be described as production-ready.

## Primary threats and controls

| Threat                          | Control                                                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Credential or token disclosure  | Pino redaction rules; never log authorization headers, passwords, refresh tokens, or secrets.                                               |
| Unauthorized API access         | Identity JWT checks, Gateway routing boundary, and account authorization rules.                                                             |
| Money corruption                | Ledger-only monetary authority, BIGINT minor units, balanced entries, locking, idempotency, immutable postings, and reversing transactions. |
| Cross-service database access   | Separate service databases; service-to-service state changes use Kafka messages.                                                            |
| Duplicate or reordered messages | Message envelope IDs, inbox records, outbox records, idempotency keys, and explicit saga states.                                            |
| Telemetry data exposure         | Correlation IDs only; redaction and local-only Grafana/Tempo/Prometheus services.                                                           |
| Dependency/container risk       | CI dependency audit and Trivy image scan.                                                                                                   |

## Accepted limitations

The in-memory Gateway rate limiter is single-instance only. Local development credentials and Grafana password are not production secrets. There is no external identity provider, HSM, WAF, multi-region recovery, or regulatory control set.
