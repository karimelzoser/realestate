# PRENEURA Real Estate OS

Persistent source repository for the PRENEURA Real Estate Operating System prototype.

## Current baseline

- Product: PRENEURA Real Estate OS
- Stable standalone fallback: Rev 6.1.6
- Modular online release: 6.7.0
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
  - Exact Unit Lock + short handoff grace
  - Optional approved 24-hour extended grace
  - Transaction Operator
  - Contract & Sign
  - My Property / installments / documents / support
  - Manager live allocation command center + detailed buyer journey audit
  - Presentation control with deterministic management scenarios

## Live demo

https://karimelzoser.github.io/realestate/

The public demo is deployed from `main` by GitHub Pages. The online entry uses the modular source while `app/index.html` remains the stable standalone fallback. GitHub Pages hosts the browser UI; full local speech/model inference runs through `local_voice_agent/` on a local/private inference machine.

## PRENEURA 6.7 — English live allocation + unit-lock grace

The active online allocation advisor is **English-only for now**. The visible live agent introduces itself, guides Master Plan → Building → Floor → Exact Unit, ranks currently available units against buyer preferences, scrolls/highlights what it is describing, compares alternatives and keeps the final exact-unit lock under explicit buyer control.

When the private local AI runtime is connected, the browser uses local ASR + the local Qwen agent + the configured local TTS runtime. When it is not connected, the product retains an English browser-voice/text fallback so the presentation journey does not stop.

The 6.7 local runtime uses an English Faster-Whisper profile by default:

- ASR: `Systran/faster-whisper-large-v3-turbo`
- Agent brain: `Qwen/Qwen3-30B-A3B-Instruct-2507`
- Local TTS/streaming transport: existing PRENEURA private runtime; browser English speech fallback remains available
- Current conversation contract: English only

The legacy Arabic/Egyptian model work remains in the repository for future language re-enablement, but it is not the active buyer-facing voice experience in 6.7.

### Two-stage exact-unit lock grace

An exact physical unit lock now exposes an explicit grace state across Buyer, Allocator, Transaction Operator and Manager surfaces.

1. **Short handoff grace** — starts after the exact unit is locked while Allocation hands the buyer to Transaction Operations. The demo default is 15 minutes and can be adjusted for new locks.
2. **24-hour extended grace** — never starts automatically:
   - **Online:** the buyer requests more time; the Transaction Operator must approve or reject the request.
   - **Sales Center / Offline:** the Transaction Operator may grant a 24-hour paperwork exception when the buyer needs more time to complete physical documents.

The grace record keeps the buyer, exact unit, lock reference, channel, countdown, request reason, decision and audit events. The Transaction Operator has a shared **Grace Decision Inbox** so pending requests remain visible even when another transaction record is currently open.

The Manager Live Allocation page includes the unit-lock grace control table so management can see short grace, pending extension requests, approved 24-hour exceptions and expiry state alongside live allocation operations.

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

See `docs/PRESENTATION_6.6.md` for the recommended meeting sequence. The operational flow remains the same in 6.7, with the English-only advisor and lock-grace controls added.

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
- `src/features/local-voice-agent/` — authoritative unit ranking, live audio/VAD/barge-in plus the current English-only allocation advisor layer
- `src/features/lock-grace/` — short handoff grace, 24-hour exception/request approval, countdowns and Transaction Operator decision inbox
- `src/features/production-ops/` — contract requirements, Allocator assignment, Transaction Operator execution, My Property finance, Manager project/phase/buyer/broker operations
- `src/features/manager-live/` — uncapped live manager queue/capacity/locks/event feed and detailed per-buyer journey audit
- `src/features/presentation/` — deterministic demo scenarios, Manager presentation controls and decision room
- `local_voice_agent/server67.py` — active English-only local agent runtime
- `docs/MODULARIZATION.md` — safe migration plan for the remaining legacy domains
- `docs/PROJECT_REVIEW_6.5.md` — production-readiness review and prioritized next architecture work
- `docs/PRESENTATION_6.6.md` — recommended customer-presentation sequence and talking points

## Repository strategy

- `main` — stable published demo
- `develop` — integration branch
- feature/refactor/fix/release branches — focused work reviewed before integration

Future changes should be made in focused branches / pull requests so the current working demo remains recoverable.

## Important product boundaries

- PRENEURA is authoritative for queue, exact-unit inventory, locks, payment state, contract state and audit.
- AI can explain, recommend, compare, navigate, scroll, highlight and perform safe reversible actions.
- The voice agent receives decision-relevant buyer preferences and available-unit data, not arbitrary personal profile fields.
- AI must not silently commit legal/financial actions such as unit lock, payment confirmation or final contract signature.
- A 24-hour Online grace extension requires Transaction Operator approval.
- A 24-hour Offline paperwork exception can only be granted by Transaction Operations.
- Direct preview from the system map may prepare deterministic demo prerequisites so the destination page can be fully tested.
- Entering via a real role must preserve that role's permissions and workflow restrictions.
- Presentation scenarios modify only the in-memory demo state and can be reset immediately.

## Production-readiness note

The current app is a high-fidelity modular prototype. The next major engineering step is to move authoritative state, locking, identity, documents, payments and audit from browser memory into a server-side transactional platform. See `docs/PROJECT_REVIEW_6.5.md` for the recommended implementation order.

See `docs/PRODUCT_ARCHITECTURE.md` and `docs/WORKING_RULES.md` for the detailed operating model.
