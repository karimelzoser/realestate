# Production completion handover

Resume codex/egypt-platform-completion, draft [PR90](https://github.com/karimelzoser/realestate/pull/90). Read WORK_STATE/TASKS/CURRENT_STATUS/CONTINUE/DECISIONS/VPS_DEPLOYMENT and the full PLAN. Recheck remote HEAD and preserve concurrent/local changes.

Current authority — 12 October 2026

The user now authorizes the VPS deployment and explicitly defers Render. Use only /opt/realestate-os-testing, project realestate-os-testing, and a separate PostgreSQL18.6/database/identity/storage/volumes/network. Never edit, restart or redeploy n8n or the existing PRENEURA project. Full isolation is selected: HTTPS8443 at realestate-test.aipreneura.com; no existing Traefik network or ports80/443. Read VPS_DEPLOYMENT.md and evidence/vps-inventory.json. Private PG is healthy and all12 existing container baselines are unchanged; DNS A and a valid certificate are prepared. Public application services are not yet deployed.

Published schema48 head febcee5f53e5e18644e4eb4f72fa7fef1a4be14b passed all42 inspected GitHub CI runs. Local schema49 adds reviewed staff MFA enrollment, issuer/nonce/freshness checks and one-shot offline owner bootstrap; real DB/signed-IdP/bootstrap certifications, 48 normal tests and nine-package types/lint/frontend build pass. Publish and reverify this new candidate before claiming hosted readiness. EOI chooses apartment TYPE; allocation chooses the exact apartment. Arabic/English UI and English voice remain the agreed scope. Full product/provider/backup/load/live acceptance is still required.


CHATGPT_MASTER_PROMPT.md contains the full plan and latest authority. Saying continue resumes the recorded unfinished slice without repeating settled decisions.
