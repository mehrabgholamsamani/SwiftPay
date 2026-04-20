# Reconciliation operations

1. Import a simulated settlement file through `POST /reconciliation/files` with rows containing an external reference, expected and actual minor-unit values, and currency.
2. Start a run with `POST /reconciliation/files/{fileId}/runs` and inspect `GET /reconciliation/runs/{runId}/discrepancies`.
3. Resolve each discrepancy explicitly through `POST /reconciliation/discrepancies/{id}/resolve`. This creates immutable audit metadata and never changes a financial record.
4. A financial correction must be raised through the normal Payment/Ledger refund or reversal process; do not use reconciliation resolution to alter money.
