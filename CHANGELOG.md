# Changelog

## 6.7.0 — English live allocation advisor & two-stage unit-lock grace

- Switched the active Online Allocation voice experience to **English only** for the current release while keeping the underlying local-model architecture available for future multilingual re-enablement.
- Added a dedicated English advisor UI with English speech fallback, live recommendations, guided Master Plan → Building → Floor → Exact Unit navigation, scrolling/highlighting and confirmation-gated unit locking.
- Added `local_voice_agent/server67.py` with an English-only local-agent prompt and English Faster-Whisper ASR profile; Linux/Windows launchers now start the 6.7 runtime.
- Preserved the core AI authority boundary: recommendations, navigation and comparison are allowed; exact-unit lock, payment confirmation and legal signing remain explicit human actions.
- Added a **short exact-unit lock grace** immediately after allocation while responsibility hands off to Transaction Operations. Demo default: 15 minutes; configurable for new locks.
- Added **Online 24-hour extension requests**: the buyer requests more time with a reason, and the Transaction Operator must explicitly approve or reject it.
- Added **Offline / Sales Center 24-hour paperwork exceptions**: only the Transaction Operator can grant the exception when the buyer needs more time to complete physical paperwork.
- Added live countdown, buyer, exact unit, lock reference, channel, status, request reason and decision visibility across Buyer, Allocator, Transaction Operator and Manager surfaces.
- Added a shared **Transaction Operator Grace Decision Inbox** so pending extension requests remain visible even when the operator is currently viewing another transaction.
- Added Manager Live Allocation grace control with current short/extended grace records, expiry state and configurable short-grace demo policy.
- Added audit events for short-grace start, extension request, approval/rejection, Offline paperwork exception, grace completion, expiry and lock release.
- Added static 6.7 validation and Chromium QA for English-only live allocation, confirmation-gated locks, Online extension approval, Offline exception handling and Manager visibility.

## 6.6.0 — Professional presentation release

- Added a Manager Presentation Control with deterministic one-click scenarios for Normal Day, Queue Pressure, Unit Lock Conflict, Overdue Collections and Broker Performance.
- Added Reset Demo to restore the clean in-memory presentation baseline immediately.
- Added a Management Decision Room above the Manager Overview with drill-down KPIs for queue depth, average/longest wait, locked/reserved inventory, EOI readiness, overdue collections and broker coverage.
- Added management attention signals for queue SLA, collections and inventory commitment.
- Added realistic presentation data seeding for queue pressure, lock conflict, collections and broker-company / agent performance demonstrations.
- Simplified Buyer Journey Audit presentation wording to **Recorded Event** and **Current State Snapshot** while preserving the underlying audit/state distinction.
- Added a presentation-safe Browser Voice fallback label when the private Egyptian local inference runtime is not connected.
- Added a professional customer-presentation runbook in `docs/PRESENTATION_6.6.md`.
- Added static presentation validation and Chromium QA for scenario switching, reset, decision metrics, broker data and audit terminology.

## 6.5.0 — Live allocation command center & buyer journey audit

- Replaced the Manager Live Allocation demo-style view with an authoritative live command center reading the full active shared queue directly from PRENEURA state.
- Removed the ten-row queue cap from the manager surface; every active token can be inspected with buyer ID, EOI, channel, priority, state, joined time, wait age, service assignment, exact unit, last role/user and last event.
- Added live allocation KPIs for online/offline buyers, human-seat availability, configured online capacity, average/longest wait and active unit locks/reservations.
- Added manager exceptions for long waits and capacity pressure, plus a live queue/allocation/unit-lock event feed.
- Clarified the shared-queue service model: Online buyers use the AI allocation channel; Sales Center buyers use Human Allocator seats; priority truth remains shared.
- Added 1.5-second live state refresh without requiring a full-page reload, with a manual refresh and auto-refresh toggle.
- Rebuilt Buyer Journey Audit around a buyer selector/search and detailed multi-line event cards showing step, event type, role, actual user/actor, buyer, reference, original actor, timestamp and full details.
- Added a strict distinction between RECORDED AUDIT historical events and CURRENT STATE authoritative snapshots reconstructed from buyer, queue, transaction, document, contract and property records.
- Added audit-event enrichment so newly recorded events retain role/user/buyer/step metadata when available.
- Added manager live static validation and Chromium QA for live queue state changes and multi-line buyer journeys.

## 6.4.0 — Production operations & management intelligence

- Upgraded local Egyptian speech output to the Egyptian Qwen3-TTS 1.7B fine-tune with `egyptian_speaker`; retained the local Qwen3 allocation brain and Arabic ASR.
- Reworked the agent prompt toward polite, natural Cairo Egyptian with shorter live conversational turns and less formal MSA phrasing.
- Added an explicit Contract Requirements workspace with payment evidence upload, required-document uploads, readiness status and direct-preview helper.
- Hardened **Generate Exact Contract** with a deterministic transaction snapshot/hash fallback.
- Allocator now surfaces the authoritative next OFFLINE / Sales Center buyer from the shared queue instead of starting empty.
- Added Transaction Operator Exact Contract Execution Desk: generate, print, upload returned signed/fingerprinted contract, biometric receipt and verification/completion.
- My Property now shows paid percentage, total paid, total remaining, overdue/missed installments, next amount due and per-installment paid/remaining balance.
- Rebuilt Manager Overview as an executive project dashboard with inventory/sell-through, buyer funnel, partner metrics, collections/outstanding balances, live transaction and decision signals.
- Added Project Data & Uploads center for master plan, unit inventory, pricing, BIM/floor plans, buyers, brokers, payment schedules and documents.
- Rebuilt phase setup around exact physical units: choose whole buildings/types or individual units, then set phase-specific prices and approval state.
- Added searchable 360° buyer management showing identity, source, EOI, queue, current stage, transaction/contract state and last handler.
- Added broker company/agent performance metrics for buyers, EOI paid/eligible, sales/commissionable outcomes and commission values.
- Rebuilt audit view to expose role, actual user/system actor, buyer association, exact step/event and attention status.
- Added dedicated 6.4 static validation and Chromium browser QA for these production workflows.

## 6.3.0 — Local Egyptian live allocation agent

- Replaced the browser-only allocation voice experience with a modular local Egyptian Arabic voice-agent layer for online allocation.
- Added deterministic inventory ranking against buyer eligibility, budget, rooms, area, floor, view and building preferences.
- The advisor now guides Allocation Day → Master Plan → Building → Floor → Exact Unit and can scroll/highlight the exact UI it is discussing.
- Added top-three live unit recommendations with reasons and price/area ranking modes.
- Added safe auto-tour behavior for reversible Building/Floor choices while preserving explicit buyer confirmation for the exact-unit lock.
- Added hands-free microphone VAD, live barge-in/interruption, push-to-talk and streaming PCM playback.
- Added a fully local speech service using Cohere Transcribe Arabic as the primary ASR, a public Faster-Whisper Arabic fallback, Qwen3-30B-A3B-Instruct-2507 as the default local agent brain, and VoiceTut-TTS with the Omnia Egyptian voice.
- Added model-action sanitization so the AI cannot execute unit lock, payment confirmation, legal signature, price override or queue-priority override.
- Added deterministic browser fallback behavior when the local model service is unavailable.
- Added local runtime documentation, environment template and Linux/Windows launchers.
- Added static and Chromium browser QA for the local voice journey and unit-lock confirmation boundary.

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
