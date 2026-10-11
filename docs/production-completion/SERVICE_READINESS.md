# Service readiness ledger

Latest local implementation advances to **schema46** (0046_eoi_apartment_type_choice.sql): required apartment-type EOI, immutable type/policy acceptance, safe concurrent retries, scoped summaries and bilingual staff selection are locally certified. The cited schema45 CI snapshot remains the inspected prior exact head; schema46 exact-head CI is pending publication. Public buyer eligibility/payment and exact-unit allocation remain open.

Candidate authority: PR #90, codex/egypt-platform-completion; inspected application head e8f5216e0964be01b2f2aa754944df9423c390da, schema45. See CURRENT_STATUS_AND_CONTINUATION.md and evidence/current-reconciliation.json. LIVE_VERIFIED always requires real target/provider evidence.

| Service | Implemented/tested software | Remaining product or live acceptance |
|---|---|---|
| Next web | Locale/critical auth + developer onboarding, role workspaces, 32-workflow candidate matrix | Public visual buyer journey, exact-unit UX, all-role Arabic/RTL, contract/after-sales/UAT; no verified live realestate web |
| API | Scoped domains, AAL2/lifecycle/SSE, identity43, developer44, brokerage45 | Selected-type EOI/exact unit/grace/contract/support/provider and final acceptance; no live realestate API |
| Worker | Durable DB outbox/replay/reminders/expiry, schema checks, concurrency/fullstack | New workflows/recovery and final staging operations; no realestate worker deployed |
| Notification gateway | Token boundary, contact encryption/templates/idempotency/retries | Actual approved bilingual Meta/SMS channels/callbacks/uncertain sends |
| PostgreSQL | 45 append-only migrations; readiness/provenance; CI restore and domain certification | Final migration/load/PITR/restore/release rehearsal on selected target; Railway preview PG16 belongs to platform-core |
| Identity/Keycloak | OTP/OIDC/PKCE/privileged AAL2, identity and consent/recovery | Actual realestate realm/client/Google/AAL2/recovery verification; separate preview Keycloak deployment is not product proof |
| Object storage/scanner | Private upload/trust/hash/type/size/scanner authority | Two Railway staging buckets exist; candidate end-to-end access/CORS/scan/retention/restore unverified |
| Contract renderer/signing | Templates/requirements/signatures/executed evidence | Populated exact-unit bilingual PDF, single-use hash/signer-bound challenges, accepted legal/provider process |
| Payments/refunds/settlement | Immutable ledger, replay/partial/reversal/refund/cheque/settlement certifications | Egypt provider or explicit controlled manual maker-checker process, real disbursement/reconciliation/receipts |
| AI/voice | Advisory deterministic/optional external AI; demo voice source | Integrated authorized exact-candidate English voice/text product and provider/runtime tests |
| Deployment/operations | Compose/Nginx reference certification, logs/OTel/backup/concurrency | One hosting choice and exact candidate profile, real TLS/DNS/telemetry/alerts/restore/rollback/on-call |
| Railway | Inspected realestate staging: 0 app services/0 deployments, 2 buckets | Existing successful app preview is platform-core, not this repo; realestate live integration unverified |
| Render | PR91 Blueprint/runbook/schema gate on older runtime branch | Regenerate/certify from final PR90 candidate; connected live workspace not inspected |
| GitHub Pages | Main synthetic demo preserved | Egyptian coherent fixtures/final parity/Arabic/desktop/mobile; never runtime money/identity authority |

## External dependencies

PROVIDER_SETUP_PENDING: actual identity, storage/scanner, messaging templates/channels, merchant/refund/settlement and any e-sign/voice credentials/acceptance.
HOSTING_SELECTION_PENDING / LIVE_DEPLOYMENT_PENDING: public platform is the final goal; current work does not access the reserved self-hosted server or create paid resources. Railway/Render are profiles until one accepted environment is certified.
INDEPENDENT_REVIEW_PENDING: security/finance/signature/legal and final launch acceptance.

No fabricated live GO; DEVELOPMENT manifest must be frozen only for final accepted artifacts. CI structural Gate7 success is distinct from live Gate7.
