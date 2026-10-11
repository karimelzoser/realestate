# Gate 4 — Broker, Commission, Notification & Refund Certification

Gate 4 certifies the partner/after-sale automation layer without making any browser state authoritative.

## Authoritative boundaries

### Commission

A commission case belongs to one transaction and snapshots:

- the commission agreement version effective when the transaction opened;
- basis amount from the frozen reservation quote;
- rate percent;
- commission amount;
- attributed broker company/agent.

A later commission-plan publication must never reprice an existing case.

Eligibility is derived only from authoritative transaction milestones:

- down payment received;
- cheques received;
- contract signed;
- contract stamped.

`eligible_at` starts the contractual due countdown. `due_at` is calculated from the snapshotted plan's `due_days_after_eligibility`. If prerequisites regress before payment, the case must regress safely; invoiced/due cases become disputed rather than silently remaining payable.

Broker Agent is status-only. Server responses for `BROKER_AGENT` must omit:

- basis amount;
- commission amount;
- commission rate.

Agent lists are also restricted to transactions attributed to that exact agent. Broker Manager/Finance economics remain permission-gated independently.

## Reminder scheduling

Milestone and installment reminders are durable logical jobs, not browser timers.

A logical reminder identity includes the underlying transaction/payment item, recipient, audience, channel and policy inputs. Reconciliation is rerunnable and must not create duplicate logical jobs.

Every reconciliation pass re-reads authoritative state. Pending reminders are cancelled when they are no longer desired, including when:

- the transaction is completed/cancelled;
- a milestone no longer requires a reminder;
- a payment item is no longer outstanding;
- the recipient/attribution is no longer valid;
- a reminder policy is disabled or changed.

Delivery retries act on the same durable job and provider idempotency key; they do not create a new logical reminder.

## EOI refund history

Each EOI snapshots `refund_policy_id` when it is created. Refund quote/request calculation must always use that historical policy, even after a newer project policy becomes active.

The applicable refund stage is derived from authoritative transaction state:

- before reservation;
- after reservation but before contract;
- after contract.

A refund request snapshots the policy, stage, percentage, fee and requested amount. Approval and payout are separate states. `APPROVED` must not set `paid_at` or mark the EOI refunded.

## Executable certification

`.github/workflows/gate4-broker-notification-refund-certification.yml` runs against a fresh PostgreSQL 18 database and executes the emitted API/worker code.

The scenario proves:

1. January sales bind to the January commission plan even when a future February plan exists;
2. rate/amount remain snapshotted and the historical payment term drives the due transition;
3. Broker Agent receives only its own case and receives no financial commission fields;
4. broker-management projection can expose economics only through the corresponding permissions;
5. a historical EOI keeps its original refund policy after a newer policy becomes active;
6. refund amount/stage are calculated from the historical policy and authoritative transaction progress;
7. approval remains separate from payout;
8. milestone reminders support simultaneous buyer and broker-agent audiences without duplicate jobs on rerun;
9. installment reminders provide the same logical idempotency;
10. changing authoritative transaction state causes still-pending milestone/installment reminders to be cancelled.

Gate 4 does not certify external provider credentials. Production WhatsApp/SMS/email credentials and endpoints are verified separately at Gate 7 using the same durable job/idempotency contract.
