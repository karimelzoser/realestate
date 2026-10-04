# PRENEURA Real Estate OS — Production Domain Model

This document converts the product blueprint into explicit aggregates, records, relationships, security scopes and invariants. It is the starting point for PostgreSQL migrations and TypeScript domain contracts.

---

## 1. Modeling conventions

- Primary IDs: UUID.
- Human references (`BUY-...`, `EOI-...`, `TX-...`) are immutable alternate identifiers, not primary keys.
- Every tenant-owned row includes `tenant_id`.
- Every project-owned row includes `project_id`.
- `created_at`, `updated_at`: `timestamptz` where mutation is legitimate.
- immutable events/ledger rows have `created_at` only and are never edited.
- money: `numeric(20,4)` internally or integer minor units where currency precision permits; currency code stored explicitly.
- rates/percentages: fixed precision numeric.
- all externally retried commands accept an idempotency key.
- finite state is stored as constrained text/enums plus explicit transition functions.
- PII-heavy fields are never put into generic JSON audit payloads.

---

## 2. Tenant and identity model

### `tenants`
- `id`
- `code`
- `name`
- `status`
- `default_currency`
- `default_timezone`
- `data_region`
- `created_at`

### `users`
Application shadow/profile for the OIDC identity.
- `id`
- `identity_subject` unique
- `display_name`
- `email`
- `phone`
- `status`

### `tenant_memberships`
- `tenant_id`
- `user_id`
- `status`
- `joined_at`

### `roles`
Tenant-defined role bundle or system template.
- `id`
- `tenant_id` nullable for platform templates
- `code`
- `name`
- `is_system_template`

### `role_permissions`
- `role_id`
- `permission_code`

### `membership_roles`
- `tenant_membership_id`
- `role_id`
- `scope_type` (`TENANT`, `PROJECT`, `BROKER_COMPANY`)
- `scope_id`

### Default permission families
- `tenant.*`
- `project.*`
- `buyer.*`
- `eoi.*`
- `queue.*`
- `allocation.*`
- `unit.*`
- `transaction.*`
- `payment.*`
- `cheque.*`
- `installment.*`
- `document.*`
- `contract.*`
- `broker.*`
- `commission.*`
- `refund.*`
- `pricing.*`
- `notification.*`
- `report.*`
- `audit.*`
- `support.*`

Sensitive permissions are separate, e.g.:
- `commission.rate.read`
- `commission.amount.read`
- `pricing.override`
- `refund.approve`
- `support.break_glass`

---

## 3. Project/catalog hierarchy

```text
Tenant
  -> Project
      -> Phase
          -> Building / Cluster
              -> Floor
                  -> Physical Unit
```

### `projects`
- `id`, `tenant_id`
- `code`, `name`
- `status`
- `currency`
- `timezone`
- `sales_start_at`, `sales_end_at`

### `phases`
- `id`, `tenant_id`, `project_id`
- `code`, `name`
- `status`
- `availability_start_at`, `availability_end_at`

### `buildings`
- `id`, `tenant_id`, `project_id`, `phase_id`
- `code`, `name`
- master-plan geometry/reference

### `floors`
- `id`, `building_id`
- `code`, `level_no`, `name`

### `unit_types`
- `id`, `tenant_id`, `project_id`
- `code`, `name`
- category and descriptive attributes

### `units`
- `id`, tenant/project/phase/building/floor/type IDs
- `unit_code` unique within project
- `internal_area_m2`
- `built_up_area_m2` nullable
- `garden_area_m2`
- `roof_area_m2`
- `terrace_area_m2` optional
- `view_code`
- `corner_flag`
- `inventory_state`
- `version`

Unit inventory state:
`DRAFT`, `AVAILABLE`, `LOCKED`, `RESERVED`, `SOLD`, `WITHDRAWN`.

Do not infer unit availability only from state. Lock acquisition also checks current lock and phase publication rules transactionally.

---

## 4. Pricing model

### `pricing_versions`
- `id`, tenant/project/phase
- semantic/version number
- `status`: `DRAFT`, `APPROVED`, `PUBLISHED`, `RETIRED`
- effective period
- approved/published actor/time

### `pricing_rules`
Rules belong to a version.
- precedence/order
- selector: project/phase/building/type/unit/filter
- component type:
  - `INTERNAL_AREA_RATE`
  - `BUA_RATE`
  - `GARDEN_RATE`
  - `ROOF_RATE`
  - `TERRACE_RATE`
  - `VIEW_PREMIUM`
  - `FLOOR_PREMIUM`
  - `CORNER_PREMIUM`
  - `FIXED_ADJUSTMENT`
  - `PERCENT_ADJUSTMENT`
- amount/rate
- currency

### `price_quotes`
Immutable calculation snapshot.
- `id`
- buyer/EOI optional
- unit
- pricing version
- total
- currency
- expires_at
- input fingerprint

### `price_quote_lines`
- quote
- rule/component
- label
- basis quantity
- rate
- amount
- ordering

When a unit lock succeeds the selected quote/version/lines are snapshotted to the transaction. Later published prices cannot mutate the locked transaction economics.

---

## 5. Buyer / CRM model

### `buyers`
- `id`, `tenant_id`
- `buyer_ref`
- display/contact identity
- national ID/passport stored under PII controls
- nationality
- preferred language
- status

### `buyer_contacts`
- type (`PHONE`, `EMAIL`, etc.)
- normalized value
- verified_at
- consent metadata

### `buyer_sources`
- buyer
- source (`DIRECT`, `BROKER`, `SALES`, campaign/integration)
- campaign/referral

### `buyer_preferences`
Structured decision inputs only:
- budget range
- desired types
- area range
- buildings/views/features
- payment preference

### `buyer_notes`
Operational notes; separate from immutable audit.

### Duplicate strategy
Use normalized phone/email/national-id candidate matching, but never silently merge. Create a merge case and preserve source record references.

---

## 6. Broker model

### `broker_companies`
- `id`, tenant
- code/name/status
- commercial agreement status

### `broker_memberships`
- broker company
- user
- role (`BROKER_MANAGER`, `BROKER_FINANCE`, `BROKER_AGENT`)
- status

### `broker_project_scopes`
Which projects/phases the broker may operate in.

### `buyer_attributions`
Immutable attribution window/record.
- buyer
- broker company
- broker agent
- source
- attributed_at
- validity/effective dates
- override history via events, not destructive changes

The current effective attribution is a query over records/events.

---

## 7. EOI model

### `eois`
- `id`, tenant/project/buyer
- `eoi_ref`
- status
- amount/currency
- eligibility state
- policy acknowledgements
- effective refund policy version

EOI state example:
`DRAFT`, `PAYMENT_PENDING`, `PAID`, `ELIGIBLE`, `INELIGIBLE`, `CANCELLED`, `REFUND_PENDING`, `REFUNDED`.

### `eoi_eligibility_decisions`
Append-only decision history:
- criteria version
- result
- reason codes
- actor/system

---

## 8. EOI refund model

### `refund_policy_versions`
- tenant/project/phase scope
- refundable flag/rules
- window calculation
- deduction rules
- allocation participation effect
- approval threshold
- status/effective dates

### `refund_requests`
- EOI/payment reference
- policy version
- requested amount
- calculated eligible amount
- reason
- state
- requested/approved/rejected/completed timestamps

### `refund_events`
Append-only workflow events.

Never recompute historical refund eligibility against a newer policy version unless an authorized exception explicitly selects it and records the reason.

---

## 9. Queue model

### `allocation_days`
- project/phase
- open/close window
- capacity policy version
- state

### `queue_tokens`
- allocation day
- buyer/EOI
- token number/reference
- attendance mode (`ONLINE`, `SALES_CENTER`)
- priority score/components or deterministic ordering data
- state
- check-in/call timestamps
- version

State:
`ISSUED`, `WAITING`, `CALLED`, `CALL_GRACE`, `SERVING`, `NO_SHOW`, `COMPLETED`, `CANCELLED`.

### `allocation_capacities`
- effective allocation day
- online slot count
- allocator seats
- effective version

Changing capacity changes service throughput, not the historical ordering truth.

---

## 10. Allocation session and atomic lock

### `allocation_sessions`
- queue token
- buyer
- channel (`AI_ONLINE`, `HUMAN_ALLOCATOR`)
- allocator user nullable
- started/ended
- status

### `unit_locks`
- unit
- buyer/EOI/session
- price quote/version
- state
- acquired_at
- short_grace_expires_at
- extended_grace_expires_at nullable
- release reason
- `idempotency_key`
- `version`

State:
`ACTIVE_SHORT_GRACE`, `EXTENSION_REQUESTED`, `ACTIVE_EXTENDED_GRACE`, `HANDED_OFF`, `EXPIRED`, `RELEASED`, `CONVERTED`.

### Lock invariant
Database must prevent two active locks for one unit. Implement with transaction-level row locking plus an enforceable active-lock uniqueness strategy. The unit state change, lock record, transaction bootstrap and outbox event occur in one PostgreSQL transaction.

---

## 11. Transaction completion model

### `transactions`
- tenant/project/buyer/EOI/unit/lock
- `transaction_ref`
- snapshotted pricing values/version
- state
- assigned transaction operator
- version

### `requirement_templates`
Project-configurable definitions:
- code/name/category
- who is responsible
- verification role
- blocking rule
- due offset

### `transaction_requirements`
Instantiated checklist item.
- transaction
- template/version
- state
- owner actor/scope
- due_at
- completed_at
- verified_at
- evidence reference

State:
`PENDING`, `SUBMITTED`, `VERIFYING`, `SATISFIED`, `REJECTED`, `WAIVED`.

Waiver requires explicit capability + reason + audit.

Completion percentage is calculated from policy-weighted/required items, not manually typed.

---

## 12. Payment and financial ledger

### `payment_intents`
- transaction/EOI/installment context
- provider/method
- expected amount
- currency
- state
- idempotency

### `payment_transactions`
Raw payment/evidence result record.
- provider reference
- amount/currency
- method
- received/verified time
- reconciliation state

### `ledger_accounts`
Logical accounts used by the platform ledger.

### `ledger_entries`
Immutable debit/credit-style or signed-entry representation.
- financial event
- account
- amount/currency
- effective timestamp
- reversal-of optional

### `payment_allocations`
Maps confirmed money to:
- EOI;
- down payment;
- specific installment(s);
- fees/refunds where applicable.

Cached aggregate amounts may exist as read models but can always be rebuilt from authoritative entries.

---

## 13. Cheques

### `cheques`
- transaction/property
- cheque number tokenized/masked as appropriate
- bank
- drawer
- expected amount
- due/deposit dates
- status
- physical custody metadata

### `cheque_events`
- RECEIVED
- VERIFIED
- DEPOSITED
- CLEARED
- BOUNCED
- REPLACED
- CANCELLED

Replacing a bounced cheque links old -> replacement; never rewrite the old cheque into a different instrument.

Commission policies can define whether `RECEIVED`, `DEPOSITED` or `CLEARED` is the required milestone.

---

## 14. Property/installments/collections

### `properties`
Created when a transaction reaches the configured sale-completion boundary.
- buyer
- unit
- executed contract
- total contract amount
- status

### `installment_schedules`
Versioned schedule generated from payment plan/contract.

### `installments`
- sequence
- due_at
- expected amount
- allocated paid amount as read model
- derived status

Derived status:
`UPCOMING`, `DUE`, `PARTIALLY_PAID`, `PAID`, `OVERDUE`, `WAIVED`, `RESTRUCTURED`.

### `collection_cases`
Optional operational layer for overdue follow-up and promises-to-pay.

---

## 15. Documents

### `documents`
Logical document record.
- owner aggregate type/id
- category
- current version
- trust/verification state

### `document_versions`
- storage object key
- original name
- MIME detected
- size
- SHA-256
- uploader
- scan state/result
- created_at

### `document_verifications`
- version
- verifier
- result
- reason
- verified_at

No user receives the raw storage bucket key as authorization. Access goes through permission-checked signed URLs.

---

## 16. Contract/signature model

### `contract_templates`
Logical template.

### `contract_template_versions`
- source object
- structured variable schema
- clause/version metadata
- publish state

### `contracts`
- transaction
- template version
- exact price/unit/buyer snapshot
- generated file object/hash
- state

State:
`DRAFT`, `GENERATED`, `READY_FOR_SIGNATURE`, `PARTIALLY_SIGNED`, `EXECUTED`, `VOIDED`, `SUPERSEDED`.

### `signature_envelopes`
- contract
- provider/method
- status
- created/expires

### `signature_participants`
- participant type/user/buyer/company signer
- signing order
- required method
- signed_at

### `signature_evidence`
- participant
- method (`DRAWN`, `TYPED`, `UPLOADED`, `EXTERNAL_PROVIDER`, `PHYSICAL_EXECUTED_COPY`)
- provider receipt/reference
- evidence hash/object reference
- identity verification method

The executed PDF/object is immutable. Any amendment creates a new contract/version relationship.

---

## 17. Commission model

### `commission_agreements`
- tenant + broker company
- project/phase scope
- commercial status

### `commission_policy_versions`
- agreement
- effective period
- rate type (`PERCENT`, `FIXED`, tiered if later required)
- rate/base definition
- tax/withholding metadata if needed
- due rule
- eligibility rule expression/version
- status

Do not expose this record to Broker Agent APIs.

### `commission_cases`
One transaction attribution instance.
- transaction
- broker company
- broker agent attribution
- policy version
- state

### `commission_milestones`
Materialized status for required evidence:
- down payment
- cheques
- buyer signature
- company signature
- stamp/executed contract
- required documents
- cooling/refund window

### `commission_entitlements`
Created once policy conditions are satisfied.
- eligible_at
- base amount
- confidential rate
- calculated amount
- currency
- due_at
- calculation snapshot/hash

### `commission_invoices`
- entitlement
- broker invoice ref/object
- state

### `commission_payments`
- entitlement/invoice
- payment ref
- amount
- paid_at
- reconciliation state

### Agent-safe projection
Broker Agent receives:
- case state;
- transaction completion percent;
- completed/missing milestones;
- eligible/not eligible;
- due countdown only if tenant policy permits;
- paid/unpaid status if permitted.

It does **not** receive `rate`, `base_amount`, `calculated_amount`, confidential agreement files or finance-only notes.

---

## 18. Task/SLA/notification model

### `tasks`
- tenant/project
- subject aggregate
- task type
- assigned user/role/scope
- priority
- due_at
- state
- completed_at

### `notification_templates`
Versioned, localized template:
- event/use case
- channel
- locale
- provider template identifier where required
- variable schema

### `notification_policies`
Examples:
- installment reminder offsets;
- missing-document escalation;
- commission due reminders;
- EOI refund updates.

### `notification_deliveries`
- recipient
- channel/provider
- template version
- deduplication key
- send attempt
- provider message ref
- sent/delivered/read/failed state where provider supports it
- error class

A reminder activity rechecks current authoritative state immediately before sending. A paid installment must not receive a stale overdue reminder just because an old timer fired.

---

## 19. AI model

### `ai_provider_configs`
Per tenant/platform:
- provider type
- model alias
- secret reference (never raw secret)
- allowed use cases
- enabled/status

### `ai_prompt_versions`
- use case
- prompt/system instruction version
- schema version
- status

### `ai_recommendation_runs`
- buyer preference snapshot fingerprint
- inventory/pricing snapshot/version
- provider/model
- result schema
- latency/token/cost metadata
- timestamp

### `ai_recommendation_items`
- unit
- rank
- score/confidence
- reason codes
- natural-language explanation

Authoritative availability and price are re-read from core services before any user action.

---

## 20. Import/export model

### `import_jobs`
- import type
- uploaded object
- schema/template version
- mapping
- status
- actor

### `import_rows`
- row number
- normalized payload
- validation status/errors

### `import_publications`
- approved job
- resulting data version
- publish actor/time

### `export_jobs`
- type/filter snapshot
- requested columns after permission projection
- status
- output object
- expires_at

Exports are regenerated from server-authorized query definitions; never export browser DOM data as the authoritative method.

---

## 21. Audit/outbox/integration model

### `audit_events`
Append-only business/security trail.

### `domain_outbox`
- aggregate type/id/version
- event type
- payload schema version
- correlation ID
- published_at
- retry metadata

### `webhook_inbox`
For external webhook idempotency:
- provider
- external event ID unique
- signature verification result
- received_at
- processing state
- normalized result/reference

Never process a payment/e-sign webhook without first authenticating/signature-validating it and deduplicating the external event ID.

---

## 22. PRENEURA control-plane model

### `platform_tenant_health`
Read model only; no duplication of business truth.

### `support_access_sessions`
- PRENEURA staff actor
- tenant/project scope
- reason/ticket
- approved_by if required
- started_at/expires_at/ended_at
- privilege level

### `tenant_features`
Feature/entitlement configuration.

### `integration_connections`
- tenant
- integration type
- status
- encrypted secret reference
- health metadata

---

## 23. Critical indexes/constraints checklist

At migration design time verify at minimum:

- project `unit_code` uniqueness;
- active unit lock uniqueness;
- external payment/webhook event ID uniqueness per provider;
- command idempotency key uniqueness in its scope;
- queue token number uniqueness per allocation day;
- buyer normalized contact lookup indexes;
- audit timestamp + tenant/project indexes;
- transaction buyer/unit/status indexes;
- requirement status/assignee/due indexes;
- installment due/status indexes;
- commission broker/state/due indexes;
- notification due/state indexes;
- outbox unpublished index;
- pg_trgm indexes for approved search fields.

---

## 24. Data retention and privacy categories

Classify every table/field as one of:
- public/project catalog;
- internal operational;
- confidential commercial;
- PII;
- high-risk identity/financial document;
- immutable legal/financial evidence.

Define retention/deletion rules per category and jurisdiction/customer contract. Legal/financial retention may override user-facing deletion expectations; implementation must use policy-driven retention rather than ad-hoc row deletion.

---

## 25. Source-of-truth rule

For each business fact there must be one authoritative owner:

| Fact | Owner |
|---|---|
| Buyer identity/profile | Buyer module |
| EOI eligibility | EOI module |
| Queue order/state | Queue module |
| Unit availability/lock | Inventory/Lock module |
| Price | Pricing version + quote snapshot |
| Payment truth | Financial ledger/payment module |
| Cheque truth | Cheque module |
| Required completion | Transaction Requirement module |
| Contract executed state | Contract module |
| Property/installment schedule | Property/Installment module |
| Commission entitlement | Commission Engine |
| Refund outcome | Refund workflow + ledger |
| Notification delivery | Notification delivery record |
| Audit history | Append-only audit store |

Dashboards, AI and integrations consume these truths; they do not redefine them.
