# Production configuration and secret contract

PRENEURA treats configuration as part of the executable production boundary. A process running with `NODE_ENV=production` must reject unsafe configuration **before** it serves HTTP traffic or starts background loops.

The development `.env.example` intentionally contains localhost endpoints and placeholder values. It is a local bootstrap template, not a production environment file.

Production secrets belong in the deployment platform or secrets manager. They must never be committed to Git, copied into build logs, or passed through browser-exposed `NEXT_PUBLIC_*` variables.

## Process-specific validation

Configuration is validated independently by each runtime so a service is required to possess only the secrets it actually needs.

### API

The API validates before NestJS bootstrap.

Production requirements include:

- PostgreSQL `DATABASE_URL`;
- HTTPS `WEB_ORIGIN` values;
- strong auth identifier HMAC key, OTP pepper and cookie signing secret;
- a base64 contact-encryption key that decodes to exactly 32 bytes;
- strong contact HMAC and verification secrets;
- HTTPS OIDC issuer and callback URI plus client credentials;
- `OTP_PROVIDER=gateway` — console OTP is forbidden in production;
- non-local OTP/contact-verification gateway URLs;
- strong notification-gateway bearer token;
- document object-storage bucket and consistent optional static storage credentials;
- non-local document-scanner URL and scanner bearer token;
- strong finance-provider ingress token;
- bounded authentication/session/scanner timing settings.

The API rejects obvious placeholder values such as `replace-*`, `change-me`, `placeholder`, or `dummy`.

AI provider configuration remains optional. The deterministic AI/recommendation path is the operational fallback and production startup does not require a third-party AI credential.

### Worker

The worker validates configuration before creating its database client or executing the runtime-schema readiness probe.

Production requirements include:

- PostgreSQL `DATABASE_URL`;
- a non-local notification-gateway delivery URL;
- strong notification-gateway bearer token;
- bounded polling/scanning intervals for outbox, notification delivery, milestone reminders, installment reminders and commission due-state refresh.

An invalid worker configuration exits before any recurring loop can claim jobs or mutate projections.

### Notification gateway

The gateway validates through `src/bootstrap.ts` before importing or starting the HTTP delivery server.

Production requirements include:

- PostgreSQL `DATABASE_URL`;
- contact-encryption key decoding to exactly 32 bytes;
- strong private gateway bearer token;
- Meta Graph API version;
- WhatsApp phone-number ID;
- Meta access token;
- valid, non-empty `WHATSAPP_TEMPLATE_BINDINGS_JSON`;
- valid optional SMS/email webhook configuration when those channels are configured;
- valid TCP port.

The gateway is the only PRENEURA service that should hold Meta WhatsApp provider credentials. API and worker services communicate with it through the private gateway contract instead of receiving the Meta access token themselves.

## Secret ownership

Use separate secrets wherever the trust boundary differs.

| Secret / credential | API | Worker | Notification gateway | Browser |
| --- | --- | --- | --- | --- |
| Database credential | required | required | required | never |
| Auth HMAC / OTP pepper | required | no | no | never |
| Cookie signing secret | required | no | no | never |
| Contact encryption key | required for account/contact operations | no | required for delivery resolution | never |
| Notification gateway bearer token | required | required | required for request verification | never |
| Meta WhatsApp access token | no | no | required | never |
| Finance provider ingress token | required | no | no | never |
| Object-storage secret key | API only when static credentials are used | no | no | never |
| Document scanner token | required | no | no | never |
| OIDC client secret | required | no | no | never |
| `NEXT_PUBLIC_API_URL` | build-time public value | no | no | intentionally public |

Where infrastructure supports workload identity or managed credentials, prefer those over long-lived static access keys.

## URL policy

Public browser/OIDC origins must use HTTPS in production.

Internal service URLs may use the deployment platform's private HTTP network where transport remains inside the provider's isolated service network. Production validation rejects localhost/loopback targets so a deployed service cannot accidentally call itself or a developer machine configuration.

## Rotation

Secrets should be generated with a cryptographically secure random generator and rotated through the deployment secret store.

For secrets used to derive persistent lookup/encryption material, rotation must be planned rather than performed as a blind replacement:

- contact encryption-key rotation requires decrypt/re-encrypt migration or key-version support;
- identifier/contact HMAC key rotation affects deterministic lookup values and requires a migration strategy;
- OTP peppers can rotate after outstanding challenges have expired or with pepper-version support;
- bearer/provider tokens can normally use overlap/dual-token windows where the provider permits it.

Never rotate a state-derived cryptographic key by simply changing the environment value and restarting production.

## Build-time versus runtime values

`NEXT_PUBLIC_API_URL` is embedded into the Next.js browser bundle and therefore is not a secret. Set it to the final public API origin during the web build.

All authentication, encryption, provider and database secrets are runtime/private values and must not use the `NEXT_PUBLIC_` prefix.

## Deployment sequence

A production rollout should follow this order:

1. provision/rotate secrets in the deployment platform;
2. apply compatible database migrations;
3. deploy private provider services such as notification gateway/scanner;
4. deploy API and wait for `/v1/health/ready`;
5. deploy worker and require successful `worker.ready` startup;
6. deploy web using the final public API URL;
7. run smoke checks for authentication, document trust, notification delivery and finance/provider ingress as appropriate to the release.

For schema compatibility and rollback rules, see `docs/runtime-readiness.md`.

## Executable certification

The configuration contract is certified by:

```text
platform/scripts/certify-production-config.mts
.github/workflows/production-config-certification.yml
```

The certification proves both valid and invalid production matrices and then starts the **real emitted API, worker and notification-gateway processes** with intentionally incomplete production configuration. Each process must exit non-zero before serving or processing work.

Cases explicitly covered include:

- placeholder secrets;
- console OTP in production;
- localhost production origins/provider endpoints;
- invalid contact-encryption key length;
- short gateway bearer tokens;
- unsafe worker polling values;
- malformed or incomplete WhatsApp template bindings;
- invalid optional SMS provider endpoint configuration;
- development mode remaining usable with local/default settings.

A change to startup configuration, `.env.example`, this document or the certification itself must keep **Production Configuration Certification** green before merge.
