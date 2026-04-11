# ADR 0011: Reconciliation records discrepancies but never changes money

Reconciliation Service imports simulated settlement files into its own database and compares declared expected and actual minor-unit amounts. A discrepancy can only be explicitly resolved with immutable audit metadata. Resolution records an operational decision; it never writes Ledger, Rail, or Payment state. Any financial correction remains a separate Ledger reversal or adjustment workflow.
