# Gate 6 application and dependency security scanning

This release gate adds reproducible static and dependency security evidence for the production `platform/` workspace.

## Production dependency policy

Gate 6 runs `pnpm audit --prod --audit-level=high` against the committed frozen lockfile using the pinned production toolchain.

Merge policy:

- unresolved **critical** production dependency advisories are release blockers;
- unresolved **high** production dependency advisories are release blockers;
- moderate/low advisories must still be reviewed, but do not automatically fail this gate unless their exploitability or PRENEURA usage makes them material;
- development-only dependency advisories are reviewed separately from production runtime exposure;
- package-manifest fixes must update and review `platform/pnpm-lock.yaml` through the existing reproducibility gate.

The audit is intentionally production-only (`--prod`) so the release decision is based on deployable dependency exposure rather than conflating test tooling with runtime risk.

## CodeQL policy

Gate 6 uses the supported `github/codeql-action` v4 line for `javascript-typescript` with the `security-extended` query suite.

The analysis is scoped to `platform/` and excludes generated dependency/build directories.

For deterministic merge gating, the workflow saves SARIF locally with upload disabled, archives the SARIF evidence for 30 days, and fails when any unsuppressed CodeQL security result remains.

A suppression is acceptable only after engineering review establishes one of the following:

- the finding is a confirmed false positive;
- the risky path is unreachable under the production trust boundary;
- a compensating control is documented and approved for the release.

Suppressions must not be added merely to make CI green.

## Relationship to other security controls

This scan complements, rather than replaces:

- server-side tenant/project/broker/self authorization;
- production fail-fast secret/config validation;
- hardened trusted-proxy and request-body boundaries;
- security response headers and edge/WAF deployment contract;
- HMAC/encrypted identity/contact handling;
- immutable provider/payment idempotency;
- malware/MIME document trust certification;
- PRENEURA Admin break-glass support access;
- structured PII-redacted logs and OpenTelemetry.

## Gate 7 boundary

Gate 6 static analysis cannot certify deployed network controls. Gate 7 must still verify the actual staging/production environment for:

- WAF and ingress policy;
- TLS/certificate configuration;
- private service networking;
- managed secret injection/rotation;
- cloud IAM and object-storage policy;
- provider webhook allowlisting/signature configuration;
- external penetration testing / security review where required by the deployment agreement.
