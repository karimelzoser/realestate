# Accepted user decisions

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

The user requires implementation and disposable local/CI validation only. No server access, configuration, installation or deployment in this stage. Prepare a portable deployment package; actual hosting/deployment remains a separate later assignment.

## Latest reconciliation

Public fully integrated production is the final goal. Latest user requests review of Railway and Render; both are assessed as possible hosting profiles. This does not choose a paid plan or authorize using the reserved self-hosted server now. Keep portable packaging, finish the software and record actual live evidence. Railway platform-core services are separate from realestate. Render PR91 must be adapted to the final realestate candidate before any deployment.
