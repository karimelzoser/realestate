# PRENEURA — verified status and public-production completion brief

Latest local implementation advances to **schema46** (0046_eoi_apartment_type_choice.sql): required apartment-type EOI, immutable type/policy acceptance, safe concurrent retries, scoped summaries and bilingual staff selection are locally certified. The cited schema45 CI snapshot remains the inspected prior exact head; schema46 exact-head CI is pending publication. Public buyer eligibility/payment and exact-unit allocation remain open.

## Authority

Continue from `codex/egypt-platform-completion`, draft [PR #90](https://github.com/karimelzoser/realestate/pull/90), not `main`. Inspected application head: `e8f5216e0964be01b2f2aa754944df9423c390da`. Runtime schema **45**, marker `0045_brokerage_b2b_onboarding.sql`; Node 24, pnpm 12.9.1, PostgreSQL 18. Recheck remote HEAD before each continuation and preserve concurrent/uncommitted work.

The inspected head has **32 distinct successful CI workflows** (33 successful runs including a duplicate push certification). This certifies the implemented candidate and reference topology; it does not certify every remaining product requirement or an actual public deployment. The final live Gate 7 job has not run. Release manifest remains `DEVELOPMENT`.

## Product goal and accepted boundaries

Deliver a public, integrated Egypt platform for developers, brokerages and buyers. EOI chooses **apartment type**; allocation chooses the **exact eligible available physical apartment**. Arabic/English UI and documents, English voice initially. A buyer must retain the same apartment identity through reservation, transaction, finance, contracts, commissions and My Property. PostgreSQL is the authority for business state, money and inventory. AI remains advisory. National ID is an identifier, never a password. Broker Agents never receive commission amounts/rates/bases.

Source, tests, plan, checkpoints and deployment definitions stay in GitHub. GitHub Pages remains a synthetic demonstration. The existing self-hosted server is reserved for later; it is not accessed or configured during current implementation. Railway and Render are deployment options to assess, not evidence that this application is already live. No merge, infrastructure purchase or live cutover is implied by this brief.

## What exists and should be reused

- Identity/security: OTP/OIDC/PKCE, hashed sessions, AAL2 privileged boundary, lifecycle checks, tenant/project/broker/buyer scope, stream revocation, support expiry and release identity.
- Egypt identity: migration 43, localized digit/phone/ID/passport normalization, consent/evidence records and scoped recovery; provider identity truth is separate from phone verification.
- Locale: English/Arabic provider, direction, Cairo/EGP formatting and translated critical login/verification/pending-access pages. Broad operational localization is incomplete.
- Onboarding: migration 44 developer/project branding, constrained first Operations Director enrollment, lifecycle/readiness/audit and bilingual developer UI; migration 45 independent brokerage organizations, multi-developer links, agreements/access and attribution-transfer authority. B2B UI/UAT remains partial.
- Commercial/sales: hierarchy, physical units/slots, assets/import previews/lineage/rollback, versioned area pricing, frozen quotes; buyer profiles, EOI policies/refunds, queue/allocator assignment, atomic type/slot locks, expiry, reservations, transactions and milestones.
- Finance/documents: immutable finance postings/allocations/replays/reversals/refunds/cheque history, settlement authority; private object/trust/scanner boundaries, templates, signer order and immutable execution evidence. Live provider and populated contract generation acceptance remain incomplete.
- Operations: staff/broker/manager/director/admin/property workspaces, scoped exports, commissions/redaction/countdowns, notifications/outbox/SSE/reminders, optional deterministic/advisory AI, observability/backup/concurrency/full-stack/reference-container certifications.

Do not recreate these domains because an old task file says `NOT_STARTED`. Existing implementation is now recorded in `TASKS.json`; a partly implemented epic remains open until its full acceptance is met.

## Railway: inspected account state

`preneura-re-gate7-staging` has a staging environment with **zero app services, zero deployment records and two storage buckets**. It cannot currently serve this platform.

`preneura-platform-preview` has a running `platform-preview` service sourced from **`karimelzoser/platform-core`**, not `realestate`. Latest inspected preview deployment: `86facdbfe89b69d6859cabed9c670f9471bdf62a`. Keycloak, Temporal, NATS and a pgvector PostgreSQL **16** service are also present. Their service deployment status is not acceptance evidence for the schema-45 realestate candidate. Do not adopt or upgrade that shared database blindly; it belongs to a different application and differs from this candidate's PostgreSQL-18 contract.

The evidence snapshot records non-secret IDs/statuses. No Railway services, variables, buckets, domains or deployments were changed. Hosting bills/resource quotas and connector usage are separate constraints; switching away from MCP does not remove hosting costs or limits.

## Render: repository profile, not a verified live deployment

Draft [PR #91](https://github.com/karimelzoser/realestate/pull/91) at `1bb7cf650baeed781f598e8c2a9d17e04299ceb9` adds a Frankfurt Blueprint for Next web, API, worker, notification gateway and managed PostgreSQL 18. It is stacked on `feature/production-runtime-readiness`, **not PR #90**. Its public deployment package cannot be treated as the complete Egypt candidate.

The Render workspace's live state is **unverified in this inspection**; no connected Render inventory or authenticated target session was available. The PR's statement that the workspace is empty is not fresh independent evidence.

Before adopting the profile, regenerate it from the final candidate and certify actual runtime requirements: AAL2/identity/recovery secrets, source/build/schema identity, storage/scanner, messaging channels/templates, callback/cookie/CORS behavior, orderly explicit migration and worker rollout, observability and rollback. Do not assume generated encryption material has the required byte length/encoding. Do not assume a configured SMS OTP channel works when only WhatsApp credentials are supplied. Independent auto-deploys must not allow a worker/API schema mismatch.

Render free Postgres expires after 30 days and background workers have no free compute plan. Free hosting is therefore unsuitable as a durable full-platform production promise. See [Render free limits](https://render.com/docs/free), [workers](https://render.com/docs/background-workers) and [Blueprint reference](https://render.com/docs/blueprint-spec). Preserve a portable Compose package while a single staging/production hosting path is selected later.

## Completion sequence

1. **Current slice:** require and freeze apartment-type selection on every new EOI; expose chosen type, policy/payment status and eligibility. Existing EOIs with no selected type require explicit remediation; never guess a type or allocate them silently.
2. Exact apartment allocation: project/master plan/building/floor/unit, original EOI type and session eligibility, exact quote/version, atomic requested-unit lock and idempotency. No type-only or anonymous substitute for the accepted journey. Propagate identity through all evidence/read models.
3. Public acquisition/discovery: registration/consent/recovery, visuals/amenities, type browse, favorites/preferences/compare, broker/direct attribution and interrupted-journey recovery.
4. Buyer shared queue/online handoff and allocator capacity, private live updates and truthful estimates.
5. Grace/extension/offline exception: decisions/inbox/countdowns; expired locks release inventory; pending requests retain no hold; late approval cannot steal another buyer's unit. Certify races.
6. Complete Arabic/English/RTL and exact decimal/Cairo displays alongside each changed journey, then audit all roles and responsive breakpoints.
7. Real populated immutable Arabic/bilingual PDF rendering and single-use signer/hash-bound challenges; company sign/stamp/execution. Legal/provider acceptance must be explicit and evidence-backed.
8. My Property: exact visual details, plans/documents/contracts/receipts, balances/installments/cheques/timeline, updates and private support cases.
9. Broker/manager/director command centers and Buyer360; paged/filtered aggregates and scoped exports.
10. Notifications/preferences/approved bilingual templates/callbacks/uncertain-send recovery; English voice with opt-in, VAD/ASR/TTS/barge-in/recovery/text fallback and allowlisted advisory actions.
11. Selected provider adapters and real sandbox certification: OIDC/AAL2, storage/scanner, messaging, Egypt payments/refunds/settlement and observability. Separate code-ready from provider-verified.
12. Cross-role Arabic/English mobile/desktop UAT, security/concurrency/load/soak/restore/rollback; consolidate one release and deployment profile. Controlled staging and final public cutover happen only with actual environment, approved costs/ownership and traceable provider evidence.
13. Freeze exact artifacts/release manifest and execute live Gate 7. Only a real **GO** plus completed product/UAT acceptance supports “public production approved.”

## Continue procedure

Read `WORK_STATE.json`, `TASKS.json`, this brief, `PLAN.md`, `DECISIONS.md`, `SERVICE_READINESS.md` and `PROGRESS.md`. Fetch/inspect remote and local differences before coding. Resume the recorded unfinished acceptance slice. Preserve append-only migrations, ledger/evidence, scoped authorization and mandatory gates. Commit focused, reviewable changes with tests and update the checkpoint. Do not stop for routine implementation choices or ask the user to repeat settled decisions. Record actual external dependencies without fabricating evidence or substituting a demo.

Current state: **automated production candidate with incomplete product and live-integration acceptance**. Final goal: **public production full integrated realestate platform**.
