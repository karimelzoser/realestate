# PRENEURA project catalog and controlled imports

The Project Catalog is the authoritative project-setup layer for hierarchy, internal physical inventory, master-plan assets, payment-plan definitions, sales windows and controlled bulk imports.

## Selling model

PRENEURA continues to sell by **unit type**, not by asking the buyer to choose an apartment/unit number.

The production hierarchy nevertheless stores the exact internal physical unit so the platform can:

- reconcile developer inventory to buildings and floors;
- render master-plan and building/floor views;
- prevent the same physical unit from backing multiple saleable inventory slots;
- know which exact developer unit ultimately backs a committed reservation/property;
- audit imported inventory against the developer's source data.

`inventory_slots` remain the saleable capacity consumed by locking/reservation. A slot may map to one `physical_unit`, and a physical unit may map to at most one slot. The buyer-facing catalog still aggregates and displays availability by unit type.

## Hierarchy

The hierarchy contains:

- project phases;
- buildings / clusters;
- floors;
- unit types (existing commercial catalog authority);
- internal physical units;
- project / phase / building master-plan assets;
- versioned payment-plan definitions;
- sales windows.

All hierarchy records are tenant/project scoped at the database level.

## Project Setup workspace

Authorized project managers and operations users use `/workspace/project-setup`.

The workspace provides:

- hierarchy counts and tree view;
- physical-unit / inventory mapping visibility;
- CSV, JSON and XLSX import parsing;
- explicit source-column mapping;
- automatic mapping when normalized header names match;
- row-level normalized preview and validation errors;
- atomic publish;
- publication history;
- guarded rollback;
- verified master-plan / 3D / floor-plan asset uploads.

Import administration requires `project.import.manage`. Structural project changes and master-plan asset uploads require `project.manage`.

## Import formats and limits

The browser accepts:

- CSV;
- JSON array of objects;
- XLSX (first worksheet).

Current interactive limits:

- maximum source file size: 5 MB;
- maximum rows per import job: 2,000.

These limits are intentionally conservative for the synchronous operator workflow. Larger migrations should be split into deterministic jobs or handled by a future asynchronous ingestion path, not by increasing browser/API limits without load testing.

The browser computes a SHA-256 digest of the source before staging. The import job stores source identity, mapping and complete raw structured row data. Publication never trusts the source file directly.

## Import families

### Hierarchy

Canonical mapped fields include:

- `phaseCode`, `phaseName`, `phaseSortOrder`;
- `buildingCode`, `buildingName`, `clusterName`, `buildingSortOrder`;
- `floorCode`, `floorName`, `levelNumber`, `floorSortOrder`.

Validation rejects contradictory repeated definitions and invalid existing phase/building relationships.

### Unit types

Canonical fields include:

- `code`;
- `name`;
- `description`;
- `bedroomCount`;
- `indoorAreaSqm`;
- `roofAreaSqm`;
- `gardenAreaSqm`;
- `sortOrder`.

Imports are creation-only; an existing or repeated unit-type code is rejected rather than silently overwritten.

### Physical units

Canonical fields include:

- `internalReference`;
- `displayReference`;
- `buildingCode`;
- `floorCode`;
- `unitTypeCode`;
- `orientation`;
- `viewCode`;
- `cornerPosition`.

Validation requires the building, floor and unit type to exist. Publication creates the internal physical unit and its matching anonymous `inventory_slot` in one transaction.

The buyer still sees unit-type availability, not `internalReference`.

### Pricing

Canonical fields include:

- `pricingLabel`;
- `effectiveAt`;
- `unitTypeCode`;
- `component` (`INDOOR`, `ROOF`, `GARDEN`);
- `ratePerSqm`.

One import represents one pricing version, so all rows must use the same label and effective timestamp and cannot repeat a unit-type/component pair.

**Publishing the import creates a DRAFT pricing version only.** It does not bypass the existing `pricing.publish` authority or commercial price publication workflow.

### Payment plans

Canonical fields include:

- `code`;
- `name`;
- `versionNumber`;
- `effectiveAt`;
- `downPaymentPercent`;
- `installmentCount`;
- `installmentIntervalMonths`;
- `finalPaymentPercent`;
- `maintenancePercent`;
- `notes`.

Imported payment plans are created as DRAFT definitions. Code/version collisions and invalid percentage structures are rejected.

## Format normalization

Business validation operates on format-independent staged rows, so CSV/XLSX/JSON do not receive different commercial rules.

CSV supports quoted values and doubled quotes. JSON must be an array of row objects. XLSX uses the first worksheet, row 1 as headers, converts dates to ISO timestamps, uses formula results when available and flattens rich-text cells. XLSX parsing is dynamically loaded with `exceljs` so ordinary workspace routes do not load the spreadsheet parser.

## Validation and publication

A job can be published only when:

- it is in `VALIDATED`;
- it contains at least one valid row;
- it contains zero invalid rows.

Publication is one PostgreSQL transaction. Any failed row/reference aborts the whole publication.

The platform records every entity created by a publication in `project_import_published_entities` with publication order. This provides deterministic reverse-order rollback lineage.

## Rollback

A published import can be rolled back only while all of its created records remain reversible.

Examples of rollback blockers:

- an imported inventory slot is no longer `AVAILABLE`;
- an imported physical unit/hierarchy node is referenced by later business data;
- a pricing version has left `DRAFT`;
- a payment-plan definition has left `DRAFT`.

Rollback runs in one transaction and deletes entities in reverse creation order. If any deletion is blocked, the transaction aborts and no partial rollback is committed.

A successful rollback changes the import state to `ROLLED_BACK`; publication lineage remains for audit.

## Master-plan asset uploads

Master-plan assets use a verified two-phase upload:

1. the browser computes SHA-256;
2. the API verifies `project.manage`, asset category, content type, bounded metadata and byte size;
3. the API creates a project-scoped object key and a short-lived signed PUT;
4. the browser uploads directly to object storage;
5. finalize performs `HeadObject` verification for object namespace, byte size, MIME type and checksum;
6. only a verified object is registered in `project_master_plan_assets`.

There is no public direct asset-registration endpoint that can bypass this verification path.

Current maximum asset size is 100 MB and asset metadata is capped at 8 KB.

Allowed content is category constrained:

- `MASTER_PLAN_IMAGE`: JPEG, PNG, WebP;
- `MASTER_PLAN_3D`: GLTF, GLB;
- `BUILDING_MODEL`: GLTF, GLB;
- `UNIT_MODEL`: GLTF, GLB;
- `FLOOR_PLAN`: JPEG, PNG, WebP, PDF;
- `OTHER`: the approved image/model/PDF set only.

Generic `application/octet-stream` is not accepted.

This slice does not expose a buyer/public asset-serving endpoint. Before externally serving customer-uploaded objects, the global storage hardening workstream must add MIME sniffing and malware-scan trust state in accordance with the production master plan.

## API surface

Base:

`/v1/tenants/:tenantId/projects/:projectId/project-catalog`

Hierarchy/setup:

- `GET /`;
- `POST /phases`;
- `POST /buildings`;
- `POST /floors`;
- `POST /physical-units`;
- `POST /payment-plans`;
- `POST /sales-windows`.

Imports:

- `GET /imports`;
- `POST /imports`;
- `POST /imports/:jobId/rows`;
- `PATCH /imports/:jobId/mapping`;
- `POST /imports/:jobId/validate`;
- `GET /imports/:jobId`;
- `POST /imports/:jobId/publish`;
- `POST /imports/:jobId/rollback`.

Verified assets:

- `POST /assets/upload-intent`;
- `POST /assets/finalize`.

## Database guardrails

PostgreSQL enforces:

- project/tenant hierarchy foreign keys;
- building/floor/unit-type ownership for internal physical units;
- one inventory slot per physical unit;
- master-plan building/phase consistency;
- one active payment-plan version per project/code;
- import row uniqueness;
- publication lineage uniqueness/order;
- explicit `ROLLED_BACK` state synchronization.

CI migrates PostgreSQL 18 from zero and asserts the hierarchy/import tables, physical-unit mapping FK/index, master-plan trigger, publication-lineage indexes and rollback-state trigger. The same branch workflow also runs strict TypeScript, production builds and the existing Chromium regression suite.
