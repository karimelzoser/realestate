# PRENEURA Decisions

This file records settled decisions that future implementation turns must preserve unless the user explicitly changes them.

## D-001 — Completion target

- Current target: **SOFTWARE_READY_FOR_DEPLOYMENT**.
- `LIVE_PRODUCTION_GO` is a separate later assignment.
- Missing SSH access, live server configuration, production domains, or provider credentials must not block independent software completion and disposable-environment validation.
- Do not claim PRENEURA is live in production until the separate deployment assignment is authorized and completed.

## D-002 — Hosting and deployment boundary

- GitHub is the source of truth for source code, plans, progress, CI, release evidence, and versioned artifacts.
- GitHub Pages hosts the **synthetic demonstration only**. It does not run the production backend or real transactions.
- The production package must be portable and runnable with **Docker Compose independently of any paid hosting dashboard or hosting MCP**.
- Actual hosting selection, server setup, SSH access, DNS, TLS issuance, and production deployment are deferred.
- No current task may connect to, configure, install software on, modify, or deploy to the user's server.
- Railway is **not a requirement**. Existing Railway resources/history must be preserved; do not delete or repurpose them. New production work must not depend on Railway.
- Coolify may be documented later as an optional management layer only. Docker Compose remains authoritative and must work without it.

## D-003 — Product market and initial language scope

- Initial production market: Egypt.
- Primary organizations/personas: real-estate developers, brokerages, staff/operators, buyers, and PRENEURA platform administration.
- Production UI: Arabic and English.
- Initial voice-assistant language: English. Arabic voice can follow after the English production path is certified.

## D-004 — EOI and allocation inventory rule

- EOI selects an **apartment/unit type**, not an exact apartment.
- Queue position never reserves inventory.
- During allocation, the authorized buyer/allocator selects an **exact physical apartment/unit** from the eligible units of the EOI type.
- The exact apartment is the authoritative inventory lock boundary.
- Only one active lock may exist for one exact physical unit at any moment.
- Internal physical-unit hierarchy and buyer-facing type availability must remain consistent and auditable.

## D-005 — Authentication

Supported login paths:

- phone number + OTP;
- National ID lookup + OTP to the verified phone/contact associated with the identity;
- Google OIDC login.

National ID is an identifier, not a password. Authentication does not grant tenant/project/broker authority; authorization remains server-side and scoped.

## D-006 — Production architecture

- Modular-monolith TypeScript backend with explicit domain boundaries.
- PostgreSQL is the authoritative business source of truth.
- Durable workers own background scheduling/delivery; browser timers never own business truth.
- Files are private object-storage objects referenced by immutable metadata/hashes.
- Money and cheque state are append-only evidence with derived projections.
- AI is optional and advisory only; it cannot create business authority or mutate critical state without normal deterministic commands/permissions.

## D-007 — Deployment artifact requirements

Before SOFTWARE_READY_FOR_DEPLOYMENT can be declared, the repository must contain and validate in disposable CI/local environments:

1. production Dockerfiles and immutable/versioned image build metadata;
2. local, staging, and production Docker Compose configurations;
3. private service networking, health checks, persistent volumes, restart policies, and resource controls;
4. reverse-proxy configuration for HTTPS termination and SSE/realtime behavior;
5. secret/config examples containing variable names/placeholders only;
6. serialized migrations and runtime/schema compatibility checks;
7. preflight, rollout, smoke-test, and rollback scripts;
8. database, identity, and document-storage backup/restore procedures;
9. monitoring dashboards, alerts, and operational runbooks;
10. a complete portable installation/release guide.

These artifacts are prepared and tested without touching a live production server.

## D-008 — Evidence rule

- Never fabricate provider, deployment, payment, WhatsApp, SMS, email, OIDC, object-storage, malware-scanner, e-sign, or live-domain success.
- Unavailable live credentials/verifications are tracked explicitly as external dependencies while implementation and synthetic/integration testing continue.
- A feature is not "production verified" merely because a synthetic demo screen exists.
