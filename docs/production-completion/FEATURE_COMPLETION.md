# PRENEURA feature completion inventory

Checked 11 October 2026. First release: Egypt, developers and brokerages.

Accepted completion target: EOI selects an apartment type; allocation selects an exact eligible available physical apartment. Arabic/English UI and English voice initially. All source on GitHub; synthetic Pages demo; deployment to the existing self-hosted server only after software/package completion. No Railway. These decisions resolve the earlier selling-model question; existing production type-only allocation still needs implementation changes.

Remote main remains `1a6e61c891e040221f09c773e6de589928a9a0b7`; latest reviewed production branch remains `c2746523eb434898cbb4c46cf5df452d122ba78f` in draft PR #81. Production code described below is in that candidate, not the published GitHub Pages application. Open PRs still number 47, with 46 in draft.

**Implemented means relevant code exists, not that it is deployed or accepted for real customer transactions.** Demo means prototype functionality using demo/browser state. Partial means an implementation exists but does not match the complete demo journey. Not found means no equivalent was identified in the reviewed production candidate; it is not proof that no isolated experiment exists on any other branch.

## Production candidate: implemented domains

| Area | Implemented in the repository | Remaining completion boundary |
|---|---|---|
| Application foundation | Next.js web, NestJS/Fastify API, background worker, notification gateway; shared TypeScript contracts/security/database/observability packages | Integrated deployment on one approved runtime artifact |
| Database | 41 numbered PostgreSQL migrations; constraints, immutable evidence guards; checksummed migration history; schema/runtime readiness | Rehearsal on the target environment and production-like data |
| Login | Phone OTP, National ID lookup followed by OTP, Google/Keycloak OIDC/PKCE, hashed server sessions, logout/revocation | Live providers and privileged MFA/step-up |
| Accounts | Staff/buyer provisioning and invitation, encrypted contacts, verification enrollment, role grant/revoke, pending/active account states | Customer onboarding/UAT; complete self-registration journey is different |
| Permissions | 11 roles; platform/tenant/project/broker-company scope; buyer self-ownership; broker financial field restrictions | Tenant suspension enforcement and open-connection revocation defects |
| Project setup | Tenant/project creation; phases, buildings, floors, unit types, internal physical-unit/slot mapping; asset-upload administration | Buyer-facing visual master-plan/3D equivalent absent; country/customer data acceptance |
| Imports | CSV/JSON/XLSX parsing, mapping/staging/validation, publication lineage, controlled rollback | Customer data/import rehearsal and reconciliation |
| Pricing | Component rates, versioned publication/scheduling, current/next price snapshots, frozen quote breakdown | Business acceptance and exact-apartment/type-based decision |
| Inventory | Type capacity, availability states, atomic lock acquisition/release, one-active-lock protection, bounded durable expiry | Exact-apartment selection and short/24h grace decision workflow not equivalent |
| Buyer records | Direct/internal/broker attribution, buyer profiles, staff buyer invitation/onboarding | Complete public self-service acquisition/onboarding UI |
| EOI | Versioned policy, EOI initiation, financial deposit evidence, paid-state controls | Live payment path and full self-service UI |
| Queue | Check-in, ordered dispatch, one project queue, called-buyer allocator claim, assigned-buyer lock guards | Demo online/AI allocation, live desk/capacity and exact-unit experience are not full parity |
| Reservations | Lock conversion with paid EOI/buyer/queue checks; frozen reservation price; transaction creation | Full buyer online reservation journey and customer acceptance |
| Transaction operations | Milestones, completion progress, identity context, evidence-backed readiness, timeline, operator workspace | Full integrated browser acceptance, advertised contract generation/biometric parity |
| Documents | Versioned templates/requirements, presigned uploads, hash/size/MIME checks, malware-scanner adapter, review/rejection, trust binding | Real private storage/scanner deployment and customer template validation |
| Contract evidence | Typed/object signature records, signer requirements/order, signed/stamped states, immutable execution snapshot/manifest | Automatic populated contract generation/print journey, real signing provider/biometric evidence not established |
| Finance | Schedules, down payment/installments, immutable ledger, receipt allocation, reversals/compensation, normalized provider events | Live bank/payment adapter, operational reconciliation and finance-owner acceptance |
| Cheques | Schedule, receipt/deposit/clearance/return/replacement lifecycle and history | Customer finance workflow acceptance |
| EOI refunds | Policy snapshot, quote/request/review, financial evidence and payout/settlement reconciliation | Actual external refund/disbursement connection |
| Brokerages | Broker Manager/Finance/Agent permissions and workspaces; project access; attributed buyers; company/agent performance; commission visibility | Live customer onboarding and any separately purchased standalone-brokerage scope |
| Commissions | Versioned plans; snapshotted amount/rate/basis; prerequisite-derived eligibility; due timing; invoicing/disputes; settlement-ledger authority | Real payout/settlement provider and finance acceptance |
| Notifications | Personal inbox/read state, SSE, outbox/replay, SLA/missing-step/installment reminder scheduling, audience selection, retries/recovery | Real WhatsApp/SMS/email provider acceptance, templates, delivery/reconciliation; stream revocation fix |
| AI advisory | Deterministic buyer type ranking, optional external advisory provider/fallback, manager aggregate insights, settings and invocation audit | Full demo voice-guided UI/3D/navigation is a separate unfinished production integration |
| Buyer My Property | Own purchases, progress, frozen value, finance paid/remaining/overdue/next due, installment rows, contract execution metadata | Full demo gallery/property detail/document/receipt/support/update experience |
| Management | Manager project and Operations Director portfolio views, operational/financial/broker metrics, role-aware workspaces | Demo decision-room/scenario/live-seat/Buyer-360 audit equivalence not fully established |
| Exports | Governed CSV exports across operational datasets, field-level restrictions, formula-injection handling | Customer reporting acceptance and production-scale pagination/aggregate correctness |
| Platform administration | Client tenants/projects, lifecycle controls, operational metrics, time-limited explicit support sessions | Central lifecycle enforcement, privileged MFA, production support procedures |
| Operations/CI | Frozen installs, strict types/builds, migration readiness, structured logs/OTel, HTTP security, CodeQL/dependency checks, database concurrency/recovery tests, full-stack acceptance and Gate 7 preflight | Live infrastructure/providers, accepted target load, restore/rollback/alerts/on-call, corrected final Gate 7 and final runtime SHA |

Source starting points: [candidate](https://github.com/karimelzoser/realestate/tree/c2746523eb434898cbb4c46cf5df452d122ba78f/platform), [PR #81](https://github.com/karimelzoser/realestate/pull/81), [production operations](https://github.com/karimelzoser/realestate/blob/c2746523eb434898cbb4c46cf5df452d122ba78f/platform/docs/production-operations.md).

## Demo feature inventory and production mapping

Demo presence here comes from the observed browser surfaces plus source and browser-test inspection. It does not mean I independently exercised every button, the private voice inference machine or an external provider.

| Demo function/feature | Demo state | Production equivalent |
|---|---|---|
| Developer project landing page, residential/commercial presentation, imagery and amenities | Implemented | No equivalent public marketing/browsing site found in the production web |
| How PRENEURA Works map, OPEN page previews and ROLE entry | Implemented | Production role-scoped workspace exists; preview/training map is demo functionality |
| Unit-type discovery, featured example apartments, favourites, preferences and recommendations | Implemented | Catalog and recommendation service exist; full public discovery/favourites/preference journey incomplete |
| Register/link buyer, existing login and identity/OTP walkthrough | Implemented/simulated | Secure login, provisioning and enrollment exist; complete public self-registration parity incomplete |
| EOI and eligibility journey | Implemented/simulated | EOI/financial/queue prerequisites implemented; full self-service UI incomplete |
| Invitation and allocation-day attendance selection | Implemented | Queue channels/check-in exist; full buyer invitation/attendance journey not established |
| Shared online/offline queue and turn visibility | Implemented | Staff check-in/dispatch/assignment backend exists; complete buyer live-queue/online allocation parity incomplete |
| Receptionist find/register/check-in/token flow | Implemented | Reception/allocation and staff onboarding workspaces implemented |
| Parallel human desks and online capacity presentation | Implemented | Dispatch and allocator claims exist; full live-seat/compatible-capacity demo equivalent not established |
| Allocator next-buyer assistance and handoff | Implemented | Assigned called-buyer workflow, lock and reservation conversion implemented |
| Master plan → building → floor → exact apartment | Implemented | Hierarchy is stored internally; production sells by type and assigns a slot |
| 3D apartment viewer, 2D plan and photos, room/view inspection | Implemented/reference assets | Asset administration exists; equivalent buyer-facing visualization not found |
| Explicit exact-unit lock | Implemented in demo state | Atomic type/slot locking implemented; different buyer selection contract |
| Short handoff grace countdown | Implemented | Basic lock TTL/durable expiry exists; full handoff-grace model absent |
| Online 24h extension request with reason | Implemented | Equivalent request workflow not found |
| Operator approval/rejection and shared grace inbox | Implemented | Equivalent decision/inbox workflow not found |
| Offline 24h paperwork exception | Implemented | Equivalent exception workflow not found |
| English advisor recommendations, comparison, navigation, scroll and highlighting | Implemented; browser fallback observed | Advisory API exists; full voice/guided UI parity not integrated |
| Private ASR/Qwen/TTS, live audio/VAD/barge-in | Source/transport exists; private runtime not independently tested | Not established as a deployed production service |
| Payment and document readiness | Implemented/simulated | Evidence-backed finance/documents/milestones implemented |
| Generate populated exact-unit contract and print/upload execution | Implemented/simulated | Trusted templates/documents/signatures/execution evidence exist; full generation/print equivalent not found |
| OTP signing, drawn/typed signature and biometric/fingerprint walkthrough | Implemented/simulated | Signature records and signer order exist; real per-signature OTP/biometric/provider flow unverified or absent |
| My Property portfolio, exact details, installments, balances and next due | Implemented; fixture inconsistencies found | Purchase/finance/installment portal implemented; exact-property detail parity partial |
| Signed contracts/documents/receipts in after-sale portal | Implemented/demo views | Documents/ledger/evidence records exist; complete portal view/download/receipt equivalence not established |
| Property updates and support | Implemented/demo views | Equivalent customer support/update module not found |
| Broker attribution, delegated buyers, company/agent performance and commission context | Implemented | More granular production brokerage roles/workspaces and commission controls implemented |
| Manager overview, funnel, inventory, collections and brokers | Implemented | Management/portfolio metrics implemented; full UI parity partial |
| Live Allocation Command Center with queue, seats, waits, locks and feed | Implemented | Queue/assignment/lock/events backend exists; full command-center equivalent partial |
| Buyer 360 and detailed cross-role journey audit | Implemented | Buyer lists/transaction progress/timeline/export evidence exist; full demo 360/journey UI parity partial |
| Project Data & Uploads, Phase Builder, pricing/rules/settings | Implemented | Hierarchy/import/assets/pricing/document/reminder/account controls exist; visual and commercial-rule parity partial |
| Normal Day, Queue Pressure, Unit Conflict, Overdue Collections, Broker Performance, Reset Demo | Implemented | Demo fixtures; not production business functionality |
| English/Arabic labels and legacy Egyptian voice work | Partial language experience; active voice English-only | Production UI English; Arabic/RTL/documents/voice require scoped work and acceptance |

Source: [demo README](https://github.com/karimelzoser/realestate/blob/main/README.md), [demo final review](https://github.com/karimelzoser/realestate/blob/main/docs/FINAL_REVIEW_6.7.md), [production type-based inventory contract](https://github.com/karimelzoser/realestate/blob/c2746523eb434898cbb4c46cf5df452d122ba78f/platform/docs/project-catalog-imports.md).

## What is actually finished versus pending

**Finished at an implementation milestone:** most backend business domains and staff/broker operational workspaces are coded; all four applications build; strict package typechecks pass; custom SQL/CI certification exists.

**Finished as a demonstration:** the broad operating model is present and interactive, with simulated/browser-state transactions and reference visuals. Known currency, recommendation-status and finance-fixture defects remain.

**Not finished as the advertised customer product:** the full public buyer journey, implementation of the accepted EOI-type/exact-apartment allocation distinction, short/extended grace approvals, voice/3D integration, full after-sale support/updates, and accepted Egypt Arabic/English/provider scope.

**Not finished as a production release:** access lifecycle/MFA corrections, final readiness-probe repair, one final tested/deployed runtime pin, target infrastructure/provider validation, load/recovery/rollback/monitoring evidence, and live final GO.

The review recommendations have not been applied to business source code. This work produced review artifacts only. A green CI job or code presence must not be relabeled as a live customer acceptance result.
