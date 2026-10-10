# Service readiness ledger

This is a software-completion ledger. `LIVE_VERIFIED` requires real environment/provider evidence and is not inferred from code, mocks, CI or configuration.

| Service | Code/config baseline | Current completion state | Live evidence / blocker |
|---|---|---|---|
| Web | Next.js production app and legacy synthetic Pages demo exist | Baseline integrated; E01 security/test repair then E02/E05/E11/E12/E15 completion pending | No target-server evidence; Pages demo remains synthetic |
| API | NestJS/Fastify scoped production API exists | Baseline integrated; E01 lifecycle/assurance/CSRF/test defects are first work | No target-server evidence |
| Worker | Durable DB-backed worker/outbox/reminder baseline exists | Baseline integrated; lifecycle/revocation/recovery and later E08/E13/E16 evidence pending | No target-server evidence |
| Notification gateway | Gateway/jobs baseline exists | Messaging delivery lifecycle completion E13 pending | Provider credentials/templates/callback live evidence pending |
| PostgreSQL/migrations | Reviewed candidate contains 41 migrations and certification scripts | Preserve applied history; append migrations only; normal command integration and package rehearsal pending | Target server deferred |
| Identity/Keycloak/MFA | OTP/OIDC/account foundation exists | E01 privileged assurance + E02 Egypt identity/recovery work pending | Provider/realm/live MFA evidence not established |
| Object storage/scanner | Private-object/trust adapters exist | E10 and E16 package/recovery work pending | Real storage/scanner environment evidence not established |
| Contract rendering/signing | Document/signature evidence baseline exists | Exact bilingual populated contract/render/sign execution E10 pending | Legal/provider/manual verification acceptance pending |
| Payment/settlement | Immutable ledger/normalized ingress baseline exists | E09 approved Egypt provider/manual reconciliation completion pending | Merchant/provider selection and credentials pending |
| AI/English voice | Advisory/local/demo foundations exist | E14 production-safe visual/voice journey pending | Intended hardware/model/provider live evidence pending |
| Proxy/TLS/observability/backups | Prior runbooks/CI material exist | E16 complete self-hosted package and rehearsal pending | Target server deployment intentionally deferred |
| GitHub Pages demo | Published 6.7.1 synthetic demo at main `1a6e61c...` | Preserve; E15 parity/data/currency/status fixes pending | Existing public synthetic demo only |

## Global external/deferred dependencies

- `DEPLOYMENT_DEFERRED`: no server/DNS/production migration/deployment until separate authorization.
- `PROVIDER_SETUP_PENDING`: merchant, messaging, signature, identity, domain and production credentials/approvals are not yet live evidence.
- `INDEPENDENT_REVIEW_PENDING`: high-risk security, finance, locking and signature changes require independent review before final release.
