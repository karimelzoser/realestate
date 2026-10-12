# Production completion progress

## Checkpoint — E01.3 implemented, exact-head certification pending

Date: 11 October 2026.

### Verified authority

- Canonical completion track remains `completion/egypt-full-platform` with focused stacked task branches.
- Published `main` / GitHub Pages demo remains unchanged.
- E01.1 is implemented and exact-head certified in PR #86 (`task/e01-tenant-lifecycle`).
- E01.2 is implemented and exact-head certified in PR #87 (`task/e01-session-stream-revocation`).
- E01.3 is implemented in PR #89 (`task/e01-privileged-assurance`) and remains draft until the complete exact-head release matrix passes.

### Completed / verified task IDs

- **E00.1 — INTEGRATED:** repository authority reverified and canonical completion branch created.
- **E00.2 — INTEGRATED:** interruption-safe task ledger and resume controls persisted.
- **E01.1 — VERIFIED:** direct API authorization centrally enforces tenant, membership and project lifecycle state with explicit paused/historical-read policy.
- **E01.2 — VERIFIED:** project, broker and user-notification SSE streams revalidate active session and scope during long-lived connections; revoked sessions, suspended memberships/broker access and expired support access terminate promptly with `access_revoked`.
- **E01.3 — IMPLEMENTED:** privileged assurance/step-up, release/build identity pinning and truthful non-empty quality commands are implemented; exact-head cross-gate evidence is still pending.

### E01.3 implementation

The E01.3 branch now provides:

- server-side session assurance levels (`AAL1` / `AAL2`);
- OTP login fixed at AAL1, including a PostgreSQL guard against OTP-created AAL2 sessions;
- OIDC AAL2 derived only from validated ID-token ACR/AMR evidence;
- centralized privileged-role step-up enforcement for PRENEURA Super Admin, Operations Director, Manager, Allocator, Transaction Operator, Broker Manager and Broker Finance;
- Buyer and Broker Agent remaining valid AAL1 roles;
- step-up identity linking bound to the current recent PRENEURA session;
- bidirectional uniqueness for provider subject / PRENEURA user identity ownership;
- emitted build identity plus production expected-release SHA readiness enforcement;
- root `pnpm test` and `pnpm lint` quality contracts that reject missing/empty mandatory suites and invalid placeholder test commands;
- focused assurance tests and PostgreSQL E01 negative/positive certification.

### Evidence already obtained

Functional head `b5327a716628c88d8ddcff30a6d5803222a61c8f` passed:

- E01 Privileged Assurance Certification
- Production Platform Foundation
- Full Stack Acceptance Certification
- Gate 4-5 Product Parity Certification
- Gate 6 Non-Functional Certification
- Gate 4 Integrated Finance Certification
- Gate 2 Pricing Certification
- Gate 2 Inventory Lock Durability Certification
- Gate 3 Document & Contract Trust Certification
- Gate 3 Finance Ledger Certification
- Gate 5 Buyer / Sales / Transaction Operator / Manager / Broker / Full Role Parity certifications
- Release Dependency Reproducibility
- HTTP Security Certification
- Backup Restore Certification
- Concurrency Certification

That same head exposed secondary failures in Runtime Readiness, Observability, Gate 6 Security, Gate 5 Reception/Allocator and Gate 7. Follow-up commits repaired those areas and refreshed the patched dependency lockfile.

The resulting bot-authored lockfile head `a68e3bd835c628811368775889659b2d16fe46f4` produced `action_required` pull-request workflow records with zero jobs. Those records are not accepted as verification evidence.

### Current exact-head action

A normal user-authored checkpoint commit now follows the bot lockfile commit specifically to retrigger the exact-head matrix. E01.3 must not be promoted to TESTED/VERIFIED and E02 must not start until the required workflows execute and pass on the same current head.

Required completion evidence:

- E01 Privileged Assurance Certification
- Production Platform Foundation
- Full Stack Acceptance Certification
- Gate 6 Security Scan
- Gate 6 Non-Functional Certification
- Gate 7 Production Go-No-Go software-side path

Additional inherited gates that trigger on the current head must remain green; failures are repaired rather than waived.

### Deployment boundary

Server deployment remains intentionally deferred. No server, DNS, production secrets, live provider credentials or production customer data are part of E01.3 certification.

### Exact next action

Monitor the user-authored E01.3 checkpoint head until its release workflows complete. If all required exact-head checks pass, update `TASKS.json`, `TASKS.md`, `WORK_STATE.json`, `PROGRESS.md` and `CONTINUE.md` to mark E01.3 tested/verified and begin E02.1/E02.2 from the certified E01.3 head. If any check fails, repair that failure on the same focused E01.3 branch and rerun; do not advance the dependency graph prematurely.

## Codex takeover — 11 October 2026

Working branch: codex/egypt-platform-completion, based on PR #89 with the existing PR #85 deployment/provenance line merged for integration. E01 source/runtime and packaging work are being validated together. Fixed first-factor linking for privileged step-up, file-read race, stale schema checks and deployment workspace/config omissions. Added five identity-enrollment and three runtime-contract regressions. Remote runtime/deployment and real DB checks remain pending; no production GO is claimed. Server access/deployment remains excluded.

### E01 verified; E02 active

Exact head 1e1b85f38684e7f107ede0d3db9cfeae73d86836 passed all 28 GitHub workflows, including CodeQL, E01, emitted full stack, container/provenance and Gate 7 software preflight. All 42 migrations applied to a fresh disposable PostgreSQL 18.6 database locally; FULL_STACK_ACCEPTANCE_OK including revocation/privileged-role change. Four runtime and ten API unit regressions passed. No live GO/provider/server claim. Active task now E02.1.

## Schema45 candidate reconciliation and public-production continuation

Reviewed PR90 e8f5216e0964be01b2f2aa754944df9423c390da: 32 distinct workflows success (33 runs). Reused identity43, developer44, brokerage45 and locale/auth foundations; did not duplicate them. Updated task/control/feature/service ledgers from actual code. Railway read-only inventory confirms realestate staging has two buckets and zero services/deployments; active app preview is platform-core on a separate PG16 topology. Render PR91 is an older-base deployment profile; fresh live inventory is unavailable and remains unverified. No provider/hosting changes, merge or live deployment performed.

Next acceptance: E05.2 required immutable chosen apartment type on EOI, then exact physical allocation and evidence propagation. Original unfinished pre-sync localization expansion is preserved in a named git stash for selective reuse with the canonical locale provider.

## Selected apartment-type EOI slice — schema46

Added required type and explicit accepted refund policy to EOI API, immutable server-derived choice/terms/actor/time evidence, type/project/status/current-policy validation, concurrent retry returning one EOI/event, scoped list/buyer summaries and bilingual staff selection/policy review. EOI holds no inventory. Schema minimum46 requires coordinated migration/runtime rollout. Updated affected fixtures to choose their own type explicitly; accepted policy terms cannot be rewritten.

Local verification: 26 normal tests, strict package checks and all apps/Next production build; zero-to46 and42-to46 migrations on disposable PostgreSQL18.6; real-repository positive/negative/concurrent certification; pricing/documents/finance/current-settlement/allocator/identity/onboarding/lock regression; dedicated contention/replay certification; emitted full-stack acceptance with EOI HTTP ownership/missing-type/scoped read checks. An obsolete direct-refund script expected a function removed by migration39; its compatibility entry point now runs canonical settlement certification. A brokerage test pinned schema45 instead of accepting later compatible schemas; corrected without bypassing the actual brokerage boundary tests.

Exact-head CI and browser acceptance are pending at this checkpoint. Public EOI payment/identity-eligibility UX and exact-apartment allocation are still open; no full-product/live GO claim.

Follow-up security acceptance E01.4 added from code inspection: SessionAuthGuard enforces authentication/assurance but has no explicit trusted-Origin/CSRF validation for unsafe bodyless routes. Signed cookies/CORS/SameSite alone require selected-topology browser verification. Close this before final hosted release; it does not invalidate the previously tested lifecycle/assurance boundaries.

## Trusted origin mutation protection

Global HTTP protection now rejects untrusted/malformed browser Origins on unsafe requests and requires a trusted Origin or Referer for session-cookie mutations, including bodyless routes. Provider/machine requests retain bearer/signature authorization. Four additional tests exercise real Fastify handlers and header edge cases; emitted full-stack checks show hostile/missing-Origin logout cannot revoke a valid session. Local strict type/lint/API build and30 normal tests pass. The selected hosted browser cookie/login/SSE topology still needs UAT; Lax host-only cookies are preserved.

Git CLI credential cache expired during CI fix publication. Used the connected GitHub account with expected-head checks to publish df ae90e/36941e7 (canonical LF source tree equal to saved local9202e6f); preserved local commit on backup branch and aligned the clean candidate before restoring the named work stash. No force push or work loss.

## Sales certification alignment

Schema46/Origin candidate a3583bd passed34 of35 CI runs; the remaining Sales certificate still called createEoi with the old missing-type/policy shape. Updated the synthetic Sales fixture and real service certificate to choose an explicit type and accepted policy, with chosen-type summary assertions. Local Sales onboarding/encrypted contact/role finance-separation certificate now passes. Staff can record an unpaid prospect EOI while enrollment remains pending; this neither activates account access nor holds inventory. Exact allocation will enforce the paid EOI and eligible active buyer/session boundary.

## Exact apartment allocation and Render testing continuation

Schema47 draft adds immutable apartment quotes, scoped building/floor/apartment paging, requested-slot locks and replay keys, exact reservation identity, original accepted price retention, eligibility revalidation at conversion, property/transaction/export identity and hash-bound executed-contract manifest v2. Real PostgreSQL18 certification passes requested-apartment races, no substitution, changed-price rejection, terminal retries, expiry rejection, revoked buyer and immutable evidence. All34 normal tests and9 package strict type/lint checks pass. English desktop/Arabic390px RTL browser test passes selection, accepted quote, hold, refresh and actual reservation with unchanged physical identity and price. New GitHub workflow captures browser screenshots. Live provider/production UAT remains open.

Latest user authorizes GitHub + Render public testing and preparation of both. Render plugin is installed/enabled but no MCP tools are available in this session; no CLI/key is present. Account reconnection/reload pending. No resources purchased or self-hosted server accessed.

## Render public testing profile prepared

Root free Blueprint targets PR90 branch, with controlled deploys, private PG18 and same-origin browser proxy. Co-located worker and local token-protected gateway terminate with API on child loss; fresh empty DB bootstrap is permitted but an existing schema mismatch requires offline migration. Real Windows process fault check passes; Linux CI must prove graceful drain.40 normal tests,9 package types/lint, official schema validation and production secret guards pass. English/Arabic390px browser checks pass quote/hold/refresh/reservation plus20-second SSE heartbeat through the proxy and visible public-test notice. Missing identity/recovery secrets now fail production startup and are wired into native/portable profiles. Provider/live readiness remains unverified; no Render resource created.

## Render memory correction before publication

Measured first four-process host at517947392bytes (~494MiB), leaving inadequate initial headroom on a512MiB free instance. Replaced it with one Node host importing the unchanged service modules/authorization boundaries and one telemetry runtime; measured197726208bytes (~189MiB) after readiness. Real abrupt host-loss and occupied-API-port startup failure tests pass with no remaining component; separate production service entry points remain available. Linux signal drain and actual Render load capacity still require their own evidence.
