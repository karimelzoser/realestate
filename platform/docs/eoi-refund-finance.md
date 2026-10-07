# EOI financial evidence and refund operating contract

## Purpose

EOI money is a separate financial authority from the post-reservation installment ledger. It represents a buyer deposit held before or during the allocation journey and must remain independently auditable through payment corrections and refunds.

The authoritative records are append-only:

- `eoi_finance_events`
- `eoi_finance_ledger_entries`

`buyer_eois.status`, `buyer_eois.payment_reference`, `buyer_eois.paid_at`, `buyer_eois.refunded_at`, and refund-request payout status are operational projections derived from that evidence. They are not financial write authority.

## Accounting model

EOI payment received:

```text
CASH_CLEARING           +EOI amount
EOI_DEPOSIT_LIABILITY   -EOI amount
```

Payment reversal:

```text
CASH_CLEARING           -EOI amount
EOI_DEPOSIT_LIABILITY   +EOI amount
```

Refund paid:

```text
CASH_CLEARING           -refund amount
EOI_DEPOSIT_LIABILITY   +refund amount
```

If the policy retains part of the EOI, the retained portion is reclassified in a separate immutable event:

```text
EOI_DEPOSIT_LIABILITY   +retained amount
EOI_FEE_REVENUE         -retained amount
```

Every EOI finance event must therefore have exactly two same-currency ledger entries whose signed sum is zero.

## Payment behavior

An EOI is an all-or-nothing eligibility deposit rather than an installment schedule.

A payment is posted only through `preneura_post_eoi_payment(...)` or the corresponding authorized API service. The operation:

1. locks the EOI row;
2. verifies tenant/project scope;
3. rejects an EOI that is not `PAYMENT_PENDING`;
4. creates immutable payment evidence and balanced ledger postings;
5. derives the `PAID` projection;
6. emits an outbox event.

The same active payment reference is idempotent. A different second active receipt is rejected.

## Correcting a mistaken receipt

A receipt is never edited or deleted.

Before queue/refund processing starts, an authorized operator may post a compensating `PAYMENT_REVERSED` event. The EOI returns to `PAYMENT_PENDING`, while the original receipt and its reversal remain immutable history.

A corrected replacement receipt may then be posted. The system permits exactly one **active unreversed receipt** at a time; it does not require that only one historical receipt ever existed.

Once a queue entry or refund workflow exists, the active deposit can no longer be reversed through the correction path.

## Refund policy snapshot

A refund request snapshots the policy outcome at request time, including:

- policy/version identity;
- lifecycle stage;
- original EOI amount;
- refund percentage;
- processing fee;
- requested refund amount;
- currency.

The payout authority reconciles this snapshot back to the active immutable EOI receipt. A request whose amount/currency no longer reconciles cannot be paid.

## Segregation of duties

Approval and payout are distinct permissions:

- `refund.approve` — decides whether the request is approved or rejected;
- `refund.payment.manage` — executes the approved financial payout.

The normal role split is intentional:

- Manager: approval authority, not payout authority;
- Transaction Operator: payout authority, not approval authority;
- Operations Director: may hold both as top client authority.

This prevents a single ordinary operational role from both approving and paying its own refund request.

## Payout behavior

`preneura_pay_eoi_refund(...)` accepts only an `APPROVED` request whose EOI is `REFUND_REQUESTED` and which has an active unreversed immutable payment receipt.

The same payout reference is idempotent. A different second payout reference is rejected.

The operation atomically:

1. creates `REFUND_ISSUED` evidence;
2. posts the refund ledger entries;
3. creates a `RETAINED_AMOUNT_RECOGNIZED` event when the policy keeps part of the deposit;
4. settles the EOI deposit liability;
5. derives refund-request `PAID` and EOI `REFUNDED` projections;
6. emits the refund-paid outbox event.

## Projection guards

Database triggers reject direct manufacture of EOI paid/refunded state or refund payout state.

The authorized finance functions set the transaction-local flag `preneura.eoi_finance_projection=on` only while deriving projections. Missing settings are treated as unauthorized using fail-closed `COALESCE` logic; SQL `NULL` must never bypass the guard.

## Runtime compatibility

The fail-closed financial authority is schema version 35:

```text
0035_eoi_projection_guards_fail_closed
```

API/worker runtime readiness must reject databases below that contract when this branch is deployed.

## Production migration rule

Only canonical files matching:

```text
NNNN_lowercase_name.sql
```

may enter production migration history. Gate 4 certification applies migrations with the real `@preneura/database` migration runner instead of a shell glob, ensuring CI and deployment execute the same migration sequence.

## Certification

`.github/workflows/eoi-refund-finance-certification.yml` rebuilds PostgreSQL 18 from zero and certifies:

- canonical production migration history;
- tenant/project scoped EOI finance identity;
- append-only payment and ledger evidence;
- balanced postings;
- fail-closed projection guards;
- payment idempotency;
- compensating reversal;
- corrected re-payment after reversal;
- reversal lockout after queue processing begins;
- approval/payout separation at the application permission layer;
- refund payout idempotency;
- retained-amount recognition;
- final cash/liability/revenue reconciliation;
- runtime schema authority.
