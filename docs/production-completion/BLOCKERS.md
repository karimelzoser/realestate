# External and deferred dependencies

## DEPLOYMENT_DEFERRED

Server deployment is intentionally excluded from the current software stage. Do not connect to/change the server, DNS, secrets or production data. Prepare all deployment definitions and rehearse only in disposable environments. Later deployment needs explicit authorization and verified host/domain/secret configuration.

## PROVIDER_SETUP_PENDING

Approved merchant/messaging/signature/identity arrangements, credentials, provider sandbox/live accounts, template approvals and finance/legal/domain-owner acceptance are not supplied by this handover. Build adapters/configuration/contracts and tests; record what actually remains unverified. Missing credentials must not stop unrelated code, UI, tests and package preparation. Do not fake provider verification.

## INDEPENDENT_REVIEW_PENDING

High-risk security/finance/locking/signature changes need independent review; business contracts/verification/settlement policies need the appropriate owner. Prepare concrete reviewable code and evidence before requesting indispensable signoff.
