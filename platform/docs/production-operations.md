# Production operations slice

This slice extends the authenticated sales flow with production document handling, finance schedules and broker commission readiness.

## Document storage and signatures

- File bytes are stored in S3-compatible object storage; PostgreSQL stores immutable object keys, SHA-256 hashes and workflow state.
- Uploads use server-generated object keys and short-lived presigned PUT URLs.
- Finalization verifies object size, content type and checksum with a HEAD request before the business record becomes uploaded.
- Buyer document access is ownership-scoped through `.self` permissions.
- Contract signer roles are explicit and template-driven.
- Buyer signing requires transaction ownership; company signing requires company-signing authority.
- Required signatures automatically move a contract to signed; stamping requires a signed contract.

## Finance

- One payment schedule per transaction.
- Schedule items must reconcile exactly to the frozen reservation total.
- At least one down-payment item is required.
- Payment verification automatically derives the down-payment milestone.
- Cheque schedules are separate from installment schedule items so physical cheque receipt/deposit/clearance can be tracked independently.
- Returned cheques can revert the `CHEQUES_RECEIVED` milestone before commission payout.
- Buyer finance reads are ownership-scoped.

## Broker commissions

- Commission plan rate and due terms are versioned per project + broker company.
- Commission cases snapshot basis amount, rate and amount from the effective plan.
- Eligibility requires all four transaction prerequisites:
  1. down payment received
  2. cheques received
  3. contract signed
  4. contract stamped
- Eligibility timestamp and due timestamp drive the broker countdown.
- If prerequisites regress before payout, an eligible case returns to pending; invoiced/due cases become disputed for review.
- Broker Agent is restricted to the agent's own cases and receives status/countdown only. Commission rate and amount are independently permission-gated.

## CI gates

Production CI applies all PostgreSQL migrations from zero on PostgreSQL 18 and verifies the critical catalog, sales, document, payment, cheque, commission, notification and SLA indexes/triggers. The full TypeScript workspace also runs in strict typecheck mode.
