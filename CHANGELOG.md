# Changelog

## 6.2.1 — Functional flow previews

- Made every direct **OPEN** destination from How PRENEURA Works render with the demo context it needs instead of dead-ending on missing prerequisites.
- Added deterministic preview fixtures for Building, Floor, Exact Unit, Queue Reception, Unit Lock / Handoff, Transaction Inbox and Contract & Sign.
- Contract preview now creates an active exact-unit lock, confirms demo payment, verifies the required transaction documents and satisfies configured approval so **Generate Exact Contract** becomes available.
- Added a preview-only **Complete Demo Requirements** action and made the sticky Complete requirements action perform the same preparation.
- Preserved real **ROLE** workflow restrictions; preview fixtures are restored before entering a real role.
- Added a deterministic **Use Demo Signature** action for OPEN preview while keeping the real drawn-signature canvas interactive.
- Browser QA now exercises Contract generation, OTP, signature, biometric verification, final signature and continuation into My Property.
- Browser QA also checks My Property cards, installments, signed contract viewer, documents and support actions.
- Removed the requested explanatory chrome from How It Works while keeping the actual Metro flow and Manager controls.
- Added focused top/left spacing around the Contract preview title, Buyer stage and live-example copy.

## 6.2.0 — Modular online release

- Added canonical product model for roles, routes, allocation rules and action boundaries.
- Added six-role navigation/capability policy.
- Added shared-state facade for queue, buyer, transaction, contract, properties and installments.
- Split direct preview routing from How It Works navigation.
- Extracted Buyer Experience, My Property, bilingual AI Allocation Advisor, Live Allocation and Metro How It Works into maintainable source modules.
- Preserved #233 Offline and #234 Online in one shared queue with the same priority engine.
- Clarified assistance split: Online → AI Allocation Advisor; Sales Center → Human Allocator; both merge into the same exact-unit selection and lock.
- Kept Contract → My Property on one horizontal completion line in the Metro map.
- Increased Metro typography and spacing for easier reading while keeping horizontal scrolling.
- Added release-level functional/visual contract validation.
- Added GitHub Pages deployment for a public online demo.

## Rev 6.1.6 — Repository baseline

Imported the latest integrated PRENEURA Real Estate OS demo into `app/index.html`.

Baseline includes:
- Metro-style How PRENEURA Works map
- Buyer / Broker / Sales Center entry
- One Buyer Record + EOI
- Eligibility and attendance split
- One Shared Queue
- Online AI Allocation Advisor
- Offline Human Allocator
- Exact Unit Selection and Unit Lock
- Transaction Operator
- Contract & Sign
- Functional My Property area
- Manager controls
- Direct preview vs restricted role navigation
