# PRENEURA Production Platform

This directory is the new server-authoritative production implementation. The existing 6.7 demo at repository root remains untouched while production domains are migrated and parity-tested.

## Implemented in the first foundation slice

- pnpm/Turborepo TypeScript workspace
- Next.js production web shell
- NestJS/Fastify API
- PostgreSQL typed database package
- passwordless phone login + OTP contract
- National ID account lookup + OTP to the verified phone
- Google OIDC authorization-code + PKCE flow through Keycloak
- HttpOnly server sessions with only token digests stored in PostgreSQL
- enumeration-resistant login challenge behavior
- authentication security event records
- local PostgreSQL / Redis / Keycloak development stack

## Login security model

### Phone

1. User enters a phone number.
2. API normalizes to E.164 and computes an HMAC lookup key.
3. API creates an OTP challenge whether or not an account exists.
4. If an active account exists, the configured provider sends the OTP.
5. Successful OTP verification atomically consumes the challenge and creates a server session.

### National ID

The National ID is an identifier, never a password. PRENEURA stores a keyed HMAC lookup alias and does not require the clear National ID in the authentication tables. When a matching account exists, the OTP is delivered to the already verified phone attached to that user.

The first implementation validates the Egyptian 14-digit National ID format. International identity/passport login can be added as a separate alias type without weakening this flow.

### Google

The web UI sends the user to `/v1/auth/google/start`. The API creates a PKCE verifier + state and redirects through the PRENEURA Keycloak realm with `kc_idp_hint=google`. The callback validates state, exchanges the code with PKCE, verifies the Keycloak ID token against the realm JWKS, links the `(provider, subject)` identity and creates the same PRENEURA server session used by OTP login.

A first-time Google identity is `PENDING`; identity verification alone never grants a tenant, project or operational role.

## Local bootstrap

```bash
cd platform
cp .env.example .env
# replace all placeholder secrets before running auth flows

docker compose -f docker-compose.dev.yml up -d
pnpm install
```

Apply `packages/database/migrations/0001_auth_foundation.sql` to the `preneura` PostgreSQL database before starting the API.

Then run:

```bash
pnpm dev
```

Default endpoints:

- web: `http://localhost:3000`
- API: `http://localhost:4100/v1`
- Keycloak: `http://localhost:8080`

## Keycloak setup required for Google

Create realm `preneura`, configure confidential OIDC client `preneura-web`, use the callback URL from `OIDC_REDIRECT_URI`, and add Google as an Identity Provider. Google client secrets and all production Keycloak secrets belong in a secrets manager, never in Git.

## Production safety rules already enforced

- `OTP_PROVIDER=console` throws during production bootstrap.
- production OIDC requires signed state/verifier cookies.
- real identifier and OTP secrets are never committed.
- OTP codes must never be logged by production delivery adapters.
- National ID is never accepted as proof of identity by itself.
- Google account creation does not grant any business role automatically.

## Next implementation slices

1. Redis-backed auth rate limiting, resend limits and abuse controls.
2. Production OTP adapters: SMS provider + Meta WhatsApp authentication template adapter.
3. Session guard, logout/revocation, `/auth/me`, device/session management and MFA step-up policies for privileged roles.
4. Tenant/project membership + RBAC/ABAC enforcement.
5. Project/inventory/pricing domain and atomic exact-unit locking.
6. Durable Temporal workflows and realtime event/outbox foundation.
