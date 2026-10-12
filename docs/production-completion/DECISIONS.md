# Accepted decisions and current authority

## Current authority — 12 October 2026

The active target is only the isolated realestate-os-testing project under /opt/realestate-os-testing. Existing n8n and PRENEURA containers, databases, identity realms, networks and ports80/443 are protected. All12 protected container IDs/start times/restart counts were rechecked and remain unchanged. Render is deferred.

Public testing is live at https://realestate-test.aipreneura.com:8443/login. API, worker and frontend run exact source49de56fadf4caab1242fe0783285792ba58d5f0b; all45 inspected GitHub runs passed. Public /healthz reports ready, matching source and schema49/minimum49/marker0049_reviewed_identity_enrollment. Independent PostgreSQL18.6, Keycloak26.8.0, qualified SeaweedFS4.48, authenticated real ClamAV scanner and redacted telemetry are running. S3 uses separate HTTPS8444.63 local normal tests,9 package strict checks/builds, real-DB delivery-pause and English/Arabic mobile UI cases passed.

Fresh GitHub/Railway/Render reconciliation confirms this is the latest realestate completion head. Railway realestate staging has0 services/0 deployments; its separate platform-core preview has newer failed frontend attempts and last successful source86facdb. Those distinct commerce/support/automation branches were not copied into realestate. Render Preneura returned no services and no PostgreSQL databases; no hosted Render application snapshot is available. PR91 is an older divergent deployment alternative, not the full Egypt candidate. See evidence/hosting-source-reconciliation-20261012.json.

Current operational patch fixes the antivirus image startup requirement for a local socket, adds an explicit real PING health check, bounds signature-reload memory and completes the redacted OTLP logs pipeline. Genuine clean/EICAR/hash/auth certification passed after the isolated scanner rollout. Phone sign-in/external delivery remain visibly paused in public-test until the user supplies provider credentials. No synthetic successful delivery or fabricated AAL2 owner session is allowed.

Human MFA/owner activation, authenticated public S3/SSE/browser journeys, TLS renewal automation, encrypted off-host restore, full product completion, load/soak and final liveGO remain outstanding. This is public testing, not approved full production. Read WORK_STATE/TASKS/VPS_DEPLOYMENT and retain the entire PLAN.

## Product and deployment decisions

- Egypt first: developers and brokerages with the full buyer experience.
- EOI selects apartment type; allocation selects one exact eligible available physical apartment.
- Arabic/English UI and English voice are launch scope; Arabic voice is later.
- All source, plans, checkpoints, tests and deployment definitions belong in GitHub.
- GitHub Pages remains a shareable synthetic demo/training surface.
- Current public testing uses only the isolated authorized VPS project; Render is deferred and Railway is not required.
- Existing n8n and PRENEURA projects must never be edited/restarted/redeployed or used as database/identity/storage dependencies.
- Own HTTPS8443 and signed-storage HTTPS8444 use realestate-test.aipreneura.com; existing80/443/proxy remain untouched.
- Real delivery credentials are deferred at user instruction; build/test integration and visibly pause unsupported public-test paths.
- No paid purchases, unapproved provider contracts or real customer-data migration are implied.
- Premium role-specific Arabic/English/mobile UX is required across full journeys, with measurable accessibility/visual/performance acceptance.
- Continue resumes WORK_STATE/TASKS/PLAN/PRODUCTION_GAP_AUDIT without re-asking settled decisions.

Current live counts are0 tenants/projects/users/transactions; first genuine MFA owner and application onboarding are immediate acceptance needs. Full production requires all product, provider, operations, UAT and business gates. Record later merchant, domain/signature/legal policy and service-owner inputs only when needed; routine technical choices use ADRs.
