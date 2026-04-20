# Security operations

Gateway applies `nosniff`, `DENY` framing, no-referrer, and restrictive content-security headers. It limits a source address to 120 requests per minute in this local single-instance sandbox.

1. Run `pnpm audit --audit-level=high` before release work and review exceptions explicitly.
2. Build `corebank:latest` before running the Trivy container scan, as performed by the security workflow.
3. Never log credentials, bearer headers, refresh tokens, or sensitive customer fields. Pino redaction is a safety net, not permission to log them.
4. A suspected secret exposure requires rotating the local development secret and removing the value from logs, artifacts, and documentation.
5. The in-memory limiter does not coordinate across replicas; replace it only when scaling is introduced in a later stage.
