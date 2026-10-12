# Render public testing — deployment runbook

The latest user authorizes a GitHub-backed public testing deployment on Render now. The existing self-hosted server remains deferred. The complete production product and live Gate7 remain the final goal; this environment cannot establish a production GO.

## Source and topology

Use `codex/egypt-platform-completion`, PR90, and the latest **fully certified full commit SHA**. Do not deploy main's synthetic Pages demo or the older-base PR91. Root `render.yaml` is the public test profile.

| Resource | Plan | Responsibility |
|---|---|---|
| Public Next web | free | English/Arabic UI, visible test notice, same-origin `/v1` proxy |
| Public backend web service | free | API, worker and private local notification gateway in one production-guarded Node host |
| PostgreSQL18 | free | Authoritative test inventory, sales, ledger and immutable evidence; external access blocked |

The gateway binds `127.0.0.1:4300`. API OTP/contact-verification and the worker use fixed local, token-authenticated endpoints. A fatal worker failure or unexpected API/gateway closure terminates the host; Render must restart it rather than leave a partially functioning backend. Production security validation, AAL2 requirements, scoped permissions, trusted mutation Origin checks, object trust and ledger authority remain enabled. Do not deploy `NODE_ENV=test`, console OTP, browser fixture sessions or automatic privileged role switching.

This is a single-process preview host, not a managed free background-worker plan. The first four-process design measured494MiB initial RSS and was replaced; the consolidated host measures approximately190–193MiB locally. This is an initial memory observation, not hosted load certification. All jobs stop with the web service when it sleeps; overdue locks remain rejected by server timestamps and the worker reconciles them on wake. There is no keep-alive traffic or quota evasion. Memory/CPU/connection capacity must be measured on Render before inviting a wider pilot. Split durable workers/services and provision durable data storage for final production.

The browser API URL is the **web origin**, not a second onrender.com origin. `PRENEURA_API_UPSTREAM` is the actual backend HTTPS origin. Only `/v1/:path*` is proxied to the fixed configured target; credentials, arbitrary paths and proxy loops are rejected. OIDC callback must be the web origin plus `/v1/auth/google/callback`. Hosted cookie issuance, refresh/logout, Origin rejection, signed callback and SSE revalidation still require real HTTPS acceptance.

## Limits and no-purchase boundary

No paid plan is specified or authorized. Render documents a shared750 free instance-hours/month budget,15-minute idle sleep, bandwidth/build limits and possible suspension; both awake web services consume that shared budget. Its one free PostgreSQL database is limited to1GB, expires after30 days, and has no managed backups. These are constraints, not unlimited hosting. See [current free limits](https://render.com/docs/free), [compute specifications](https://render.com/docs/compute-plans) and [Blueprint specification](https://render.com/docs/blueprint-spec).

Record the database creation/expiration dates after provisioning. Keep only synthetic property/customer/financial data and restoreable synthetic seeds. Stop the pilot or migrate to approved durable storage before expiry. Do not silently upgrade, purchase infrastructure, reuse another application's database or repeatedly recreate databases to evade provider limits.

## Required connected accounts and secrets

Render plugin inventory reports installed/enabled, but the present session has no exposed Render tools and no authenticated CLI. Account OAuth/reload is required before inventory or deployment. A plugin installation is not evidence of workspace access. Authenticate through the app's connection UI or Render CLI; never paste secrets into source or chat.

Once connected, list workspaces/services/databases, select the user's actual target, and inspect existing resources/quotas before creating anything. Preserve any existing services. Confirm Render's GitHub connection can read this repository and branch. Inspect all configured provider values without printing them.

The Blueprint generates independent authentication/contact/identity/recovery/ingress secrets. Render's documented `generateValue` is base64-encoded256-bit material; production validators independently check the contact encryption key decodes to exactly32 bytes. Persist generated keys across redeploys; changing identifier/contact keys is a controlled migration, not ordinary secret rotation.

Fill `sync:false` values with real sandbox integrations before deployment:

| Input | Requirement |
|---|---|
| `WEB_ORIGIN` | Actual public web HTTPS origin, no path/query/fragment |
| `PRENEURA_API_UPSTREAM` (web) | Actual public backend HTTPS origin, no extra path |
| `PRENEURA_EXPECTED_RELEASE_SHA` | Exact certified source SHA being deployed; no branch name or shortened SHA |
| OIDC issuer/client/secret/callback/AAL2 ACR | Trusted provider validates real MFA and identity binding; callback uses the web origin |
| Private object bucket/region/endpoint/access keys | Isolated test bucket, private access, scoped signed URLs; no real customer documents |
| Scanner URL/token | Real sandbox scan/trust service; configured values alone do not establish CLEAN evidence |
| Meta version/phone ID/access token/template bindings | Approved sandbox WhatsApp sender and templates covering login, account/contact verification and recovery; OTP channel is WhatsApp |
| OTLP endpoint/headers | Reachable authenticated HTTPS collector; production telemetry stays enabled |

Optional external AI and SMS/email adapters are not provisioned by this profile. Core authorized sales must work without external AI. Do not claim optional providers or English voice are verified until their plan acceptance is completed.

A fresh database has no privileged accounts. Use the reviewed account/enrollment bootstrap authority and a real trusted MFA binding for initial staff; do not seed a public AAL2 bypass. Complete developer/project/brokerage onboarding, publish synthetic types/physical units/prices/policies, then enroll test roles using normal authorization. Account bootstrap/UI and provider evidence gaps remain tracked in TASKS; deployment configuration does not close them.

## Deploy the reviewed result

1. Verify the profile and application are present on the target GitHub branch. Inspect latest SHA and its complete CI results, including exact allocation/browser and Render process certification.
2. Validate root `render.yaml` against Render's schema/API/CLI. Repository validator also rejects paid resources, missing secret/provider inputs and accidental automatic deploys.
3. Inspect Render target inventory and free database availability. Create a new isolated public testing Blueprint from this branch. The Dashboard [Blueprint entry](https://dashboard.render.com/blueprint/new?repo=https://github.com/karimelzoser/realestate) requires selecting the correct branch and `render.yaml`; it is not a live application URL.
4. Fill provider inputs, confirm actual assigned hostnames and exact source pin, and register the OIDC web callback. Do not trust guessed onrender.com names.
5. Deploy backend first. On an empty database, the launcher applies migrations before starting the application group. On an existing database it requires the expected schema and verifies migration checksums; a schema mismatch fails closed and requires an offline migration after stopping the previous runtime. It never migrates underneath the previous worker.
6. Require backend readiness to report the expected build SHA, correct schema/minimum/marker, and all worker/gateway startup signals. Check logs for process exits, provider/configuration failures and pool/memory pressure.
7. Deploy the web at the same certified SHA and verify its configured API public origin/upstream. Automatic deploys are off so commits do not roll services independently.
8. Complete HTTPS/provider/role acceptance below. Only then publish the actual web URL for a controlled testing group and record it in WORK_STATE.

`sync:false` values are prompted only on initial Blueprint creation. Add later-required variables explicitly when updating an existing service. Do not assume a Blueprint sync filled them. Source/instance settings and secret ownership remain separate.

## Required public test acceptance

- Actual HTTPS signup/login, verification, normal recovery and genuine MFA for privileged staff; no identifier-only authentication, cross-account binding or role leakage.
- English and Arabic390px/desktop journeys, readable RTL, test notice, exact EGP decimals and Cairo timestamps; hosted cookie, refresh/logout and live stream behavior.
- Tenant/project/broker isolation; buyer ownership; inactive/suspended/revoked access and stream termination; agent commission redaction.
- Developer and brokerage onboarding/access, direct/broker buyer attribution and approved transfers; complete the tracked attribution-upsert bypass before wider pilot exposure.
- Paid EOI chooses apartment type. Called/assigned eligible allocation chooses exact building/floor/apartment, displays the authoritative quote and explicit confirmation, then holds/reserves it. No silent substitution or type reassignment.
- Two actors racing the same apartment produce one winner; replay, expiry, lost response, price change and rejected conversion preserve money/inventory/evidence. Apartment identity remains visible in reservation/transaction/My Property and bound into execution evidence.
- Actual private upload/scan/signer evidence, authorized finance posting/reconciliation/refund/settlement, notification callbacks and provider retries. Use provider sandbox evidence, not manufactured successful statuses.
- Worker restart/sleep recovery, bounded pool/memory/load, telemetry/error traces, backup/restore and rollback rehearsal. Free database durability is never represented as final production durability.

Collect reproducible bugs with role, locale, screen size, journey and non-secret request ID. Track signup-to-EOI and EOI-to-allocation completion, allocation contention, task completion time, notification delivery, support volume and broker/developer feedback. Use this evidence to prioritize remaining plan acceptance and validate Egypt developer/brokerage value before broad commercialization.

## Current evidence and remaining work

Published schema47 head `47b9eb5df7680b0c30ff03a39388539a135dac70` passed all39 inspected GitHub runs, including production-browser English/Arabic reservation. Local same-origin browser streaming/selection/hold/refresh/reservation also passed. Render profile schema validation and local abrupt-host-loss and component-startup-failure certification passed; Linux graceful signal drain is delegated to the new GitHub certification. Provider syntax fixtures in certification do not verify real providers. The profile is not yet publicly deployed, and hosted memory/cookie/provider tests remain open.

Continue independently with E03.3 attribution authority, onboarding/public buyer journeys, master-plan/online allocation, full finance/document/property experience, command centers, notification/voice integrations and release evidence in PLAN/TASKS. Read CONTINUE/WORK_STATE before resuming. The final goal remains a full integrated public production platform, not merely this testing profile.
