# PRENEURA advisory AI

PRENEURA AI is an optional advisory layer. The production platform remains fully functional with the deterministic engine and does not require a third-party model for inventory, pricing, queueing, reservations, transactions, finance, documents, commissions, notifications, or support operations.

## Authority boundary

AI has no write authority over business state.

It cannot:

- create or publish availability
- change pricing or scheduled pricing
- change queue priority or order
- create, extend, release, or override inventory locks
- create or complete reservations
- verify payments or cheques
- generate authoritative finance state
- approve refunds
- sign or execute contracts
- change transaction milestones
- create commission eligibility or payment state

All candidate inventory and commercial data originates from PRENEURA's existing server-authorized catalog service. External AI can only rerank candidate IDs already supplied by PRENEURA. Unknown or duplicate IDs returned by a provider are ignored.

## Project controls

Each project has independent settings:

- buyer recommendations enabled/disabled
- manager assistant enabled/disabled
- provider mode: `DETERMINISTIC` or `EXTERNAL_HTTP`
- optional provider model label

Only roles with `ai.settings.manage` can change these settings. Buyer use requires `ai.buyer.use`; manager insight requires `ai.manager.use`.

Defaults are disabled and deterministic.

## Deterministic baseline

Buyer recommendations apply hard filters before scoring:

- inventory must currently be available
- optional maximum budget
- optional minimum bedroom count
- optional minimum indoor area
- optional required garden
- optional required roof

The remaining unit types are scored deterministically using budget fit, bedroom fit, area fit, outdoor-space preferences, and current available quantity.

Manager insight is derived from aggregate project metrics including inventory state, transaction pipeline, overdue payment items, due commission cases, failed notification jobs, and pending buyer-document requirements.

## External provider contract

Set:

- `AI_PROVIDER_URL`
- `AI_PROVIDER_TOKEN` when required by the gateway
- `AI_PROVIDER_MODEL` when a default model label is useful
- `AI_PROVIDER_TIMEOUT_MS` (default `8000`)

`AI_PROVIDER_URL` is vendor-neutral. It may point to a first-party gateway, OpenAI/Azure adapter, local vLLM/Ollama-compatible adapter, or another controlled model service, provided the adapter accepts PRENEURA's JSON envelope and returns the expected response schema.

### Buyer recommendation request

PRENEURA sends only sanitized preferences and the exact server-authorized unit-type candidates. No buyer name, phone, email, National ID, document, contract, payment instrument, transaction record, or queue identity is included.

The envelope includes:

- `version: "1"`
- `purpose: "BUYER_RECOMMENDATION"`
- optional `model`
- structured buyer preferences
- candidate unit-type IDs and commercial attributes
- a policy object marking the response advisory-only and candidate IDs authoritative

The provider returns a list of `{ unitTypeId, score, reason }`. PRENEURA validates the response, rejects unknown candidate IDs, de-duplicates IDs, and appends any omitted valid candidates using the deterministic baseline.

### Manager insight request

PRENEURA does **not** send the raw manager question to an external provider. The question remains inside PRENEURA and is converted to a coarse focus category:

- `PAYMENTS`
- `COMMISSIONS`
- `NOTIFICATIONS`
- `DOCUMENTS`
- `INVENTORY`
- `TRANSACTIONS`
- `GENERAL`

The provider receives only that category plus aggregate project metrics and a policy object declaring aggregate-only, no-PII, no-operational-actions behavior.

## Failure behavior

External AI failure must never break the sales or operations journey.

On timeout, HTTP failure, invalid schema, malformed ranking, or missing provider configuration, PRENEURA returns the deterministic result and records the invocation as `FALLBACK`.

## Audit and privacy

`ai_invocations` records operational metadata only:

- tenant/project/user IDs
- purpose
- provider and model label
- one-way request fingerprint
- candidate count when applicable
- success/fallback/failure status
- latency
- optional external request ID
- bounded error code
- timestamp

Raw prompts/questions and model responses are not persisted in the AI invocation table. CI explicitly checks that prompt/question/response payload columns are absent.

## Product surfaces

`/workspace/ai` adapts to permissions:

- buyers see recommendation filters and ranked available unit types when buyer AI is enabled
- managers/operations directors see project insight and aggregate exception metrics when manager AI is enabled
- authorized managers see project AI enable/disable/provider settings

Every response is visibly marked advisory-only, and provider fallback is surfaced when it occurs.
