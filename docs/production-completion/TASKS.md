# Production completion task ledger

TASKS.json is authoritative; WORK_STATE holds the next action. Active goal: GOAL.json. Detailed functional/visual packages: EXECUTION_PLAN.md. Current task E04.1; genuine owner E01.5 and isolated deployment E16.3 remain in progress.

## E00 — Repository authority and interruption-safe execution

Epic status: INTEGRATED

| Task | Priority | Status | Work | Acceptance |
|---|---|---|---|---|
| E00.1 | P0 | INTEGRATED | Reverify planning/candidate/demo heads and create canonical completion branch | Branch authority is reproducible from GitHub and no demo/runtime code is changed. |
| E00.2 | P0 | INTEGRATED | Persist expanded task ledger and resumable checkpoint controls | A new session can resume the exact unfinished task without repeating settled decisions. |

## E01 — Security, release and testing defect closure

Epic status: IN_PROGRESS

| Task | Priority | Status | Work | Acceptance |
|---|---|---|---|---|
| E01.1 | P0 | TESTED | Centralize tenant/membership/project lifecycle enforcement for direct requests | Suspended/inactive tenant, membership or project cannot retain unauthorized direct API access; historical-read policy is explicit. |
| E01.2 | P0 | TESTED | Revalidate SSE/session/support access on revocation, expiry and suspension | Open streams lose access promptly after role/session/support/tenant lifecycle changes. |
| E01.3 | P0 | TESTED | Enforce privileged assurance, release correctness and truthful normal test/lint commands | No phone-OTP privileged bypass; readiness/build identity is machine-verified; mandatory normal commands cannot pass with zero tests. |
| E01.4 | P0 | IN_PROGRESS | Enforce trusted-origin/CSRF boundary and certify hosted cookie behavior | Requests from an untrusted origin cannot mutate authenticated state, including endpoints without JSON bodies; selected deployment login/cookies/credentialed SSE works without disabling protection. |
| E01.5 | P0 | IN_PROGRESS | Reviewed initial privileged MFA enrollment and trusted first-admin bootstrap | No self-enrollment or phone-OTP assurance escalation; issuer substitution, stale/missing claims, competing reviewers, conflicts, replay and expiry fail closed; initial owner genuinely authenticates MFA and signs in again after approval; hosted provider/browser acceptance required |

## E02 — Egypt identity and Arabic/English foundations

Epic status: IN_PROGRESS

| Task | Priority | Status | Work | Acceptance |
|---|---|---|---|---|
| E02.1 | P0 | IN_PROGRESS | Implement Arabic/English RTL/LTR accessible UI and Cairo/EGP formatting | Critical journeys are equivalent in Arabic/English with correct RTL, Africa/Cairo and EGP behavior. |
| E02.2 | P0 | IN_PROGRESS | Implement Egypt phone/National-ID/passport normalization, consent and truthful verification | Phone ownership is not misrepresented as National-ID ownership; cross-tenant linking and recovery are scoped/audited. |
| E02.3 | P0 | IN_PROGRESS | Deliver premium Arabic/English design tokens and shared accessible components | Shared controls and role shells support RTL/keyboard/200% zoom/320–1440px; documented WCAG2.2 AA acceptance and visual screenshots; no inaccessible fancy-only states |

## E03 — Developer/brokerage onboarding

Epic status: IN_PROGRESS

| Task | Priority | Status | Work | Acceptance |
|---|---|---|---|---|
| E03.1 | P1 | IN_PROGRESS | Complete developer/project branding, staff invitations and lifecycle onboarding | Tenant/project lifecycle is scoped, auditable and cannot grant cross-tenant access. |
| E03.2 | P1 | IN_PROGRESS | Complete brokerage multi-developer agreements, user roles, attribution transfers and B2B administration | Same brokerage sees only approved projects; agents cannot self-escalate or steal attribution. |
| E03.3 | P0 | TESTED | Prevent legacy profile upsert from bypassing approved attribution transfer | Buyer/direct or another broker cannot reset/steal an existing attribution; only authorized approved transfer changes it, with stale/concurrent and historical commission tests. |

## E04 — Catalog, exact physical inventory, assets and pricing

Epic status: IN_PROGRESS

| Task | Priority | Status | Work | Acceptance |
|---|---|---|---|---|
| E04.1 | P0 | IN_PROGRESS | Complete public catalog/assets and verified physical-unit to slot mapping | Unpublished inventory remains private and exact selection never uses anonymous unmapped stock. |
| E04.2 | P0 | IN_PROGRESS | Complete exact-unit price adjustments, deterministic quote snapshots and safe imports | Counts/prices reconcile and imports cannot create duplicate/orphan scope or mutate executed history. |

## E05 — Public buyer journey and apartment-type EOI

Epic status: IN_PROGRESS

| Task | Priority | Status | Work | Acceptance |
|---|---|---|---|---|
| E05.1 | P0 | IN_PROGRESS | Complete public browse/account/preferences and direct/broker/staff buyer entry | Refresh/relogin preserves progress and attribution remains authorized. |
| E05.2 | P0 | IN_PROGRESS | Implement apartment-type EOI, payment/policy acceptance and eligibility checklist | EOI cannot lock exact inventory or invent eligibility and paid policy history is immutable. |
| E05.3 | P1 | NOT_STARTED | Separate applied-EOI retries from an explicit new purchase intention | A terminal/applied EOI is never silently repaid or reused; new purchase behavior is explicit, scoped and compatible with project sales rules and ledger credit. |

## E06 — Shared queue and allocation sessions

Epic status: IN_PROGRESS

| Task | Priority | Status | Work | Acceptance |
|---|---|---|---|---|
| E06.1 | P0 | IN_PROGRESS | Implement allocation windows, invitation/check-in and stable shared queue ordering | Concurrent check-in/dispatch preserves stable priority and unauthorized priority changes fail. |
| E06.2 | P0 | IN_PROGRESS | Implement allocator/online service slots, scoped allocation sessions and manager capacity views | No arbitrary buyer selection or blanket buyer locking capability. |
| E06.3 | P1 | NOT_STARTED | Publish versioned allocation-event readiness/preflight/freeze package | All channels use the same approved event version; missing requirements block publish and later changes cannot rewrite committed buyer evidence |

## E07 — Exact-apartment selection and locking

Epic status: IN_PROGRESS

| Task | Priority | Status | Work | Acceptance |
|---|---|---|---|---|
| E07.1 | P0 | IN_PROGRESS | Implement Master Plan to exact apartment selection with session/type/quote guards | Buyer explicitly selects one eligible available apartment; no silent substitution. |
| E07.2 | P0 | IN_PROGRESS | Implement idempotent atomic exact-unit locking and propagate identity through sale evidence | High concurrency yields one winner; retries are stable; cross-project/stale/ineligible requests fail. |

## E08 — Short/extended grace and operator decisions

Epic status: NOT_STARTED

| Task | Priority | Status | Work | Acceptance |
|---|---|---|---|---|
| E08.1 | P1 | NOT_STARTED | Persist short grace, extension/offline requests, decisions and operator inbox | Pending requests survive expiry as records without holding inventory indefinitely. |
| E08.2 | P1 | NOT_STARTED | Certify expiry/approval/conversion races and same-unit atomic reacquire | Approval never steals another buyer's lock; one transition wins under races/restarts. |
| E08.3 | P1 | NOT_STARTED | Complete controlled cancellation/change/swap and immutable replacement evidence | Concurrent swap/release/payment never double-sells or loses ledger credit; executed contracts remain immutable and replacement requires explicit valid evidence |

## E09 — Payments, installments, cheques and reconciliation

Epic status: IN_PROGRESS

| Task | Priority | Status | Work | Acceptance |
|---|---|---|---|---|
| E09.1 | P0 | IN_PROGRESS | Bind EGP payment plan to frozen exact quote and complete approved provider/manual evidence ingress | Wrong signature/merchant/amount/project fails; browser success cannot manufacture payment. |
| E09.2 | P0 | IN_PROGRESS | Complete partial/out-of-order/reversal/refund/cheque reconciliation, receipts and maker-checker operations | Replays never double-post and finance outputs reconcile exactly to ledger evidence. |

## E10 — Documents, generated contracts and signing

Epic status: IN_PROGRESS

| Task | Priority | Status | Work | Acceptance |
|---|---|---|---|---|
| E10.1 | P0 | IN_PROGRESS | Complete document quarantine/scanning/private access and exact bilingual contract rendering | Exact apartment/price/plan/template data is pinned; scanner/renderer failures fail closed. |
| E10.2 | P0 | IN_PROGRESS | Complete single-use signature challenges, company execution and immutable final evidence | Replay/reordering/revoked signer/mutated object fails; no fake biometric/legal proof. |

## E11 — Full My Property, receipts, updates and support

Epic status: IN_PROGRESS

| Task | Priority | Status | Work | Acceptance |
|---|---|---|---|---|
| E11.1 | P1 | IN_PROGRESS | Complete exact property, finance schedule/receipts and contract/document buyer portal | Displayed money and evidence reconcile to one authoritative snapshot/ledger. |
| E11.2 | P1 | NOT_STARTED | Implement published updates and buyer-scoped support cases with private attachments/SLA | No unrelated buyer/project data leaks and stale requests cannot overwrite another project view. |
| E11.3 | P1 | NOT_STARTED | Implement consented human-advisor inbox/chat and scoped co-browse context | Chat/context/attachments remain buyer/project scoped; no privileged-session, payment or legal-signature takeover; Arabic/English and interruption behavior accepted |

## E12 — Brokerage and developer control rooms

Epic status: IN_PROGRESS

| Task | Priority | Status | Work | Acceptance |
|---|---|---|---|---|
| E12.1 | P1 | IN_PROGRESS | Complete broker/developer control rooms, commissions, grace, collections and operational views | Sensitive economics stay independently redacted and role matrix holds across channels. |
| E12.2 | P1 | IN_PROGRESS | Add server aggregates, cursor paging/filter/sort/export and high-volume/realtime certification | Counts are not derived from capped rows and older cases remain navigable without refetch storms. |
| E12.3 | P1 | NOT_STARTED | Complete demand/funnel/event/pricing governance and source/journey audit controls | KPIs define authoritative numerator/denominator/time scope; overrides require named authority/reason; observed events and reconstructed snapshots are distinguished |

## E13 — Messaging, reminders and delivery lifecycle

Epic status: IN_PROGRESS

| Task | Priority | Status | Work | Acceptance |
|---|---|---|---|---|
| E13.1 | P1 | IN_PROGRESS | Complete verified-contact preferences and Arabic/English provider template/callback lifecycle | Wrong-signature callbacks fail and unverified contacts are never used. |
| E13.2 | P1 | IN_PROGRESS | Handle uncertain external sends, reconciliation, retries/dead-letter and obsolete reminder cancellation | Accepted-but-response-lost does not cause uncontrolled duplicate external sends. |

## E14 — English voice and safe advisory AI

Epic status: IN_PROGRESS

| Task | Priority | Status | Work | Acceptance |
|---|---|---|---|---|
| E14.1 | P1 | NOT_STARTED | Port English ASR/TTS/chat navigation with opt-in, barge-in and text fallback | Audio is user-controlled, accessible fallback works, and primary buying actions remain visible. |
| E14.2 | P1 | IN_PROGRESS | Enforce authorized exact candidates, hard eligibility/currency filters and allowlisted model actions | AI cannot alter price/eligibility/turn/locks/payments/grace/signatures and PII stays out of prompts. |

## E15 — Demo parity and complete browser acceptance

Epic status: IN_PROGRESS

| Task | Priority | Status | Work | Acceptance |
|---|---|---|---|---|
| E15.1 | P1 | IN_PROGRESS | Reconcile demo parity matrix and one coherent Egyptian synthetic EGP dataset | Pages remains synthetic/shareable with no production secrets/PII/provider side effects. |
| E15.2 | P1 | NOT_STARTED | Complete Arabic/English desktop/mobile full production browser journeys and Pages route/deep-link tests | Fixtures seed data only; tested commands perform the real business transitions. |
| E15.3 | P0 | IN_PROGRESS | Deliver complete premium role-specific visual and interaction acceptance | All critical journeys accepted in Arabic/English/mobile/desktop with actual screenshots, keyboard/a11y checks and measured performance; no fake data fallback, hidden primary action or login-only polish |

## E16 — Containers, operations and deployment package

Epic status: IN_PROGRESS

| Task | Priority | Status | Work | Acceptance |
|---|---|---|---|---|
| E16.1 | P0 | IN_PROGRESS | Build non-root images/Compose/migration service plus proxy/TLS/SSE/config/deploy scripts | Documented exact-source isolated package and fresh disposable production-config environment boot; malformed config fails closed; protected n8n/existing PRENEURA remain unchanged. |
| E16.2 | P0 | IN_PROGRESS | Deliver backup/restore/rollback, observability/alerts and artifact/offline installation certification | Coordinated restore verifies DB/identity/object/config evidence and actionable alert paths. |
| E16.3 | P0 | IN_PROGRESS | Deploy and verify a fully isolated public-testing project on the authorized VPS | No edits/restarts to n8n or existing PRENEURA; exact-release schema/readiness and protected-container baselines; genuine provider, bilingual browser/full-journey, private storage/scanner and backup/restore/load acceptance |

## E17 — Final security/load/recovery/software readiness

Epic status: IN_PROGRESS

| Task | Priority | Status | Work | Acceptance |
|---|---|---|---|---|
| E17.1 | P0 | IN_PROGRESS | Run exact-candidate security, authorization, concurrency/load/soak/provider-negative certification | Known security/load/realtime/job/provider failure cases pass on one exact candidate. |
| E17.2 | P0 | IN_PROGRESS | Run restore/rollback/migration rehearsal and freeze exact artifacts/evidence | One exact artifact set is reproducible and all remaining live/deployment dependencies are explicitly registered. |

## E18 — Business launch, customer adoption and service readiness

Epic status: NOT_STARTED

| Task | Priority | Status | Work | Acceptance |
|---|---|---|---|---|
| E18.1 | P1 | NOT_STARTED | Prepare developer/two-brokerage pilot onboarding, training and operating responsibilities | A bounded Egyptian project pilot has documented scope and named responsibilities; real data/money starts only after its applicable release gates, without claiming the full platform done |
| E18.2 | P1 | NOT_STARTED | Complete tenant entitlements, usage and approved B2B invoicing/service policy | Access and usage follow approved tenant entitlements; no unapproved charges, unsupported legal claims or invented contractual/financial acceptance |
| E18.3 | P1 | NOT_STARTED | Define launch KPI evidence, acceptance ownership and support/incident operation | Metrics have real event scope/time windows and measured pilot baselines; owners/alert response and all final production gates are recorded, with no invented ROI or GO |
