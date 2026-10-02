# PRENEURA 6.2.0 Release QA

## Scope

Release candidate for the public modular demo.

The self-contained Rev 6.1.6 file remains unchanged at `app/index.html`. The public root entry uses the extracted modular source.

## Functional contracts checked

### How It Works

- Buyer Direct opens the Buyer role.
- Broker opens the Broker role.
- Sales Center / Reception opens the Queue Receptionist role.
- Buyer Record + EOI opens the EOI / eligibility page directly.
- Attendance opens Allocation Day directly.
- Online Attendance opens the online Buyer Allocation Day.
- Sales Center Attendance opens Queue Reception.
- One Shared Queue opens Live Allocation Day.
- Parallel Allocation opens the same Live Allocation Day operational example.
- AI Allocation Advisor opens the online unit-selection experience.
- Human Allocator opens the real Allocator role.
- Master Plan, Building, Floor and Exact Unit open their specific Buyer pages.
- Unit Lock opens the Allocator handoff / lock page.
- Transaction Operator opens the real Transaction Operator role.
- Contract & Sign opens the Buyer contract page.
- My Property opens the functional post-sale Buyer portfolio.

### Shared queue

The demo contract remains:

- #233 — Offline / Sales Center
- #234 — Online
- one ordered queue
- one priority engine
- attendance changes the service channel, not queue priority
- online assistance = AI Allocation Advisor
- offline assistance = Human Allocator
- both paths use the same exact-unit inventory and lock process

### OPEN vs ROLE

- **OPEN** is a direct product-preview path and may bypass demo login/navigation prerequisites.
- **ROLE** is the real role path and keeps role permissions and workflow restrictions.
- Preview-only state is restored before entering a real role.

### My Property

The post-sale Buyer area includes:

- property list
- property detail page
- installment schedule
- signed contract view
- document / receipt demo viewer
- updates and support
- residential and commercial examples

### AI Allocation Advisor

The online allocation advisor includes:

- English
- Egyptian Arabic
- automatic language detection
- browser speech recognition where supported
- speech output where supported
- typed fallback
- navigation actions
- highlighting
- comparisons and selection guidance
- production AI endpoint adapter through `window.PRENEURA_AI_ENDPOINT`

No API secret is embedded in the public static site.

Final exact-unit lock and legal signature remain buyer-confirmed actions.

## Visual QA contract

The Metro overview was revised against the Rev 6.1.6 QA screenshots and its explicit geometry.

Current layout requirements:

- horizontally scrollable; content is not shrunk to fit
- 3340 px Metro canvas
- larger node headings and body copy
- no completion-chain overlap
- Contract and My Property stay on the same horizontal line
- My Property fits inside the canvas
- Online / Offline branches remain visually distinct
- AI Advisor / Human Allocator branches merge back into Exact Unit Selection
- redundant bottom ownership paragraph removed
- Manager governance remains above the journey
- flow labels remain outside the cards
- OPEN / ROLE action badges have reserved space

The release validator checks the completion-chain geometry and core typography values to prevent accidental regression.

## Automated validation

The GitHub Actions validation workflow checks:

1. JavaScript syntax for all extracted source modules.
2. Required assets and legacy extraction anchors.
3. Canonical product model.
4. Six-role navigation policy.
5. Shared-state facade.
6. Release-level functional and visual contracts.

## External-content note

Some legacy property imagery in the standalone prototype is still loaded from third-party public image hosts. The PRENEURA system flow, role logic, queue, My Property data, transaction examples and modular code do not depend on those image hosts for their business logic.

A later production hardening step should move final approved project imagery into owned storage/CDN assets.

## Publication

GitHub Pages workflow: `.github/workflows/pages.yml`

Expected project URL:

`https://karimelzoser.github.io/realestate/`
