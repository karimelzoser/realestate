# PRENEURA Real Estate OS — Full Project Review (6.5)

## Executive assessment

The product concept and workflow coverage are strong enough for a serious real-estate developer demonstration: the six-role operating model is clear, the buyer journey is end-to-end, exact-unit selection/lock is explicit, transaction completion is separated from allocation, My Property has post-sale visibility, the Manager has operational intelligence, and the online allocation path has a local Egyptian voice advisor.

The current repository is still a **high-fidelity modular prototype / demo runtime**, not yet a production-grade multi-user transaction system. The biggest remaining work is no longer page design. It is moving authoritative state, concurrency, identity, documents, payments and audit from browser memory into a real backend.

## What is already strong

- One Buyer Record + EOI across Buyer Direct / Broker / Sales Center.
- One shared queue and one priority truth across Online and Sales Center attendance.
- Clear assistance split: Online → AI Allocation Advisor; Sales Center → Human Allocator.
- Master Plan → Building → Floor → Exact Unit → Unit Lock hierarchy.
- Transaction Operator owns payment, documents, finance and contract readiness.
- Contract signing and My Property are represented as separate post-lock stages.
- Six-role navigation/capability model is encoded and tested.
- Manager Overview, project imports, phase unit selection, Buyer 360°, broker metrics and audit have dedicated surfaces.
- Static validation + Chromium browser QA run in CI before deployment.
- New 6.5 Manager Live Allocation and Buyer Journey Audit expose the complete active queue and richer journey detail.

## P0 — required before a real developer can trust PRENEURA with live sales

### 1. Move transactional truth to a backend database

Current extracted modules still read the legacy in-browser `app.fx` state through `src/core/state.js`. For production, Buyer, EOI, Queue Token, Unit, Lock, Transaction, Payment, Contract, Installment and Audit must be server-side records.

Recommended foundation:
- PostgreSQL for transactional truth.
- Server API with explicit domain commands.
- WebSocket/SSE stream for live queue / unit / transaction updates.
- Redis only for ephemeral presence/cache, never as the only source of truth.

### 2. Make exact-unit locking truly atomic

The business rule is correct, but production locking must be enforced server-side with:
- database transaction / row lock;
- unique active lock per physical unit;
- lock TTL / expiry;
- idempotency key;
- optimistic version / price version validation;
- explicit release reason;
- race-condition tests with many concurrent buyers.

Queue position must never imply inventory reservation.

### 3. Real authentication, tenant isolation and server-side RBAC

`src/core/role-policy.js` is useful UI policy but client-side checks are not security.

Production needs:
- OIDC/SSO identity;
- immutable user ID;
- organization / developer tenant ID;
- project scope;
- role + permission claims;
- server authorization on every command;
- broker-company and broker-agent delegation boundaries;
- session expiry / revocation.

### 4. Immutable operational audit

The browser audit is useful for UX, but the production audit must be append-only and server-generated.

Each event should include:
- event ID;
- timestamp from server;
- tenant / project / phase;
- buyer ID;
- EOI / queue token / unit / lock / transaction / contract IDs;
- role;
- actual user ID + display name;
- source system / integration;
- action;
- before / after state where applicable;
- reason / override reason;
- correlation / request ID;
- result (success / rejected / failed);
- optional device/IP metadata subject to privacy policy.

The 6.5 Buyer Journey Audit UI is already shaped for this richer event model.

### 5. Persistent document and contract storage

Current demo uploads mostly retain browser-side metadata. Production needs:
- S3-compatible object storage;
- file hash;
- MIME validation;
- malware scanning;
- document category / version;
- uploader user ID;
- verifier user ID;
- timestamps;
- signed URL access;
- retention policy;
- immutable executed-contract copy;
- biometric/signature provider receipt only, never raw biometric templates unless legally required and designed for it.

### 6. Payment and finance reconciliation

Implement payment intents / evidence / verification as server-side records with:
- idempotent gateway webhooks;
- cheque / bank-transfer evidence workflow;
- partial payments;
- refunds / reversals;
- reconciliation status;
- installment allocation;
- overdue aging;
- finance-provider workflow;
- accounting export.

## P1 — high-value product improvements

### 7. Project-data import as a real controlled ingestion pipeline

The Manager Project Data page should evolve from file selection into:

`Upload → Map Columns → Validate → Preview Errors → Approve Import → Version → Publish`

For inventory imports validate:
- project / phase / building / floor relationships;
- unique physical unit code;
- type;
- area;
- view;
- base price;
- payment-plan eligibility;
- sales status;
- master-plan coordinates / BIM reference where available.

Never silently overwrite live inventory/pricing from a spreadsheet.

### 8. Phase Builder visual + table modes

Keep both modes:
- Master Plan visual selection for buildings / clusters;
- searchable table for exact-unit bulk selection.

Add:
- include/exclude filters;
- bulk price adjustment;
- phase-specific availability window;
- preview of affected units;
- approval / publish step;
- rollback to previous phase version.

### 9. Manager intelligence should become decision-grade

Add to Overview:
- sales velocity by day/week/month;
- sell-through by phase/building/type;
- inventory aging;
- price-change history and conversion impact;
- EOI → queue → allocation → lock → payment → signed conversion funnel;
- queue SLA and no-show rate;
- allocator utilization;
- AI-online vs Sales Center conversion;
- cancellations and reasons;
- collections due / overdue / forecast;
- broker leaderboard and quality metrics;
- top demand vs remaining inventory mismatch;
- alerts with drill-down.

### 10. Real-time event transport

The 6.5 manager pages auto-refresh browser state every 1.5 seconds. In production replace polling with a project event stream so all users see the same updates immediately.

Events should include at least:
- buyer checked in;
- queue token issued / called / grace / no-show;
- allocation session started / ended;
- unit selected;
- unit lock acquired / expired / released;
- payment updated;
- document verified;
- contract generated / signed;
- installment paid / overdue.

### 11. Voice allocation production transport

The local Egyptian voice runtime is a good architecture for private inference, but the production path needs a deployment choice:
- developer-hosted private inference gateway; or
- controlled Sales Center / buyer kiosk local runtime.

For internet buyers, a browser on GitHub Pages cannot use a server's `127.0.0.1`; use a secured HTTPS/WSS inference endpoint or WebRTC media gateway.

Benchmark:
- voice activity detection latency;
- ASR first/complete transcript;
- LLM first token;
- TTS first audio;
- end-to-end interruption / barge-in.

### 12. Multi-project / multi-developer tenancy

Every record should have explicit tenant + project scoping. A real customer will expect one corporate account to operate multiple projects and phases without data mixing.

## P2 — quality, scale and maintainability

### 13. Complete modular extraction

`app/index.html` is still a large legacy shell. Continue extracting:
- Buyer core domain;
- Queue Receptionist;
- Allocator;
- Transaction Operator;
- Broker;
- Manager;
- shared UI components;
- demo fixtures.

Then remove obsolete historical revision blocks.

### 14. Concurrency and failure testing

Add tests for:
- 50–500 simultaneous queue joins;
- two buyers selecting the same exact unit;
- lock expiry while payment is starting;
- duplicate payment webhook;
- browser refresh during allocation;
- Allocator disconnect/reconnect;
- AI service unavailable mid-tour;
- document upload failure;
- contract provider timeout;
- no-show / recall / queue recovery.

### 15. Observability

Add:
- structured logs;
- metrics;
- traces;
- queue depth and wait-time alerts;
- lock conflict rate;
- payment failure rate;
- document-verification backlog;
- AI latency / fallback rate;
- audit export.

### 16. Accessibility and bilingual design system

Standardize:
- typography scale;
- RTL layout;
- Egyptian Arabic + formal Arabic terminology policy;
- keyboard navigation;
- focus states;
- screen-reader labels;
- color contrast;
- responsive breakpoints;
- reusable table / KPI / timeline / upload / workflow components.

## Recommended implementation order

1. Backend domain model + PostgreSQL.
2. Authentication / tenant / server RBAC.
3. Atomic unit-lock and queue APIs.
4. Append-only audit/event model + realtime event stream.
5. Persistent documents + contract execution storage.
6. Payment / installment ledger + reconciliation.
7. Project import / version / publish pipeline.
8. Wire Manager Live Allocation and Buyer Journey Audit to server events.
9. Wire all role pages to backend commands/queries.
10. Productionize private Egyptian voice inference.
11. Finish modular extraction and remove legacy shell.
12. Load/concurrency/security testing.

## Conclusion

PRENEURA can be improved substantially, but the next quality jump should **not** be another large visual redesign. The strongest next investment is turning the already-good operating model into a real server-authoritative transaction platform. The current UI is now detailed enough to serve as the product specification for that backend.
