# Settlement and disbursement operating contract

## Purpose

Outgoing money is a separate authority from incoming payment evidence. PRENEURA uses one settlement model for:

- approved EOI refund payouts;
- eligible/invoiced broker commission payouts.

A refund becoming `APPROVED` or a commission becoming `INVOICED`/`DUE` creates an obligation. It does **not** prove money was sent. `PAID` is a projection derived only from settled disbursement evidence.

## Authoritative records

The immutable settlement authority consists of:

- `settlement_disbursements` — current operational projection for one obligation;
- `settlement_events` — append-only lifecycle evidence;
- `settlement_ledger_entries` — append-only double-entry settlement postings;
- `settlement_provider_events` — normalized provider inbox and replay ledger.

Settlement events and ledger entries cannot be updated or deleted. Corrections use new events, especially `REVERSED`.

## Settlement lifecycle

The supported state machine is:

```text
PENDING_SUBMISSION
  -> SUBMITTED
  -> SETTLED
  -> REVERSED

PENDING_SUBMISSION / SUBMITTED
  -> FAILED
FAILED
  -> SETTLED
```

`CANCELLED` is reserved as an evidence-backed terminal state; direct status manufacture is rejected.

Schema 36 validates both legal transition shape and matching immutable event evidence. Historical events cannot be reused to rewind a terminal settlement into an earlier state.

## Command idempotency

Settlement creation requires a caller-supplied idempotency key unique within the tenant.

The key is bound to the original command source:

- EOI refund settlement -> exact refund-request ID;
- broker commission settlement -> exact commission-case ID.

Repeating the same command with the same key returns the original settlement. Reusing that key for a different source obligation is rejected rather than returning an unrelated settlement.

Submission is also retry-safe:

- same settlement + same provider + same provider reference -> no-op success;
- same settlement with conflicting provider evidence -> rejected.

## Provider outcome ingestion

Provider adapters normalize native webhooks before forwarding them to PRENEURA. The provider boundary is protected by `SETTLEMENT_PROVIDER_INGRESS_TOKEN` and constant-time bearer comparison.

The normalized provider inbox is unique by `(provider, provider_event_id)` and stores a canonical content hash. Repository ingestion behavior is:

- same provider event ID + same normalized content -> replay-safe; already processed outcome is not posted again;
- same provider event ID + different content -> rejected;
- first unprocessed event -> one settlement outcome is posted and `processed_at` is set in the same database transaction.

Native provider signature verification remains the adapter's responsibility before normalized ingress.

## Double-entry settlement ledger

`SETTLED` creates exactly two balanced entries.

EOI refund payout:

```text
CUSTOMER_REFUND_OBLIGATION   +amount
CASH_CLEARING                -amount
```

Broker commission payout:

```text
BROKER_COMMISSION_PAYABLE    +amount
CASH_CLEARING                -amount
```

`REVERSED` posts the exact opposite entries.

A deferred PostgreSQL constraint requires exactly two same-currency entries whose signed sum is zero for every `SETTLED` or `REVERSED` event.

## Paid-state authority

### EOI refund

`eoi_refund_requests.status = PAID` is permitted only when a matching EOI-refund settlement is `SETTLED`.

A paid refund cannot be moved back to `APPROVED` unless its matching settlement first reaches `REVERSED` with immutable reversal evidence.

The associated EOI projection follows the settlement outcome:

- `SETTLED` -> `REFUNDED`;
- `REVERSED` -> `REFUND_REQUESTED`.

### Broker commission

`broker_commission_cases.status = PAID` is permitted only when a matching broker-commission settlement is `SETTLED`.

A paid commission cannot be reopened to `INVOICED`/`DUE` until settlement reversal evidence exists.

The due/invoiced projection is recalculated from `due_at` when a payout reverses.

## Separation of visibility and payout authority

Broker Agent remains status-only. Settlement APIs preserve the existing commission field-level controls: status/countdown access does not imply visibility of commission percentage or amount.

Outgoing payout actions require explicit payout permissions and are not granted merely because a role can approve or view an obligation.

## Runtime compatibility

This branch's settlement command/state authority is schema version 36:

```text
0036_settlement_command_authority
```

API and worker readiness must reject older databases when this branch is deployed.

## Production migration parity

Gate 4 settlement certification uses the real `@preneura/database` migration runner with the frozen workspace lockfile. This ensures CI and deployment execute the same canonical `NNNN_lowercase_name.sql` sequence.

The settlement branch is parallel to the EOI-deposit/refund-finance branch, which currently uses overlapping schema numbers for a different domain. These branches must not be merged directly. The final integration branch will sequence/renumber the parallel migrations and establish one combined runtime marker.

## Certification

`.github/workflows/settlement-ledger-certification.yml` certifies PostgreSQL 18 from zero and runs:

1. `gate4_settlement_ledger_certification.sql`
   - refund payout and reversal;
   - broker commission payout and reversal;
   - balanced settlement postings;
   - direct PAID manufacture rejected;
   - direct reopening of PAID obligations rejected before reversal;
   - immutable event/ledger evidence.

2. `gate4_settlement_command_authority_certification.sql`
   - source-bound idempotency key reuse;
   - evidence-first state transitions;
   - retry-safe submission;
   - conflicting provider submission rejected;
   - paid refund cannot reopen without reversal evidence;
   - terminal state cannot rewind through old historical evidence;
   - exact runtime authority marker.
