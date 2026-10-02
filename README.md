# PRENEURA Real Estate OS

Persistent source repository for the PRENEURA Real Estate Operating System prototype.

## Current baseline

- Product: PRENEURA Real Estate OS
- Stable standalone fallback: Rev 6.1.6\n- Modular online release: 6.2.0
- Main experience: Metro-style "How PRENEURA Works" system overview
- Core operating model:
  - Buyer Direct / Broker / Sales Center entry
  - One Buyer Record + EOI
  - Eligibility gate
  - Online / Sales Center attendance split
  - One Shared Queue
  - Parallel allocation capacity
  - Online buyer -> AI Allocation Advisor
  - Offline buyer -> Human Allocator
  - Exact Unit Selection
  - Unit Lock
  - Transaction Operator
  - Contract & Sign
  - My Property / installments / documents / support

## Live demo

https://karimelzoser.github.io/realestate/

The public demo is deployed from `main` by GitHub Pages. The online entry uses the modular source while `app/index.html` remains the stable standalone fallback.

## Run the project

### Stable standalone demo

Open:

`app/index.html`

This is the known-good self-contained Rev 6.1.6 artifact.

### Modular development build

Run:

```bash
npm install
npm run dev
```

Then open the root development URL shown by Vite.

The root `index.html` keeps the stable application shell but replaces extracted active inline revisions with source files under `src/`. This lets us improve the product without appending another large revision block to the 2 MB HTML file.

## Current modular source

- `src/core/product-model.js` — canonical roles, flow routes, allocation policy and action boundaries
- `src/core/role-policy.js` — real-role navigation and capability boundaries
- `src/core/state.js` — stable shared-state facade while legacy data is migrated
- `src/features/live-allocation/` — shared queue and Live Allocation Day
- `src/core/flow-navigation.*` — How It Works return navigation and overview controls
- `src/core/router.*` — OPEN direct preview vs ROLE-restricted navigation
- `src/features/buyer-experience/` — bilingual AI Allocation Advisor, functional My Property, buyer examples and post-sale UI
- `src/features/how-it-works/` — Metro system map and flow-route audit
- `docs/MODULARIZATION.md` — safe migration plan for the remaining legacy domains

## Repository strategy

- `main` — stable demo baseline
- `develop` — integration branch
- feature/refactor branches — focused work reviewed before integration

Future changes should be made in focused branches / pull requests so the current working demo remains recoverable.

## Important product boundaries

- PRENEURA is authoritative for queue, exact-unit inventory, locks, payment state, contract state, and audit.
- AI can explain, recommend, navigate, highlight, and perform safe actions.
- AI must not silently commit legal/financial actions such as unit lock or final contract signature.
- Direct preview from the system map may bypass demo prerequisites.
- Entering via a real role must preserve that role's permissions and workflow restrictions.

See `docs/PRODUCT_ARCHITECTURE.md` and `docs/WORKING_RULES.md` for the detailed operating model.
