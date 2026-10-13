# PRENEURA Production Backup, Restore & Disaster Recovery

This runbook defines the database/object-storage recovery contract for PRENEURA Real Estate OS. It supplements, and does not replace, the cloud provider's managed backup controls.

## Recovery objectives

Initial production targets:

- PostgreSQL RPO: <= 5 minutes when managed PITR/WAL archiving is enabled.
- PostgreSQL RTO: <= 60 minutes for a single-region logical/point-in-time restore rehearsal target.
- Object storage RPO: provider/versioning dependent; production buckets must have versioning enabled.
- Object storage RTO: <= 60 minutes for restore of a transaction-critical object from a retained version.

These are launch targets, not contractual SLAs until validated against the chosen production region/account.

## Authoritative recovery scope

A valid database recovery must preserve, at minimum:

- tenants/projects and access scopes;
- project/catalog/pricing/inventory state;
- buyer/EOI/queue/reservation/transaction state;
- immutable quote snapshots;
- document metadata, signatures and executed-contract manifests;
- payment events, ledger entries, allocations and cheque event history;
- commission plans/cases and due state;
- notification jobs/audit;
- domain outbox/replay data needed for durable recovery;
- runtime schema/migration contract and migration history.

Object-storage recovery must preserve the exact bytes referenced by immutable object keys and SHA-256 hashes in PostgreSQL.

## Production PostgreSQL policy

Preferred managed profile: encrypted PostgreSQL with automated snapshots + continuous WAL/PITR.

Required controls:

1. automated backups enabled;
2. PITR retention configured according to business/legal requirements;
3. backup encryption uses managed KMS keys;
4. backup deletion permissions are separated from normal application runtime credentials;
5. a restore is always performed into a new database/cluster first;
6. migrations are never rerun blindly over a restored database before readiness/version checks pass;
7. restore acceptance uses `/v1/health/ready` plus domain reconciliation checks;
8. production backup policy is monitored and alerts when retention/snapshot jobs fail.

## S3-compatible object-storage policy

Production document/master-plan storage must use:

- private buckets only;
- object versioning;
- server-side encryption;
- lifecycle/retention appropriate to contractual/legal obligations;
- restricted delete permissions;
- provider backup/replication when required by the chosen availability objective.

Database restore alone is insufficient if immutable document/signature object bytes are unavailable.

## Logical backup procedure

Logical backups are useful for migration rehearsal and independent recovery evidence. They are not the only production backup mechanism.

Example:

```bash
pg_dump --format=custom --no-owner --no-acl "$DATABASE_URL" > preneura.dump
sha256sum preneura.dump > preneura.dump.sha256
```

Store backup artifacts outside the application host and under restricted access.

## Restore procedure

Never restore destructively over the live production database.

1. create a new isolated PostgreSQL target;
2. restore the backup/PITR target there;
3. verify migration/runtime contract;
4. run database reconciliation/certification checks;
5. start API against the restored target and require `/v1/health/ready` = HTTP 200;
6. start worker only after API/schema readiness is confirmed;
7. verify representative transaction, contract, ledger and commission records;
8. verify immutable object references/hashes for selected documents;
9. perform controlled traffic cutover only after release authority approval;
10. retain the previous production database until rollback/cutover policy permits retirement.

## Forward-repair rule

Database schema rollback is not the normal recovery path. Migrations are append-only and checksum-certified. If a migration is wrong after it has been applied, use a reviewed forward repair migration. Application rollback is allowed only while the database runtime compatibility contract still permits the older runtime.

## CI restore certification

`.github/workflows/backup-restore-certification.yml` performs a disposable PostgreSQL 18 logical backup/restore rehearsal. It verifies:

- a fully migrated synthetic source can be dumped and restored into a new database;
- runtime/migration contracts survive restore;
- quote snapshots survive restore;
- immutable contract execution evidence survives restore;
- finance ledger/event/allocation evidence survives restore;
- cheque event/replacement history survives restore;
- commission data survives restore;
- restored database passes structural reconciliation and runtime readiness;
- dump SHA-256 is generated and checked before restore.

The CI rehearsal is logical-backup evidence. Managed-provider PITR must still be rehearsed in staging/production infrastructure before Gate 7.

## Required production rehearsal evidence

Before production go/no-go, record:

- source backup/PITR timestamp;
- target restore timestamp;
- measured RPO;
- measured RTO;
- restored database identifier;
- backup checksum/snapshot identifier;
- reconciliation query results;
- `/v1/health/ready` evidence;
- representative object-storage restore/hash evidence;
- approver and incident/rehearsal ticket reference.
