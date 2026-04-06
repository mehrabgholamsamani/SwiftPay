# ADR 0006: Validate environment and propagate correlation at each service boundary

Each service loads a strict shared environment schema at startup. Every HTTP request receives or is assigned an `x-correlation-id`, which is returned in the response and stored in `AsyncLocalStorage` for downstream application work. Pino logs redact credentials and token fields by default.

This is a platform concern, not a shared business-domain module. No customer or monetary data is logged by the foundation.
