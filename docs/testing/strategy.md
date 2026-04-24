# Testing Strategy

Stage 1 unit tests cover the shared envelope, money representation, configuration validation, and correlation context. The PostgreSQL Testcontainers smoke test verifies that the integration-test foundation can start an isolated service database.

Stage 6 adds live Docker smoke tests for Prometheus target health, Grafana health, and reconciliation import/run/resolve workflows. The full integration suite also runs with Testcontainers when Docker is available. Domain, messaging, concurrency, and end-to-end scenarios are expanded further during hardening.
