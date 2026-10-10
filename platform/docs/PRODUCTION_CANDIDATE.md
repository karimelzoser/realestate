# PRENEURA Real Estate OS — Canonical Production Candidate

This branch is the canonical integration candidate for the production platform.

It unifies the independently certified production lines for:

- project catalog, pricing, inventory, allocation and transaction workflows;
- document trust, contract execution and immutable financial evidence;
- broker commissions, notifications, accounts, roles and operational workspaces;
- optional AI, governed exports and PRENEURA platform administration;
- runtime configuration, health/readiness, observability and HTTP security;
- concurrency, backup/restore, resilience, SLO/alert policy and release reproducibility.

## Release authority

The runtime implementation owns request correlation. Incoming `x-request-id` values are not trusted as correlation authority; the API generates an independent request UUID and returns it in the response.

This candidate is valid only when the required production certification workflows pass on the same Git commit, including the Gate 6 non-functional certification that verifies server-generated request correlation, backup/restore, concurrency, security baseline, readiness load smoke and alert-policy structure.

## Integration policy

This file is intentionally under `platform/` so a candidate change triggers the platform-scoped release matrix. It is not a substitute for any certification result and contains no runtime configuration or secrets.
