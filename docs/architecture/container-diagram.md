# Container Diagram

API Gateway fronts Identity, Account, Ledger, Payment, Rail Simulator, Reconciliation, and Notification services. Kafka carries inter-service messages; each service has an exclusive PostgreSQL database.
