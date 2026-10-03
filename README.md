# PRENEURA Real Estate OS

Persistent source repository for the PRENEURA Real Estate Operating System prototype.

## Current baseline

- Product: PRENEURA Real Estate OS
- Stable standalone fallback: Rev 6.1.6
- Modular online release: 6.7.1
- Main experience: Metro-style "How PRENEURA Works" system overview
- Core operating model:
  - Buyer Direct / Broker / Sales Center entry
  - One Buyer Record + EOI
  - Eligibility gate
  - Online / Sales Center attendance split
  - One Shared Queue / one priority truth
  - Online buyer -> English Live AI Allocation Advisor
  - Offline buyer -> Human Allocator
  - Exact Unit Selection
  - Exact Unit Lock + Short Handoff Grace
  - Optional approved 24h Extended Grace
  - Transaction Operator
  - Contract & Sign
  - My Property / installments / documents / support
  - Manager live allocation command center + detailed buyer journey audit
  - Presentation control with deterministic management scenarios

## Live demo

https://karimelzoser.github.io/realestate/

The public demo is deployed from `main` by GitHub Pages. The online entry uses the modular source while `app/index.html` remains the stable standalone fallback. GitHub Pages hosts the browser UI; full local speech/model inference runs through `local_voice_agent/` on a local/private inference machine.

## PRENEURA 6.7 — English live allocation + unit-lock grace

The active online allocation advisor is **English-only for now**. It guides Master Plan → Building → Floor → Exact Unit, ranks currently available units against buyer preferences, scrolls/highlights what it is describing, compares alternatives and keeps the final exact-unit lock under explicit buyer control.

When the private local AI runtime is connected, the browser uses local ASR + the local Qwen agent + the configured local TTS runtime. When it is not connected, the product retains an English browser-voice/text fallback so the presentation journey does not stop.

The active 6.7 local runtime uses:

- ASR: `Systran/faster-whisper-large-v3-turbo`
- Agent brain: `Qwen/Qwen3-30B-A3B-Instruct-2507`
- Local TTS/streaming transport: existing PRENEURA private runtime; browser English speech fallback remains available
- Current conversation contract: English only

Legacy Arabic/Egyptian model work remains in the repository for future language re-enablement, but it is not the active buyer-facing voice experience in 6.7.

### Direct OPEN preview behavior

`OPEN ↗` from How PRENEURA Works is a deterministic page preview. It prepares only the prerequisites needed to render the selected destination, and it must remain on that exact destination until the user explicitly navigates away or returns to How It Works.

The English allocation advisor still renders on Online allocation preview pages, but its automatic guided tour is paused in direct preview mode. Explicit user requests such as “Take me to the master plan” may still navigate normally. `ROLE ↗` continues to use the real role workflow and restrictions.

### Two-stage exact-unit lock grace

An exact physical unit lock exposes an explicit grace state across Buyer, Allocator, Transaction Operator and Manager surfaces.

1. **Short Handoff Grace** — starts after the exact unit is locked while Allocation hands the buyer to Transaction Operations. The demo default is 15 minutes and can be adjusted for new locks.
2. **24h Extended Grace** — never starts automatically:
   - **Online:** the buyer requests more time with a reason; the Transaction Operator must approve or reject the request.
   - **Sales Center / Offline:** the Transaction Operator may grant a 24-hour paperwork exception when the buyer needs more time to complete approved physical documents.

The grace record keeps buyer, exact unit, lock reference, channel, countdown, request reason, decision and audit events. The Transaction Operator has a shared **Grace Decision Inbox** so pending requests remain visible even when another transaction record is currently open.

The Manager Live Allocation page includes the unit-lock grace control table so management can see Short Handoff Grace, pending extension requests, approved 24-hour exceptions and expiry state alongside live allocation operations.

## Professional presentation mode

Manager pages expose one-click prepared scenarios:

- **Normal Allocation Day** — balanced Online + Sales Center activity.
- **High Queue Pressure** — larger live shared queue with wait-time/capacity pressure.
- **Unit Lock Conflict** — demonstrates exact-unit concurrency protection and the rejected second attempt.
- **Overdue Collections** — exposes missed installments and collection attention.
- **Broker Performance** — populates company / agent / EOI / sales / commission metrics.
- **Reset Demo** — restores the clean in-memory presentation baseline.

The Manager home includes a compact **Management Decision Room** with drill-down KPIs for active queue, wait time, locked/reserved inventory, EOI readiness, overdue installments and broker coverage.

Buyer Journey Audit uses presentation-friendly terminology:

- **Recorded Event** — a captured historical audit action.
- **Current State Snapshot** — the buyer's current operational truth reconstructed from the relevant records.

Use `docs/PRESENTATION_6.7.md` for the current customer-meeting sequence. It includes the English-only advisor, Short Handoff Grace, Online 24h extension approval, Offline paperwork exception and Transaction Operator Grace Decision Inbox.

The final demo review is documented in `docs/FINAL_REVIEW_6.7.md`.

## Run the project

### Stable standalone demo

Open `app/index.html` for the known-good self-contained Rev 6.1.6 artifact.

### Modular development build

```bash
npm install
npm run dev
```

The root `index.html` keeps the stable application shell but replaces extracted active inline revisions with source files under `src/`.

### Local English voice runtime

Linux:

```bash
bash local_voice_agent/start_linux.sh
```

Windows PowerShell:

```powershell
.\local_voice_agent\start_windows.ps1
```

Both launch `local_voice_agent.server67:app` on `127.0.0.1:8765` by default.

## Current modular source

- `src/core/product-model.js` — canonical roles, flow routes, allocation policy and action boundaries
- `src/core/role-policy.js` — real-role navigation and capability boundaries
- `src/core/state.js` — stable shared-state facade while legacy data is migrated
- `src/features/live-allocation/` — shared queue and Allocation Day demo model
- `src/core/flow-navigation.*` — How It Works return navigation and overview controls
- `src/core/router.*` — OPEN direct preview vs ROLE-restricted navigation
- `src/features/buyer-experience/` — Buyer/My Property examples and post-sale UI
- `src/features/how-it-works/` — Metro system map and flow-route audit
- `src/features/flow-preview/` — direct-preview fixtures and Contract demo completion helpers
- `src/features/local-voice-agent/` — authoritative unit ranking, live audio/VAD/barge-in plus the active English-only allocation advisor layer
- `src/features/lock-grace/` — Short Handoff Grace, 24h exception/request approval, countdowns and Transaction Operator decision inbox
- `src/features/production-ops/` — contract requirements, Allocator assignment, Transaction Operator execution, My Property finance, Manager project/phase/buyer/broker operations
- `src/features/manager-live/` — uncapped live manager queue/capacity/locks/event feed and detailed per-buyer journey audit
- `src/features/presentation/` — deterministic demo scenarios, Manager presentation controls and decision room
- `local_voice_agent/server67.py` — active English-only local agent runtime
- `docs/MODULARIZATION.md` — safe migration plan for the remaining legacy domains
- `docs/PROJECT_REVIEW_6.5.md` — production-readiness review and prioritized future architecture work
- `docs/PRESENTATION_6.7.md` — current customer-presentation sequence and talking points
- `docs/FINAL_REVIEW_6.7.md` — final demo-readiness assessment, verified roles/workflows and known non-blocking limitations

## Repository strategy

- `main` — stable published demo
- `develop` — integration branch
- feature/refactor/fix/release branches — focused work reviewed before integration

Future changes should be made in focused branches / pull requests so the current working demo remains recoverable.

## Important product boundaries

- PRENEURA is authoritative for queue, exact-unit inventory, locks, payment state, contract state and audit inside the current demo state.
- AI can explain, recommend, compare, navigate, scroll, highlight and perform safe reversible actions.
- The voice agent receives decision-relevant buyer preferences and available-unit data, not arbitrary personal profile fields.
- AI must not silently commit legal/financial actions such as unit lock, payment confirmation or final contract signature.
- A 24-hour Online grace extension requires Transaction Operator approval.
- A 24-hour Offline paperwork exception can only be granted by Transaction Operations.
- Direct preview from the system map may prepare deterministic demo prerequisites so the destination page can be fully tested.
- Direct preview must remain pinned to the requested destination until explicit navigation; it must not be auto-advanced by the voice advisor.
- Entering via a real role must preserve that role's permissions and workflow restrictions.
- Presentation scenarios modify only the in-memory demo state and can be reset immediately.

## Production-readiness note

The current app is a high-fidelity modular prototype. Authoritative production state, locking, identity, documents, payments, audit and cross-device realtime still need to move from browser/demo state into a server-side transactional platform.

See `docs/PRODUCT_ARCHITECTURE.md`, `docs/WORKING_RULES.md`, `docs/PROJECT_REVIEW_6.5.md` and `docs/FINAL_REVIEW_6.7.md` for the detailed operating model and production boundary.
