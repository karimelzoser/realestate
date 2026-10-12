# Feature completion — reconciled production candidate

Published schema47 head `47b9eb5df7680b0c30ff03a39388539a135dac70`, PR90, passed all39 inspected CI runs. Render public testing is authorized and its current profile is being certified; hosted provider/UAT/live production evidence remains pending.

| Feature | Present in production candidate | Remaining for final product |
|---|---|---|
| Identity/security | OTP/OIDC/PKCE/AAL2/session revocation/lifecycle/scoped authorization/SSE support expiry | Actual realm/providers and public onboarding/recovery UAT |
| Egypt identity | Normalization, identity/consent/recovery evidence schema43 and tests | Public identity UX; real proof separate from OTP |
| Arabic/English | Provider/direction/Egypt formatting, critical auth and developer onboarding translations | Operational/financial/buyer/contract/notification translation audit, exact decimals, full responsive RTL |
| Developer onboarding | Branding/projects/first director/bootstrap/readiness/audit schema44 + API/UI tests | Complete role/invitation/lifecycle business UAT |
| Brokerage onboarding | Organizations across developers, agreements/access/transfers schema45 API/SQL tests | Full B2B UI, agents/finance/manager enrollment and acceptance |
| Catalog/assets/imports | Types/physical units/buildings/floors/slots, assets, CSV/JSON/XLSX preview/publication/rollback | Public visual discovery, safe exact selection/read models and import edge tests |
| Pricing | Versioned indoor/roof/garden components and frozen quote evidence | Per-apartment adjustments and full final pricing acceptance; exact quote/version/replay foundation is certified |
| EOI | Required type/policy acceptance46, payment/refund evidence and bilingual staff workflow | Public buyer payment/eligibility UX and real provider acceptance |
| Queue/assignment | Shared queue/check-in/dispatch/assigned allocator | Buyer invitation/online handoff/capacity/live position without others' identities |
| Allocation | Exact assigned apartment hierarchy/paging/quote/hold/reservation47, expiry and terminal replay | Master-plan visual and online buyer allocation/capacity; complete identity visibility in finance/receipts/commissions |
| Grace | Basic durable TTL expiry | Extension/offline requests, operator decision inbox and non-stealing late-approval races |
| Finance | Immutable ledger/allocations/replays/reversals/refunds/cheque history/settlements | Exact-unit plan bind, real merchant/manual accepted process, receipts/reconciliation/UAT |
| Documents/contracts | Private trust/scanner/templates/signers/immutable execution | Real populated Arabic/bilingual PDFs, single-use signing challenge and providers/legal acceptance |
| My Property | Buyer purchase/finance/installment view | Exact visual property/contract/receipt/private downloads/updates/support |
| Broker/manager/admin | Scoped role workspaces, commissions/redaction/countdown/support access/metrics/exports | Buyer360, seats/grace/backlogs, volume paging/aggregation and role-specific UX |
| Notifications | Jobs/outbox/replay/SSE/gateway/reminder policies/retries/idempotency | Bilingual opt-in templates, callbacks, uncertain sends/reconciliation/provider verification |
| AI/voice | Advisory ranking/aggregates and fallback, demo voice | Production English voice/navigation with opt-in/barge-in/text fallback and exact eligibility |
| Operations | 39 inspected schema47 CI runs pass; Compose, readiness, logs/OTel, backup/concurrency | Final product/UAT/load/security/recovery, Render hosted testing and final durable production/live Gate7 |

The synthetic demo feature inventory remains in the original review artifacts and PLAN. Preserve demo-only simulation boundaries. See CURRENT_STATUS_AND_CONTINUATION.md for deployment facts and ordered work. No final production completion is claimed.
