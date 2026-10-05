# Notification Gateway Contract

PRENEURA keeps notification scheduling, authorization, retries, idempotency and audit inside the platform worker while keeping provider-specific WhatsApp, SMS and email integrations behind a small gateway boundary.

## Why the gateway exists

Authentication identifiers are intentionally not reversible delivery destinations. Phone and National ID login aliases are stored as HMAC lookup values. External delivery must therefore resolve a verified contact through an authorized contact/provider service rather than attempting to derive a phone number from authentication data.

The production platform already has a separate `auth_delivery_contacts` persistence boundary for verified encrypted delivery contacts. Provider implementations may resolve those contacts through the approved contact service/KMS path, or an organization may keep contact resolution inside its notification gateway. Plain phone numbers and email addresses must not be copied into notification jobs or application logs.

## Worker request

For every `WHATSAPP`, `SMS`, or `EMAIL` job, the worker sends an HTTP `POST` to `NOTIFICATION_GATEWAY_URL`.

Headers:

```text
Content-Type: application/json
Idempotency-Key: <stable PRENEURA notification idempotency key>
Authorization: Bearer <NOTIFICATION_GATEWAY_TOKEN>   # when configured
```

Body:

```json
{
  "notificationJobId": "uuid",
  "tenantId": "uuid",
  "projectId": "uuid-or-null",
  "transactionId": "uuid-or-null",
  "recipientUserId": "uuid",
  "channel": "WHATSAPP",
  "templateCode": "payment.installment.due",
  "locale": "ar-EG",
  "payload": {}
}
```

The gateway must treat `recipientUserId` as the identity key and resolve only a verified, currently valid delivery contact. If no valid contact exists, it should return a non-2xx response so PRENEURA records a failed delivery attempt and applies bounded retry/backoff.

## Expected response

Successful response:

```json
{
  "provider": "META_WHATSAPP",
  "messageId": "provider-message-id"
}
```

`provider` is an audit label. `messageId` may be null when the downstream provider does not return an identifier.

## Required idempotency behavior

The gateway and downstream adapter must preserve the supplied `Idempotency-Key`. Repeated requests with the same key must not create duplicate outbound messages.

PRENEURA uses policy- and business-state-derived idempotency keys. A changed due date, amount, template, locale, audience, channel, or lead time generates a new desired job while stale pending jobs are cancelled by reconciliation.

## WhatsApp implementation

A Meta WhatsApp Cloud API adapter should:

1. resolve the verified E.164 phone number for `recipientUserId`;
2. map `templateCode` + `locale` to an approved Meta template;
3. map structured `payload` fields to template variables;
4. send with the organization/WABA credentials held in a secrets manager;
5. return the Meta message ID;
6. never log OTP values, full phone numbers, access tokens, or template secrets.

For installment reminders, the payload includes the payment item, amount, currency, due date and overdue state. For milestone reminders, it includes the transaction, milestone target and overdue state.

## Failure and retry contract

The worker owns retry policy. The gateway should return:

- `2xx` only when the provider accepted the message or a prior idempotent request already succeeded;
- `4xx/5xx` for failures that should be recorded by PRENEURA;
- a concise non-sensitive response body suitable for delivery-attempt audit.

PRENEURA retries failed jobs with bounded exponential backoff and stops after the configured terminal attempt count.

## Security boundary

The gateway must be private/authenticated in production. Recommended deployment controls:

- service-to-service bearer token or workload identity;
- IP/private-network restrictions where available;
- provider credentials only in a secrets manager;
- encrypted verified contact storage;
- no raw delivery contacts in event payloads, notification jobs, analytics events or browser APIs;
- rate limits per tenant/provider and provider-template compliance checks.
