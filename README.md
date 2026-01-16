# CoreBank

CoreBank is an educational simulated banking and payment platform. It is not a real banking system, is not certified for production use, and must never connect to real financial networks or customer data.

The repository is organized as independently deployable NestJS service shells with separate database ownership and versioned Kafka message contracts.

CoreBank includes identity/accounts, immutable double-entry ledger operations, reservation-backed payments, deterministic rail simulation, reconciliation, and local observability through Prometheus, Grafana, Tempo, and the OpenTelemetry Collector. It is an educational sandbox only: never use real customer data, real credentials, or real financial networks.

## Local verification

Use Node 20+ and pnpm 10:

```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
docker compose config
docker compose up --build
```

Or run the concise local demonstration:

```powershell
.\scripts\demo.ps1
```

After startup, check Gateway at `http://localhost:3010/health`, OpenAPI at `http://localhost:3010/openapi`, Prometheus at `http://localhost:9090`, and Grafana at `http://localhost:3008` (`admin` / `corebank-local-only`).

## Limitations and future work

This is not production-ready. The rate limiter is local-memory only, observability is local-only, and the simulated rail is not an external payment network. Deferred work includes deployment manifests, load/fault testing, performance tuning, consumer-scale validation, and production security controls. See [the threat model](docs/security/threat-model.md) and [operational runbooks](docs/runbooks/).
