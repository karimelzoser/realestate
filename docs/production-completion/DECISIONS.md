# Accepted user decisions

## Current authority — 12 October 2026

The user authorizes only the fully isolated realestate-os-testing VPS project under /opt/realestate-os-testing. Never edit, restart or redeploy n8n or existing PRENEURA. Use independent network/volumes/PostgreSQL18.6/roles/Keycloak26.8.0/private storage/scanner/telemetry. Render is deferred. HTTPS8443 and S3 HTTPS8444 use realestate-test.aipreneura.com and the separate DNS01 certificate. Existing80/443/proxy remain untouched.

Last certified source is schema49 head4b2a6a7857b16571df1ff5d20bf96dfceafd5a4f, with all42 inspected CI runs passing. Its non-root runtime image built on the bounded0.75CPU/2GiB builder, and all49 migrations are applied only to the new database. Independent identity config, atomic/checksum/private S3 and actual ClamAV clean/EICAR/hash/auth checks pass. The rejected Garage candidate is stopped; SeaweedFS4.48 is qualified for the tested operations. The application/edge are not yet deployed.

Current working slice adds physical-byte/immutable-upload protections, real scanner freshness/SSRF controls, separate service environments/DB privileges and honest public-test delivery deferral.63 normal tests,9 package strict checks/builds, actual-DB pause and two English/Arabic mobile UI cases pass locally; publish and certify the new source before rollout. User will supply external delivery credentials later. Keep phone/external delivery paused visibly; do not fabricate success. Human MFA/owner activation, complete product journeys, public S3/SSE, encrypted off-host restore, load/soak and final liveGO remain outstanding. Read WORK_STATE/TASKS/VPS_DEPLOYMENT and ADR-VPS-STORAGE-AND-PROVIDER-DEFER first; retain the entire PLAN.

Earlier hosting/status descriptions below are historical and are superseded by the authority above. Preserve their evidence dates; use WORK_STATE for the unfinished current task.


- Egypt first: developers and brokerages, complete buyer experience.
- EOI selects apartment type; allocation selects exact eligible available apartment.
- Arabic and English UI; English voice initially.
- All source/plans/state/deployment definitions on GitHub.
- Synthetic GitHub Pages demo remains shareable; commercial runtime is separate.
- No Railway or mandatory hosting MCP.
- Existing self-hosted server is available; deploy only after platform and deployment preparation are complete and deployment is separately authorized.
- Continue means resume using the plan/checkpoint without re-asking these decisions.

Unselected provider names, credentials, domain/host configuration and finance/identity/signature policy details remain explicit external dependencies. Do independent implementation/package work first. Routine technical choices are recorded as ADRs rather than recurring approval questions.

## Current-stage clarification

Superseded by the latest explicit user request: work with GitHub and Render and deploy a public testing platform now. Use an isolated synthetic test environment. Prepare and validate the latest candidate before deployment. No paid resource purchase has been authorized. The existing self-hosted server remains deferred.

## Latest reconciliation

Public fully integrated production is the final goal. Latest user requests review of Railway and Render; both are assessed as possible hosting profiles. This does not choose a paid plan or authorize using the reserved self-hosted server now. Keep portable packaging, finish the software and record actual live evidence. Railway platform-core services are separate from realestate. Render PR91 must be adapted to the final realestate candidate before any deployment.

## Render public testing authorization — latest steering

The user explicitly requested GitHub + Render public testing and asked to reconnect and prepare both. Render plugin inventory reports installed/enabled, but this session exposes no Render MCP tools; the shell has neither Render CLI nor RENDER_API_KEY. Account reconnection/reload requires the user. Continue repository, Blueprint, test and documentation work independently. Never bypass production assurance by publishing NODE_ENV=test or synthetic session seeding. Public sandbox design must be explicit and isolated; final production still requires the full plan and live evidence.
