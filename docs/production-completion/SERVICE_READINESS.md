# Service readiness ledger

Initial planning state. Populate chosen adapter, code/config/test evidence, sandbox/live evidence, required secret names, owner and blockers for every service. Do not infer LIVE_VERIFIED from this document.

| Service | Existing baseline | Completion work | Live evidence |
|---|---|---|---|
| Web/API/worker/gateway | Code and prior builds exist | Full epics and new checks pending | Not established |
| PostgreSQL/migrations | 41 migrations/certifications exist | New migrations and package rehearsal pending | Target server deferred |
| Identity/MFA | OTP/OIDC foundation exists | Privileged assurance and actual integration required | Not established |
| Object storage/scanner | Adapters/trust foundation exists | Private deployment, byte verification and recovery | Not established |
| Contract renderer/signing | Evidence model exists | Exact contract generation and genuine signing | Not established |
| Payment/settlement | Ledger/normalized ingress exists | Approved provider adapter and reconciliation | Not established |
| Messaging | Gateway and jobs exist | Provider callbacks/uncertainty/template lifecycle | Not established |
| English voice/AI | Separate demo and advisory baseline | Production voice/visual integration | Not established |
| Proxy/TLS/monitoring/backups | Runbook/CI definitions exist | Full containers/config/scripts/dashboards/restore | Target server deferred |
| GitHub Pages demo | Published synthetic prototype | Fix and complete demo parity | Existing demo available; no commercial backend |
