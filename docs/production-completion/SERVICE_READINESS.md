# Service readiness ledger

## Current authority — 12 October 2026

The user authorizes only the fully isolated realestate-os-testing VPS project under /opt/realestate-os-testing. Never edit, restart or redeploy n8n or existing PRENEURA. Use independent network/volumes/PostgreSQL18.6/roles/Keycloak26.8.0/private storage/scanner/telemetry. Render is deferred. HTTPS8443 and S3 HTTPS8444 use realestate-test.aipreneura.com and the separate DNS01 certificate. Existing80/443/proxy remain untouched.

Last certified source is schema49 head4b2a6a7857b16571df1ff5d20bf96dfceafd5a4f, with all42 inspected CI runs passing. Its non-root runtime image built on the bounded0.75CPU/2GiB builder, and all49 migrations are applied only to the new database. Independent identity config, atomic/checksum/private S3 and actual ClamAV clean/EICAR/hash/auth checks pass. The rejected Garage candidate is stopped; SeaweedFS4.48 is qualified for the tested operations. The application/edge are not yet deployed.

Current working slice adds physical-byte/immutable-upload protections, real scanner freshness/SSRF controls, separate service environments/DB privileges and honest public-test delivery deferral.63 normal tests,9 package strict checks/builds, actual-DB pause and two English/Arabic mobile UI cases pass locally; publish and certify the new source before rollout. User will supply external delivery credentials later. Keep phone/external delivery paused visibly; do not fabricate success. Human MFA/owner activation, complete product journeys, public S3/SSE, encrypted off-host restore, load/soak and final liveGO remain outstanding. Read WORK_STATE/TASKS/VPS_DEPLOYMENT and ADR-VPS-STORAGE-AND-PROVIDER-DEFER first; retain the entire PLAN.

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
