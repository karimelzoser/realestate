# PRENEURA Real Estate OS

Persistent source repository for the PRENEURA Real Estate Operating System prototype.

## Current baseline

- Product: PRENEURA Real Estate OS
- Stable standalone fallback: Rev 6.1.6
- Modular online release: 6.3.0
- Main experience: Metro-style "How PRENEURA Works" system overview
- Core operating model:
  - Buyer Direct / Broker / Sales Center entry
  - One Buyer Record + EOI
  - Eligibility gate
  - Online / Sales Center attendance split
  - One Shared Queue
  - Parallel allocation capacity
  - Online buyer -> Local Egyptian AI Voice Allocation Advisor
  - Offline buyer -> Human Allocator
  - Exact Unit Selection
  - Unit Lock
  - Transaction Operator
  - Contract & Sign
  - My Property / installments / documents / support

## Live demo

https://karimelzoser.github.io/realestate/

The public demo is deployed from `main` by GitHub Pages. The online entry uses the modular source while `app/index.html` remains the stable standalone fallback. GitHub Pages hosts the buyer UI; the full speech models run locally through `local_voice_agent/` when installed on the buyer/developer machine.

## Run the project

### Stable standalone demo

Open `app/index.html` for the known-good self-contained Rev 6.1.6 artifact.

### Modular development build

```bash
npm install
npm run dev
```

The root `index.html` keeps the stable application shell but replaces extracted active inline revisions with source files under `src/`.

## Local Egyptian voice allocation

PRENEURA 6.3 adds a live Egyptian Arabic advisor for the **online allocation** path. It automatically introduces itself, guides Master Plan → Building → Floor → Exact Unit, ranks currently available units against buyer preferences, scrolls/highlights what it is describing, compares alternatives and supports hands-free interruption/barge-in.

Default local stack:

- ASR: `CohereLabs/cohere-transcribe-arabic-07-2026`
- ASR fallback: `dev-ahmedhany/whisper-large-v3-turbo-arabic-ft-ct2-int8`
- Agent brain: `Qwen/Qwen3-30B-A3B-Instruct-2507`
- Egyptian TTS: `mohammedaly22/VoiceTut-TTS`
- Default Egyptian female speaker: `Omnia`

See `local_voice_agent/README.md` for installation and runtime instructions.

## Current modular source

- `src/core/product-model.js` — canonical roles, flow routes, allocation policy and action boundaries
- `src/core/role-policy.js` — real-role navigation and capability boundaries
- `src/core/state.js` — stable shared-state facade while legacy data is migrated
- `src/features/live-allocation/` — shared queue and Live Allocation Day
- `src/core/flow-navigation.*` — How It Works return navigation and overview controls
- `src/core/router.*` — OPEN direct preview vs ROLE-restricted navigation
- `src/features/buyer-experience/` — Buyer/My Property examples and post-sale UI
- `src/features/how-it-works/` — Metro system map and flow-route audit
- `src/features/flow-preview/` — direct-preview fixtures and Contract demo completion helpers
- `src/features/local-voice-agent/` — authoritative unit ranking, guided navigation, live audio/VAD/barge-in and Egyptian advisor UI
- `local_voice_agent/` — local ASR + Qwen agent + Egyptian streaming TTS backend
- `docs/MODULARIZATION.md` — safe migration plan for the remaining legacy domains

## Repository strategy

- `main` — stable published demo
- `develop` — integration branch
- feature/refactor/fix branches — focused work reviewed before integration

Future changes should be made in focused branches / pull requests so the current working demo remains recoverable.

## Important product boundaries

- PRENEURA is authoritative for queue, exact-unit inventory, locks, payment state, contract state, and audit.
- AI can explain, recommend, compare, navigate, scroll, highlight, and perform safe reversible actions.
- The local voice agent receives decision-relevant buyer preferences and available-unit data, not arbitrary personal profile fields.
- AI must not silently commit legal/financial actions such as unit lock, payment confirmation or final contract signature.
- Direct preview from the system map may prepare deterministic demo prerequisites so the destination page can be fully tested.
- Entering via a real role must preserve that role's permissions and workflow restrictions.

See `docs/PRODUCT_ARCHITECTURE.md` and `docs/WORKING_RULES.md` for the detailed operating model.
