# Service readiness ledger

## Current authority — 12 October 2026

The user now authorizes the VPS deployment and explicitly defers Render. Use only /opt/realestate-os-testing, project realestate-os-testing, and a separate PostgreSQL18.6/database/identity/storage/volumes/network. Never edit, restart or redeploy n8n or the existing PRENEURA project. Full isolation is selected: HTTPS8443 at realestate-test.aipreneura.com; no existing Traefik network or ports80/443. Read VPS_DEPLOYMENT.md and evidence/vps-inventory.json. Private PG is healthy and all12 existing container baselines are unchanged; DNS A and a valid certificate are prepared. Public application services are not yet deployed.

Published schema48 head febcee5f53e5e18644e4eb4f72fa7fef1a4be14b passed all42 inspected GitHub CI runs. Local schema49 adds reviewed staff MFA enrollment, issuer/nonce/freshness checks and one-shot offline owner bootstrap; real DB/signed-IdP/bootstrap certifications, 48 normal tests and nine-package types/lint/frontend build pass. Publish and reverify this new candidate before claiming hosted readiness. EOI chooses apartment TYPE; allocation chooses the exact apartment. Arabic/English UI and English voice remain the agreed scope. Full product/provider/backup/load/live acceptance is still required.

Earlier hosting/status descriptions below are historical and are superseded by the authority above. Preserve their evidence dates; use WORK_STATE for the unfinished current task.


Published schema47 candidate `47b9eb5df7680b0c30ff03a39388539a135dac70`, PR90, passed all39 inspected GitHub runs including actual English/Arabic production-browser reservation. The new Render profile is in local preparation;40 normal tests, production guards, schema validation, local process-loss certification and same-origin browser/SSE checks pass. LIVE_VERIFIED requires real hosted/provider evidence.

| Service | Implemented/tested software | Remaining product or live acceptance |
|---|---|---|
| Next web | Locale/critical auth + developer onboarding, role workspaces, schema47 certified exact selection and immutable quote/reservation UX | Public visual buyer journey, master-plan/online allocation, all-role Arabic/RTL, contract/after-sales/UAT; no verified live realestate web |
| API | Scoped domains, AAL2/lifecycle/SSE, identity43, developer44, brokerage45 | Public buyer eligibility/payment, master-plan/online allocation, grace/contract/support/provider and final acceptance; no live realestate API |
| Worker | Durable DB outbox/replay/reminders/expiry, schema checks, concurrency/fullstack | New workflows/recovery and final staging operations; no realestate worker deployed |
| Notification gateway | Token boundary, contact encryption/templates/idempotency/retries | Actual approved bilingual Meta/SMS channels/callbacks/uncertain sends |
| PostgreSQL | 47 append-only migrations; readiness/provenance; CI restore and domain certification | Final migration/load/PITR/restore/release rehearsal on selected target; Railway preview PG16 belongs to platform-core |
| Identity/Keycloak | OTP/OIDC/PKCE/privileged AAL2, identity and consent/recovery | Actual realestate realm/client/Google/AAL2/recovery verification; separate preview Keycloak deployment is not product proof |
| Object storage/scanner | Private upload/trust/hash/type/size/scanner authority | Two Railway staging buckets exist; candidate end-to-end access/CORS/scan/retention/restore unverified |
| Contract renderer/signing | Templates/requirements/signatures/executed evidence | Populated exact-unit bilingual PDF, single-use hash/signer-bound challenges, accepted legal/provider process |
| Payments/refunds/settlement | Immutable ledger, replay/partial/reversal/refund/cheque/settlement certifications | Egypt provider or explicit controlled manual maker-checker process, real disbursement/reconciliation/receipts |
| AI/voice | Advisory deterministic/optional external AI; demo voice source | Integrated authorized exact-candidate English voice/text product and provider/runtime tests |
| Deployment/operations | Compose/Nginx reference certification, logs/OTel/backup/concurrency | Render testing selected; final durable production profile, real TLS/DNS/telemetry/alerts/restore/rollback/on-call |
| Railway | Inspected realestate staging: 0 app services/0 deployments, 2 buckets | Existing successful app preview is platform-core, not this repo; realestate live integration unverified |
| Render | Current root free public-test Blueprint, same-origin proxy, supervised co-located processes and schema/CI certification | Latest profile CI and actual target/provider/HTTPS/memory verification; Render tools still unavailable in session |
| GitHub Pages | Main synthetic demo preserved | Egyptian coherent fixtures/final parity/Arabic/desktop/mobile; never runtime money/identity authority |

## External dependencies

PROVIDER_SETUP_PENDING: actual identity, storage/scanner, messaging templates/channels, merchant/refund/settlement and any e-sign/voice credentials/acceptance.
RENDER_CONNECTION_PENDING / LIVE_DEPLOYMENT_PENDING: GitHub + Render public testing is authorized now. Connect the Render account and verify actual environment/providers. No paid purchase is authorized; the self-hosted server remains deferred.
INDEPENDENT_REVIEW_PENDING: security/finance/signature/legal and final launch acceptance.

No fabricated live GO; DEVELOPMENT manifest must be frozen only for final accepted artifacts. CI structural Gate7 success is distinct from live Gate7.
