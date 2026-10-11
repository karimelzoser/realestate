# PRENEURA Real Estate OS — Render Production Deployment

This document is the operating contract for deploying the production `platform/` workspace to the Render workspace **Preneura**.

The repository root contains `render.yaml`, which is the authoritative Render Blueprint. Do not create parallel manually configured production services with different commands, regions, health checks, or environment-variable names.

## 1. Production topology

The Blueprint defines one PostgreSQL database and four runtime services, all in **Frankfurt**:

| Resource | Render type | Purpose | Health/readiness |
| --- | --- | --- | --- |
| `aipreneura-realestate-db` | PostgreSQL 18 | Transactional source of truth | Managed by Render |
| `aipreneura-realestate-api` | Web service | NestJS/Fastify API + SSE | `/v1/health/ready` |
| `aipreneura-realestate-web` | Web service | Next.js production UI | `/api/health` |
| `aipreneura-realestate-worker` | Background worker | Outbox, reminders, notifications, commission due-state | Fails startup when DB/schema is not ready |
| `aipreneura-realestate-notify` | Web service | Token-protected notification/OTP gateway | `/health` |

The database is intentionally not a free-tier resource. Buyer identity, reservations, contracts, payments, cheques, refunds, commission evidence, and audit history require a durable production database.

The initial notification gateway is a public Render web service because the current application contract uses absolute HTTP(S) URLs. Its business endpoints require `NOTIFICATION_GATEWAY_TOKEN`; only `/health` is public. A later hardening change may move it to a Render private service once the application URL contract is changed and certified.

## 2. Build/deploy contract

Every application build uses the committed dependency graph:

```bash
corepack enable
corepack prepare pnpm@12.9.1 --activate
pnpm install --frozen-lockfile
```

Production auto-deploy uses `checksPass`, not every raw commit.

The API runs this pre-deploy command before a new revision is eligible for traffic:

```bash
pnpm --filter @preneura/database migrate
```

If migration fails, the new API deploy must not go live.

The API health check is:

```text
/v1/health/ready
```

This is intentionally different from liveness. Readiness verifies PostgreSQL connectivity, migration provenance, schema/runtime compatibility, and the current runtime contract.

The worker performs the same schema compatibility check before starting any background loop. It exits non-zero on a stale, untracked, or incompatible schema.

## 3. Resources outside Render

Render is the compute/database platform for this profile, but PRENEURA deliberately keeps some external provider boundaries vendor-neutral.

The first healthy production rollout still requires:

1. **Keycloak/OIDC issuer** with Google configured as an identity provider.
2. **S3-compatible object storage** for templates, documents, signatures, master plans, and other uploaded evidence.
3. **Document malware scanner** implementing the fail-closed scanner protocol in `docs/document-contract-trust.md`.
4. **Meta WhatsApp Cloud API** credentials and approved message templates.
5. Optional SMS/email gateways if those channels are enabled.
6. Optional third-party AI provider. PRENEURA remains functional without it because deterministic recommendation/manager logic is the fallback.

Do not add Render Key Value merely because `REDIS_URL` exists in the generic local `.env.example`. The current production runtime does not use Redis as an authority or queue backend; adding an unused paid dependency would increase operational surface without adding correctness.

## 4. `sync: false` values required before first healthy rollout

The Blueprint leaves third-party/provider values out of Git. Configure the following in Render during Blueprint creation or before attempting a healthy rollout.

### API

Required:

- `OIDC_ISSUER`
- `OIDC_CLIENT_ID`
- `OIDC_CLIENT_SECRET`
- `OBJECT_STORAGE_BUCKET`
- `OBJECT_STORAGE_ENDPOINT` when the S3-compatible provider requires a custom endpoint
- `OBJECT_STORAGE_ACCESS_KEY_ID`
- `OBJECT_STORAGE_SECRET_ACCESS_KEY`
- `DOCUMENT_SCANNER_URL`
- `DOCUMENT_SCANNER_TOKEN`

Optional AI provider values:

- `AI_PROVIDER_URL`
- `AI_PROVIDER_TOKEN`
- `AI_PROVIDER_MODEL`

`OIDC_REDIRECT_URI` is set by the Blueprint to:

```text
https://aipreneura-realestate-api.onrender.com/v1/auth/google/callback
```

The Keycloak client must allow that exact redirect URI until a custom production domain is introduced.

### Notification gateway

Required for WhatsApp:

- `META_GRAPH_API_VERSION`
- `META_WHATSAPP_PHONE_NUMBER_ID`
- `META_WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_TEMPLATE_BINDINGS_JSON`

Example binding shape:

```json
{
  "auth.login.otp": {
    "name": "preneura_login_otp",
    "language": "ar",
    "bodyParameterPaths": ["code"]
  },
  "auth.enrollment.verify": {
    "name": "preneura_account_verify",
    "language": "ar",
    "bodyParameterPaths": ["code"]
  }
}
```

The template names/languages must match approved Meta templates exactly.

## 5. Secrets generated/wired by the Blueprint

Render generates the internal PRENEURA secrets that do not need to be supplied by a third party, including:

- identifier HMAC key
- OTP pepper
- cookie signing secret
- contact HMAC key
- contact verification pepper
- finance provider-ingress token
- notification gateway token
- 32-byte base64 contact-encryption key

The API receives the same contact-encryption key and gateway token as the notification gateway through Render service references; these values must stay consistent across those services.

Changing the contact-encryption key after contacts have been encrypted makes existing contact ciphertext unreadable. Treat it as a long-lived production encryption key, not a disposable deploy secret.

## 6. Object-storage CORS

The browser uploads directly to presigned object-storage URLs. The storage bucket must permit the deployed web origin to send the signed `PUT` requests and the required checksum/content-type headers.

Keep the bucket private. PRENEURA should generate signed access/upload URLs; do not make document, contract, signature, buyer-ID, cheque, or master-plan objects publicly readable.

When the production web domain changes, update the bucket CORS allowlist accordingly.

## 7. URL and domain assumptions

The initial Blueprint uses the deterministic Render hostnames:

- `https://aipreneura-realestate-web.onrender.com`
- `https://aipreneura-realestate-api.onrender.com`
- `https://aipreneura-realestate-notify.onrender.com`

These drive:

- `NEXT_PUBLIC_API_URL`
- `WEB_ORIGIN`
- OTP/contact-verification gateway URLs
- worker notification gateway URL
- Google OIDC callback

If a service name changes or custom domains are added, update all dependent values as one deployment change. `NEXT_PUBLIC_API_URL` must be correct **during the Next.js build**, not only at runtime.

## 8. First deployment order

The safe first-production sequence is:

1. Create/sync the Render Blueprint.
2. Wait for PostgreSQL to become available.
3. Populate all required `sync: false` provider values.
4. Deploy API; allow its pre-deploy migration command to establish the schema/migration ledger.
5. Confirm `GET /v1/health/live` returns 200 and `GET /v1/health/ready` returns 200.
6. Deploy notification gateway and verify `/health`.
7. Deploy worker; confirm logs contain `worker.ready` before any processing loop output.
8. Deploy web and verify `/api/health`.
9. Run a controlled smoke journey with non-production/test buyer data before admitting real sales traffic.

Do not manually mark an unhealthy API deploy healthy. A 503 readiness response is a release blocker and should be resolved at the database/configuration layer.

## 9. Migration and rollback policy

Database schema migration is forward-only in production.

A Render application rollback is safe only while the target application runtime remains compatible with the database `minimum_runtime_version`. The runtime-readiness contract intentionally blocks an older application from starting when a breaking schema has advanced beyond it.

For a bad database migration:

- do not restore old application code blindly;
- stop/hold traffic or dependent workers when necessary;
- ship a forward repair migration;
- verify readiness and reconciliation gates before resuming.

For a bad application deploy with a compatible database, use Render's previous successful deploy rollback.

## 10. Render production checks after every deploy

For API:

- health check green on `/v1/health/ready`
- no migration provenance errors
- no repeated 5xx startup failures
- database active connections within plan limits

For worker:

- `worker.ready` logged before loops
- no repeated outbox/notification/reminder failure storm
- graceful SIGTERM on deploy/restart

For notification gateway:

- `/health` green
- no repeated Meta/template binding failures
- idempotency ledger prevents duplicate provider sends

For web:

- `/api/health` green
- browser can establish credentialed API requests/SSE to the configured API origin

For PostgreSQL:

- storage headroom
- connection headroom
- backup/recovery policy appropriate for production before real transaction data is accepted

## 11. Billing/application boundary

`render.yaml` defines paid production-capable resources (`starter` services and a `basic-1gb` PostgreSQL instance). Committing or validating this Blueprint does not itself create those resources.

Applying the Blueprint in the Render workspace starts billable infrastructure according to the selected Render plans. Apply it only when the production provider secrets/dependencies above are ready and the deployment owner has approved that infrastructure spend.
