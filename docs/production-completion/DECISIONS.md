# Accepted user decisions

## Current authority — 12 October 2026

The user now authorizes the VPS deployment and explicitly defers Render. Use only /opt/realestate-os-testing, project realestate-os-testing, and a separate PostgreSQL18.6/database/identity/storage/volumes/network. Never edit, restart or redeploy n8n or the existing PRENEURA project. Full isolation is selected: HTTPS8443 at realestate-test.aipreneura.com; no existing Traefik network or ports80/443. Read VPS_DEPLOYMENT.md and evidence/vps-inventory.json. Private PG is healthy and all12 existing container baselines are unchanged; DNS A and a valid certificate are prepared. Public application services are not yet deployed.

Published schema48 head febcee5f53e5e18644e4eb4f72fa7fef1a4be14b passed all42 inspected GitHub CI runs. Local schema49 adds reviewed staff MFA enrollment, issuer/nonce/freshness checks and one-shot offline owner bootstrap; real DB/signed-IdP/bootstrap certifications, 48 normal tests and nine-package types/lint/frontend build pass. Publish and reverify this new candidate before claiming hosted readiness. EOI chooses apartment TYPE; allocation chooses the exact apartment. Arabic/English UI and English voice remain the agreed scope. Full product/provider/backup/load/live acceptance is still required.

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
