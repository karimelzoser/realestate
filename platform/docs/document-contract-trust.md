# Document and Contract Trust

This document is the production operating contract for PRENEURA document trust and executed-contract evidence.

## Scope

The trust pipeline applies to new document templates, transaction documents and uploaded signature images used by the transaction/contract flow. It does not claim that every object in project storage is malware-scanned; project master-plan assets have storage integrity metadata but are outside this document/contract trust slice.

## Required production configuration

The API requires the normal object-storage configuration plus a malware scanner endpoint:

- `DOCUMENT_SCANNER_URL` — required for a new object to become trusted.
- `DOCUMENT_SCANNER_TOKEN` — optional bearer token for the scanner endpoint.
- `DOCUMENT_SCANNER_TIMEOUT_MS` — optional timeout. PRENEURA clamps it between 1,000 and 60,000 ms; default is 20,000 ms.

If `DOCUMENT_SCANNER_URL` is missing, unreachable, times out, returns invalid JSON, or returns an invalid verdict, the object does **not** become trusted. PRENEURA records a failed scan attempt and fails closed.

There is no development or production fallback that silently marks an object clean.

## Scanner request contract

PRENEURA performs object-storage integrity verification first, then local binary file-type detection, then calls the external malware scanner.

The scanner receives an HTTP `POST` with JSON:

```json
{
  "objectUrl": "<short-lived signed object URL>",
  "expectedSha256Hex": "<64-character lowercase SHA-256>",
  "detectedMimeType": "application/pdf",
  "byteSize": 12345
}
```

The scanner should:

1. Download the object from `objectUrl` before the URL expires.
2. Recompute SHA-256 and require it to equal `expectedSha256Hex`.
3. Scan the downloaded bytes with the configured malware engine.
4. Return one terminal verdict.

Clean response:

```json
{
  "verdict": "CLEAN",
  "engine": "clamav",
  "engineVersion": "1.4.x",
  "reference": "scan-123"
}
```

Infected response:

```json
{
  "verdict": "INFECTED",
  "engine": "clamav",
  "engineVersion": "1.4.x",
  "reference": "scan-124",
  "signature": "Malware.Signature.Name"
}
```

`verdict` must be `CLEAN` or `INFECTED`. An infected verdict must contain a malware signature. PRENEURA does not accept an ambiguous or incomplete terminal response.

## Local content-type verification

Before the external scan, PRENEURA reads the stored object and detects its binary file type with `file-type`.

For the object to proceed:

- the object-storage content length must match the original upload intent;
- the object-storage content type must match the upload intent;
- the object SHA-256 must match the signed upload intent;
- detected binary MIME must match the declared MIME.

A MIME mismatch is a terminal rejection and is stored in the immutable scan audit.

Transaction documents/templates currently allow the MIME types defined in the contracts package, including PDF, JPEG, PNG and DOCX. Uploaded drawn/signature images are limited to PNG or JPEG.

## Trust states and evidence

`storage_object_trust` is the authoritative trust projection. New objects move through states such as `PENDING_SCAN`, `SCAN_FAILED`, `CLEAN`, or `REJECTED`.

Every scan attempt is appended to `storage_object_scan_attempts`. Scan-attempt rows cannot be updated or deleted. PostgreSQL also rejects attempts to set a trust record to `CLEAN`, `REJECTED`, or `SCAN_FAILED` unless that state and its metadata reconcile to the latest immutable scan attempt.

A business record is not allowed to choose an arbitrary trusted object. PostgreSQL binds document templates, transaction documents and uploaded signatures to a trust record using the object identity: tenant/project scope, purpose, object key and SHA-256.

## Fail-closed business rules

A new active document template requires its matching `CLEAN` object.

A transaction document cannot become `VERIFIED`, `SIGNED`, or `STAMPED` unless its matching object is `CLEAN`.

An uploaded/drawn signature cannot be recorded unless the signature object is `CLEAN`. Typed signatures have no binary object and therefore no object-trust reference, but they still require a trusted, verified contract.

Required signer roles and signing order come from the versioned document-template signer requirements. Required earlier signers must be present before a later signer is accepted.

## Legacy objects

Objects created before the trust migration are backfilled as `LEGACY_UNSCANNED`; migration never silently labels them clean.

When an existing transaction document is used for a new trust-sensitive action, PRENEURA re-verifies its stored hash/size/MIME against object storage and runs it through the current scanner before allowing verification/signing.

Historical contracts that were already stamped before this trust model are preserved by migration with a historical execution snapshot that may carry `LEGACY_UNSCANNED`. This compatibility exception exists only for pre-existing executed evidence. New execution requires `CLEAN` document trust.

Existing legacy template objects are not automatically promoted to `CLEAN`. A new active template version should be uploaded through the current trust pipeline. The execution snapshot always records the exact template version and template SHA-256 used by the contract.

## Signed and executed contract immutability

Once signatures exist on a contract, it cannot be superseded as if it were an unsigned draft.

Signature rows are immutable evidence. They cannot be edited or deleted.

A fully signed contract may transition only to executed/stamped status. Execution is atomic and records:

- executing user;
- execution timestamp;
- trusted contract SHA-256;
- document template ID, version and SHA-256;
- certified reservation pricing version and quoted total;
- all three certified price components and their area/rate/amount snapshots;
- signer role, user, method, signature hash/provider evidence and signature time.

PostgreSQL materializes this as one `contract_execution_snapshots` record and computes a SHA-256 over the canonical JSON manifest. The snapshot, the stamped document and signature evidence are immutable.

## Reading execution evidence

Authenticated transaction users can read the immutable execution evidence at:

`GET /v1/tenants/:tenantId/projects/:projectId/transactions/:transactionId/contract-execution`

The endpoint uses the existing document-read authorization boundary, including buyer-self access where applicable. It returns `null` before contract execution.

The transaction workspace renders the same evidence: execution time/actor, trust status, template version/hash, certified reservation value, signer evidence, contract SHA-256 and manifest SHA-256.

## Audit data and privacy

PRENEURA audit tables store object identity, hashes, detected/declared MIME, scan verdict, engine/version, provider reference, malware signature/error code, timestamps and business linkage. They do not persist the document bytes or scanner response bodies in the audit database.

The external scanner receives a short-lived signed object URL. Scanner operators are responsible for securing scanner logs, downloads and any retained malware samples according to the deployment security policy.

## Release certification

`.github/workflows/document-contract-trust-certification.yml` rebuilds PostgreSQL 18 from zero and runs `platform/packages/database/tests/gate3_document_contract_trust_certification.sql`.

The certification proves, among other cases:

- CLEAN trust cannot be forged without immutable scan evidence;
- untrusted templates/documents/signatures are rejected;
- object identity binds the correct CLEAN trust record;
- signer ordering is enforced;
- a signed contract cannot be superseded;
- execution requires actor/time and certified reservation pricing;
- execution creates a verifiable manifest with price and signer evidence;
- scan attempts, signatures, stamped contracts and execution snapshots are immutable.
