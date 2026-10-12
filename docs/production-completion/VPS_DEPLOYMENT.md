# Separate VPS deployment — current hosting decision

The latest user instruction replaces current Render deployment with this VPS. Source, plan and tests stay on GitHub. The realestate platform must occupy a separate part of the VPS; n8n and the existing PRENEURA platform are protected and must never be edited, restarted or redeployed.

## Verified inventory

Hostinger VPS1387868, `187.77.85.198`, Ubuntu24.04, 2CPUs/8GB RAM/100GB disk. Read-only SSH inspection on 2026-10-12 found approximately5.5GB available memory and80GB free disk. Docker29.2.1 and Compose5.0.2 are installed. The existing n8n Traefik owns80/443. PRENEURA's existing PostgreSQL16 and n8n's PostgreSQL15 are forbidden migration targets. A dedicated deployment SSH key was added through the connected Hostinger account after password authentication failed; no existing project was changed. Non-secret protected-container IDs/start times are in `evidence/vps-inventory.json`.

## Isolation contract

Use `/opt/realestate-os-testing` and Compose project `realestate-os-testing`. Every network/volume/service must belong to that project. Use a separate PostgreSQL18.6 volume, application database and identity-provider database. The owner, migration, application and identity database credentials are independent. The application role cannot alter schema or disable database guards. The first infrastructure file publishes no host port.

No `docker system prune`, global Compose down/restart, existing-volume mount, shared database migration, existing Keycloak realm modification, n8n workflow modification, system package upgrade, OS reset or server reboot is allowed. Commands must name this project's exact Compose files and project name. Before and after changes, compare the protected container IDs/start times/restart counters and observe memory/CPU. Limit new runtime containers and use a dedicated bounded builder; do not monopolize both CPUs with unconstrained builds.

## Deployment sequence

1. Finish and certify the current candidate, then freeze its exact source SHA and schema49 marker. Keep public-test labeling and synthetic-only test tenants until real acceptance is signed off.
2. Upload only reviewed deployment files/source into the dedicated directory; generate independent secrets outside GitHub and restrict secret files to root. Validate Compose without printing expanded secret values.
3. Start only the new private PostgreSQL infrastructure. Confirm version, role separation and volume ownership. Run migrations as `realestate_os_migrator`; API/worker/gateway use `realestate_os_app`.
4. Prepare private S3-compatible storage, a real malware-scanner adapter/engine, a separate Keycloak instance/realm with genuine MFA, and dedicated observability/backup destinations. Existing PRENEURA services cannot be reused. The monolith uses PostgreSQL durable jobs/outbox; Redis, NATS, Temporal and n8n are not required dependencies.
5. Configure genuine OTP/notification providers, OIDC client/MFA policy, scanner trust and storage CORS/presigned URLs. Disable unsupported features visibly; do not substitute a successful simulator in production. Select scanner/storage components from maintained primary documentation and test the application's exact S3 operations.
6. Start the new API, worker, notification gateway and Next.js frontend with bounded memory/CPU, health checks and release/schema identity. Run the offline reviewed first-admin bootstrap only after genuine provider MFA. Onboard developer/brokerage synthetic test organizations through the application.
7. Publish HTTPS through the routing option explicitly selected by the user. Full isolation uses a separate HTTPS port and user-supplied domain with DNS certificate validation. Alternatively, explicit permission may allow only the new edge container to attach to the existing Traefik network using labels on that new container; existing project files/containers remain untouched. Full isolation is selected: `realestate-test.aipreneura.com:8443`. Its new A record points to this VPS and a DNS01 certificate was issued, valid through 2027-01-10. No public app is deployed yet; automatic renewal and precise TXT cleanup remain to be completed.
8. Run English/Arabic mobile and all-role acceptance, actual EOI→queue→exact apartment→payment→contract→property journeys, provider callbacks, access isolation and worker restart tests. Take an encrypted off-host backup, restore it into a separate new project and compare the required fingerprints. Verify TLS, SSE, expiry, logs/alerts and a bounded load/soak test.

## Remaining launch dependencies

Public edge/application deployment, genuine OIDC/MFA and OTP credentials, scanner/storage qualification, signed provider test acceptance, off-host backup destination, operational owner and full product completion remain open. A local green test or a running database is not public full-product readiness. The 2CPU/8GB shared VPS is an initial testing target; measured load and the protected workloads determine capacity. It has no HA or independent database replica by itself. Never promise full production capacity from idle-resource readings.

The old Render Blueprint remains a prepared optional profile; no Render action is required for the current user request. Keep it valid, but do not let Render reconnection block VPS or product work.
