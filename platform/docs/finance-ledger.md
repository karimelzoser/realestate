# Finance Ledger and Cheque Evidence

This document defines the production finance authority for transaction payments and cheques.

## Source of truth

`payment_schedule_items` and `transaction_cheques` are operational projections. They are not the audit source of truth for received money or cheque state transitions.

Payment truth is append-only:

- `finance_payment_events` records receipts, reversals and refunds.
- `finance_ledger_entries` records exactly two balanced postings per payment event.
- `finance_payment_allocations` links money events to payment-schedule items.
- `finance_provider_webhook_events` records normalized provider ingress and enforces provider-event idempotency.

Cheque truth is append-only:

- `finance_cheque_events` records EXPECTED, RECEIVED, DEPOSITED, CLEARED, RETURNED, CANCELLED and REPLACED evidence.
- `transaction_cheques` stores the current projection plus immutable commercial identity and replacement-chain links.

Original finance evidence is never edited to represent a correction. Corrections are compensating events.

## Double-entry payment model

Each payment event posts exactly two immutable ledger entries:

- `CASH_CLEARING`
- `BUYER_RECEIVABLE`

`PAYMENT_RECEIVED` increases cash and reduces buyer receivable. `PAYMENT_REVERSED` and `REFUND_ISSUED` post the exact opposite signs.

PostgreSQL uses a deferred constraint trigger to require exactly two postings whose signed amounts sum to zero for every finance payment event.

## Partial payments and allocation

A payment receipt may be:

- allocated explicitly across one or more payment items; or
- allocated FIFO by schedule sequence when no explicit allocation is supplied.

A payment may be larger than the currently outstanding scheduled amount. The excess remains `unallocatedCash`; it is not forced into a schedule item.

Each schedule item exposes:

- contractual amount;
- net allocated paid amount;
- remaining amount;
- projection status, including `PARTIALLY_PAID` and `PAID`.

PostgreSQL prevents allocation above the item amount and prevents direct manufacture of `PAID` / `PARTIALLY_PAID` state.

The legacy `mark-paid` API remains as a compatibility action, but it now posts one immutable receipt for the item's exact remaining balance rather than directly changing status.

## Reversals and refunds

A reversal/refund references an original `PAYMENT_RECEIVED` event.

PostgreSQL locks the original event while checking remaining compensation capacity, so concurrent compensations cannot exceed the original receipt. Negative allocations reference the exact original positive allocations they compensate.

Partial compensation is deterministic: original allocations are unwound in payment-schedule sequence order. If part of the original cash was never allocated, a reversal/refund can still compensate that cash in the balanced ledger without inventing a negative schedule allocation.

A compensation that reduces a previously completed down payment automatically reopens the down-payment milestone projection.

## Provider ingress

Normalized provider events are accepted at:

`POST /v1/finance/providers/:provider/events`

The endpoint requires:

`Authorization: Bearer <FINANCE_PROVIDER_INGRESS_TOKEN>`

`FINANCE_PROVIDER_INGRESS_TOKEN` is mandatory for this endpoint. If it is absent, provider ingress fails closed.

The request body is a normalized provider event containing:

- tenant/project/transaction IDs;
- provider event ID;
- event type: `PAYMENT_RECEIVED`, `PAYMENT_REVERSED`, or `REFUND_ISSUED`;
- amount and currency;
- external payment reference;
- occurrence time;
- related provider event ID for reversal/refund.

The API canonicalizes the validated normalized event and computes SHA-256 before database ingestion.

Idempotency is enforced on `(provider, provider_event_id)`:

- same ID + same normalized content returns the original internal payment event;
- same ID + different content is rejected as an integrity violation;
- re-delivery never creates a second receipt.

Provider receipts are FIFO allocated. Provider reversal/refund events reference the original provider receipt.

Provider adapters should verify the payment provider's native webhook signature before converting a native webhook into this normalized internal event. The PRENEURA bearer boundary protects the internal normalized-ingress endpoint; it does not replace the payment provider's own webhook-signature verification.

## Staff finance APIs

Authenticated staff use the transaction finance scope:

`/v1/tenants/:tenantId/projects/:projectId/transactions/:transactionId/finance`

Important operations:

- `POST /payments` — post a partial/full manual receipt, optionally with explicit allocations.
- `POST /payments/:paymentEventId/compensate` — append a reversal or refund.
- `GET /ledger` — read net cash, net allocated amount, unallocated cash and immutable payment events.
- `POST /payments/:paymentItemId/mark-paid` — compatibility action that settles exact remaining balance via the ledger.

Writes continue to use the existing `payment.verify` permission. Reads reuse the existing finance read/self authorization boundary.

## Cheque lifecycle

A newly scheduled cheque automatically appends one `EXPECTED` event.

Valid event transitions are constrained at the database boundary. Direct updates of cheque state, bank or cheque number are rejected.

A returned cheque is historical evidence and cannot be rewritten back to received. Replacement creates a new instrument with:

- the same root cheque ID;
- generation + 1;
- `replaces_cheque_id` pointing to the returned instrument;
- its own automatic `EXPECTED` event;
- a `REPLACED` event on the historical cheque.

Transaction milestone reconciliation evaluates only current leaf instruments in a replacement chain. A historical returned cheque remains visible in history but does not permanently block a valid successor.

APIs:

- `POST /cheques/:chequeId/status` — append a permitted cheque event.
- `POST /cheques/:chequeId/replace` — replace a returned cheque with a new immutable generation.
- `GET /cheques/:chequeId/history` — return the complete instrument chain and event history.

## Concurrency and immutability

The database, not the controller, owns financial invariants:

- finance events cannot be updated or deleted;
- ledger entries cannot be updated or deleted;
- allocations cannot be updated or deleted;
- cheque events cannot be updated or deleted;
- direct paid-state mutation is rejected;
- direct cheque-state mutation is rejected;
- allocation locks prevent concurrent over-allocation;
- compensation locks prevent concurrent over-reversal/refund;
- every payment event must balance exactly.

## Release certification

`.github/workflows/finance-ledger-certification.yml` rebuilds PostgreSQL 18 from zero and executes:

`platform/packages/database/tests/gate3_finance_ledger_certification.sql`

The suite certifies, among other cases:

- direct payment-state mutation is rejected;
- partial allocation and schedule projections reconcile;
- over-allocation is rejected;
- every payment event has exactly two balanced postings;
- reversal/refund preserves original evidence and reopens projections;
- provider replay is idempotent;
- provider event-ID content collision is rejected;
- payment/ledger/allocation evidence is immutable;
- cheque creation begins immutable history;
- direct cheque mutation is rejected;
- bounce and replacement preserve history and generation linkage;
- final transaction ledger balance is zero across all postings.

## Deployment checklist

Before enabling provider ingestion in production:

1. Generate `FINANCE_PROVIDER_INGRESS_TOKEN` as a long random secret and store it in the platform secrets manager.
2. Keep the normalized ingress endpoint private to trusted provider adapters where network controls permit.
3. Verify each provider's native webhook signature in the adapter before forwarding normalized events.
4. Persist provider-native event IDs unchanged so idempotency survives retries.
5. Do not retry a content-collision error with altered content under the same provider event ID.
6. Run Gate 3 Finance Ledger Certification against the exact release SHA.
7. Reconcile a production-like sample: provider receipts, partial allocations, refund/reversal and bounced-cheque replacement before enabling live settlement workflows.
