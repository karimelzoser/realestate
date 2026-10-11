# PRENEURA database backup and recovery

This document defines the production PostgreSQL backup/restore contract for PRENEURA. It does **not** claim to back up S3-compatible document/object storage; database recovery and object-storage disaster recovery are separate controls and both are required before production go-live.

## Recovery objectives

Set explicit production targets per deployment before launch:

- **RPO** — maximum acceptable data loss window. For a transactional production database, enable PostgreSQL WAL archiving / point-in-time recovery in addition to scheduled logical backups when the hosting architecture supports it.
- **RTO** — maximum acceptable time to restore database service and validate application readiness.

The exact target values belong to the deployment/SLA decision, but the system must have measured restore evidence rather than an untested assumption.

## Supported logical backup command

From `platform/`:

```bash
DATABASE_URL='postgresql://...' \
BACKUP_DIR=/secure/preneura-backups \
BACKUP_LABEL=preneura-production \
RELEASE_SHA=<deployed-git-sha> \
bash scripts/backup-postgres.sh
```

The command:

1. fails if required PostgreSQL tooling is absent;
2. refuses a database whose runtime contract and latest immutable migration-ledger row disagree;
3. writes with `umask 077`;
4. creates a PostgreSQL custom-format archive with owner/ACL portability;
5. verifies that `pg_restore` can enumerate the archive before promotion;
6. creates a SHA-256 sidecar;
7. records release SHA, schema compatibility and migration-ledger metadata;
8. emits the resulting backup path/digest for the calling backup system.

The local backup directory is a staging location, not the final durability boundary. Production automation must move the archive, checksum and metadata together into encrypted backup storage with retention controls and access separate from the primary database host.

## Backup artifact set

A logical backup is a three-file set:

```text
<name>.dump
<name>.dump.sha256
<name>.dump.meta
```

Do not retain or restore one file without the other two.

The metadata records:

- backup format;
- UTC creation time;
- deployed release SHA when supplied;
- database schema version;
- minimum compatible runtime version;
- migration marker;
- latest immutable migration-ledger version/filename;
- backup SHA-256.

## Supported restore command

Always restore into a new/empty database first:

```bash
RESTORE_DATABASE_URL='postgresql://.../preneura_restore' \
BACKUP_FILE=/secure/preneura-backups/preneura-production-....dump \
bash scripts/restore-postgres.sh
```

The restore command fails closed when:

- the archive/checksum/metadata is missing;
- the exact backup bytes do not match the recorded SHA-256;
- `pg_restore` cannot enumerate the archive;
- the target already contains public database objects, unless an operator explicitly sets `RESTORE_ALLOW_NONEMPTY=true`;
- the restored runtime contract does not match backup metadata;
- the restored migration ledger does not match backup metadata.

A successful restore uses one `pg_restore --single-transaction --exit-on-error` operation and runs `ANALYZE` afterward.

`RESTORE_ALLOW_NONEMPTY=true` is an emergency/destructive escape hatch, not the normal recovery procedure. It must not be used in automated drills or normal production restores.

## Post-restore validation

A database restore is not complete until all of the following pass:

1. archive SHA-256 verified;
2. runtime contract and migration ledger agree;
3. application `/v1/health/ready` returns HTTP 200 against the restored database;
4. representative business data is present and internally consistent;
5. append-only/immutable database protections still reject forbidden mutations;
6. login/catalog/transaction/finance smoke checks pass in the recovery environment;
7. object-storage references required by restored records are available from the separately restored/versioned object store.

Only after validation should traffic be redirected or the restored database be promoted.

## Object-storage recovery is separate

PostgreSQL stores object keys, hashes and business state; document/template/signature/master-plan bytes live in S3-compatible storage. A database dump cannot recreate those bytes.

Production must therefore configure and test the storage provider's equivalent of:

- versioning or immutable snapshots;
- cross-host or cross-region replication where required by the deployment RPO;
- encrypted backup storage;
- retention/lifecycle rules;
- restoration into an isolated bucket/namespace;
- hash validation against the SHA-256 values preserved in PostgreSQL.

The Gate 6 database recovery workflow intentionally does not claim this provider-specific storage recovery is certified. That will require the actual production storage implementation/provider.

## Retention

Use a documented policy appropriate to the business/legal requirements. A normal policy distinguishes at least:

- frequent operational/PITR recovery window;
- daily logical backups;
- longer weekly/monthly retention;
- legal/financial retention where applicable.

Backup deletion must be access-controlled separately from normal application credentials so an application compromise cannot erase every recovery copy.

## Restore drills

Run restore drills:

- before first production launch;
- after material database/migration architecture changes;
- periodically during production operations;
- after changing backup provider, PostgreSQL major version or encryption/retention policy.

Measure and record:

- backup size;
- backup duration;
- restore duration;
- readiness-validation duration;
- achieved RPO/RTO;
- migration/schema version;
- deployed application release SHA;
- drill result and owner.

## CI certification

`.github/workflows/database-recovery-certification.yml` runs an isolated PostgreSQL 18 restore drill. It:

1. migrates a clean source database with the real release migrator;
2. inserts deterministic tenant/project/catalog/pricing/inventory records;
3. creates the real custom-format backup artifact;
4. restores it into a new database;
5. compares deterministic representative business fingerprints;
6. boots the emitted API and requires `/v1/health/ready` against the restored database;
7. proves restoring over a non-empty target is rejected;
8. corrupts an archive and proves checksum verification rejects it before restore;
9. proves runtime-contract and migration-ledger immutability protections survived the restore.

Passing this workflow is executable evidence that the PostgreSQL logical backup path is restorable. It is not a substitute for periodic production-scale restore drills or object-storage disaster recovery testing.
