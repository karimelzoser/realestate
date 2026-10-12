# Service readiness ledger

## Current authority — 12 October 2026

The active target is only the isolated realestate-os-testing project under /opt/realestate-os-testing. Existing n8n and PRENEURA containers, databases, identity realms, networks and ports80/443 are protected. All12 protected container IDs/start times/restart counts were rechecked and remain unchanged. Render is deferred.

Public testing is live at https://realestate-test.aipreneura.com:8443/login. API, worker and frontend run exact source49de56fadf4caab1242fe0783285792ba58d5f0b; all45 inspected GitHub runs passed. Public /healthz reports ready, matching source and schema49/minimum49/marker0049_reviewed_identity_enrollment. Independent PostgreSQL18.6, Keycloak26.8.0, qualified SeaweedFS4.48, authenticated real ClamAV scanner and redacted telemetry are running. S3 uses separate HTTPS8444.63 local normal tests,9 package strict checks/builds, real-DB delivery-pause and English/Arabic mobile UI cases passed.

Fresh GitHub/Railway/Render reconciliation confirms this is the latest realestate completion head. Railway realestate staging has0 services/0 deployments; its separate platform-core preview has newer failed frontend attempts and last successful source86facdb. Those distinct commerce/support/automation branches were not copied into realestate. Render Preneura returned no services and no PostgreSQL databases; no hosted Render application snapshot is available. PR91 is an older divergent deployment alternative, not the full Egypt candidate. See evidence/hosting-source-reconciliation-20261012.json.

Current operational patch fixes the antivirus image startup requirement for a local socket, adds an explicit real PING health check, bounds signature-reload memory and completes the redacted OTLP logs pipeline. Genuine clean/EICAR/hash/auth certification passed after the isolated scanner rollout. Phone sign-in/external delivery remain visibly paused in public-test until the user supplies provider credentials. No synthetic successful delivery or fabricated AAL2 owner session is allowed.

Human MFA/owner activation, authenticated public S3/SSE/browser journeys, TLS renewal automation, encrypted off-host restore, full product completion, load/soak and final liveGO remain outstanding. This is public testing, not approved full production. Read WORK_STATE/TASKS/VPS_DEPLOYMENT and retain the entire PLAN.

| Service | Verified current implementation | Remaining acceptance |
|---|---|---|
| Next web/API/worker | Public test49de56f, schema49, exact apartment/type EOI foundations, reviewed MFA, scoped operations and durable jobs | Full buyer/role/Arabic journeys, human owner/UAT and live production release |
| PostgreSQL | Separate18.6,49 append-only migrations, distinct restricted API/worker/gateway/migrator/identity roles | Off-host restore/PITR, final migration rehearsal and load |
| Identity | Separate Keycloak26.8.0 realm/client, PKCE/password+OTP/LoA configured, public discovery verified | Genuine human MFA, first-owner offline approval and recovery |
| Storage/scanner | Separate SeaweedFS4.48 conditional create/checksum/private checks; genuine ClamAV clean/EICAR/hash/auth recertified | Public browser signed upload/read/CORS, retention and restore |
| Notification gateway | Strict real-provider integration prepared; not started without credentials | User supplies credentials; approved templates/callbacks/uncertain sends |
| Phone/external delivery | Explicitly paused and disclosed only in public-test; real-DB pause certification | Real provider sandbox and production acceptance |
| Contracts/payments | Immutable evidence/ledger and domain certifications | Populated bilingual PDF, single-use signing challenges and Egypt merchant/manual maker-checker acceptance |
| AI/voice | Advisory foundation | Authorized English voice opt-in/VAD/ASR/TTS/recovery/text fallback |
| VPS edge/telemetry | Separate8443/8444 TLS, API health and OIDC discovery; redacted traces/metrics/log pipeline | Automated TLS renewal, persistent monitoring/alerts, soak/restore/rollback/on-call |
| Railway | Fresh inventory: realestate staging empty; platform-core preview separate, newest attempts failed | No migration of separate application or its data authorized |
| Render | Fresh Preneura inventory returns no services or PostgreSQL; optional profile in source | Deferred; no live deployment claimed |
| GitHub Pages | Synthetic main preserved | Demo parity; never transactional authority |

External credentials, human owner enrollment, independent review and the remaining PLAN are explicit dependencies. No live production GO is claimed.
