# PRENEURA Progress

Current completion target: **SOFTWARE_READY_FOR_DEPLOYMENT**  
Current integration branch: `integration/software-ready-for-deployment`  
Live deployment: **not started and not authorized**

## Checkpoint restored

The integration branch was created from the saved runtime-readiness checkpoint:

- PR #52 — Production runtime: readiness gates and schema compatibility
- source commit: `6c52336435c8670e8dff4cd4343a9d01ecc64e5d`

This preserves the completed stacked work instead of restarting from the older demo/main branch.

## Completed production slices

The current checkpoint contains the production implementation accumulated through the stacked PR series, including:

- production architecture/domain/delivery blueprint;
- phone/National-ID OTP + Google OIDC boundary;
- tenant/project/broker RBAC;
- catalog/pricing/inventory foundation;
- buyer/EOI/queue/reservation/transaction core;
- secure documents/signatures/contract execution evidence;
- immutable finance ledger and cheque history;
- broker commission engine/countdowns;
- realtime/SSE and notification scheduling/delivery boundary;
- role-aware production web workspace;
- project hierarchy/import/setup center;
- account/contact provisioning and notification gateway;
- PRENEURA Super Admin control plane + support sessions;
- optional AI recommendations/manager insight boundary;
- pricing certification;
- document/contract trust certification;
- finance reconciliation certification;
- committed dependency graph and frozen-install certification;
- runtime readiness, schema compatibility, serialized migrations and fail-closed worker startup;
- synthetic GitHub Pages demonstration + Chromium regression suite.

## Hosting correction recorded

The project is now explicitly host-neutral during software completion:

- no server access in the current phase;
- no Railway requirement;
- no hosting MCP requirement;
- Docker Compose is the portable deployment authority;
- GitHub Pages remains synthetic demonstration only;
- actual hosting/server configuration is a later assignment;
- existing Railway resources are preserved but not required.

See `DECISIONS.md`.

## Product correction recorded

The inventory journey is now explicitly:

`EOI selects unit type -> allocation selects exact apartment -> exact apartment lock -> reservation/transaction`

This supersedes earlier interpretations where the buyer-facing sales flow could remain anonymous-capacity/type-only through allocation.

## Active work

### B1 — EOI unit type -> exact physical apartment allocation

Status: **IN_PROGRESS**

Required evidence before completion:

- EOI stores/validates its unit type;
- allocator receives eligible exact apartments for that type;
- exact unit is locked atomically in PostgreSQL;
- exact unit persists into reservation/transaction;
- cross-project/type mismatch is rejected;
- double-lock concurrency yields one winner;
- release/expiry/conversion is correct;
- allocator UI renders exact unit/building/floor details;
- pricing snapshot remains immutable.

## Next queue after B1

1. English/Arabic production i18n + RTL certification.
2. English voice production API integration.
3. Deterministic contract generation + external e-sign adapter contract.
4. Durable long-running workflow completion/Temporal decision certification.
5. Remaining provider adapters with fake/fixture CI paths.
6. Portable Dockerfiles and Docker Compose package.
7. Backup/restore, monitoring, alerts and operational runbooks.
8. Full disposable Compose/load/security/restore release certification.
9. SOFTWARE_READY_FOR_DEPLOYMENT evidence matrix.

## Explicit external dependencies

The following are **not** reasons to stop software implementation:

- production SSH/server access;
- production DNS/domain/TLS;
- live Meta, SMS, email, payment, e-sign, malware-scanner or external AI credentials.

They remain live-verification dependencies and must not be reported as successfully verified until real credentials/environments are supplied.

## Resume rule

When the user says **continue**:

1. read `WORK_STATE.json`, `TASKS.md`, `PLAN.md`, `DECISIONS.md`, and this file;
2. inspect the recorded integration branch head and CI state;
3. resume `active_task` / `next_action` without repeating settled questions;
4. commit meaningful implementation + test evidence;
5. update the state files before ending the work session.
