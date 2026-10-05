import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createDatabase, type JsonValue } from '@preneura/database';
import { decryptContactValue } from '@preneura/security';
import { sql, type Kysely } from 'kysely';
import type { Database } from '@preneura/database';

type Channel = 'WHATSAPP' | 'SMS' | 'EMAIL';
type RequestKind = 'NOTIFICATION' | 'AUTH_OTP' | 'CONTACT_VERIFICATION';

type GatewayRequest = {
  userId: string;
  contactId?: string;
  channel: Channel;
  templateCode: string;
  locale: string;
  payload: JsonValue;
};

type DeliveryLedger = {
  idempotency_key: string;
  status: 'PROCESSING' | 'SENT' | 'FAILED';
  provider: string | null;
  provider_message_id: string | null;
  updated_at: Date;
};

type TemplateBinding = {
  name: string;
  language?: string;
  bodyParameterPaths?: string[];
};

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');
const db = createDatabase(connectionString);
const port = positiveInteger(process.env.PORT ?? '4300', 'PORT');
let stopping = false;

const server = createServer((request, response) => {
  void handle(request, response).catch((error) => {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof HttpError ? error.message : 'Notification gateway failed.';
    log('error', 'request.failed', {
      method: request.method,
      path: request.url?.split('?')[0] ?? '',
      status,
      error: error instanceof Error ? error.message : String(error),
    });
    sendJson(response, status, { message });
  });
});

server.listen(port, '0.0.0.0', () => log('info', 'gateway.started', { port }));

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const path = request.url?.split('?')[0] ?? '';
  if (request.method === 'GET' && path === '/health') {
    sendJson(response, 200, { ok: true });
    return;
  }
  if (request.method !== 'POST') throw new HttpError(404, 'Not found.');
  assertAuthorized(request);
  const idempotencyKey = header(request, 'idempotency-key');
  if (!idempotencyKey || idempotencyKey.length > 500) throw new HttpError(400, 'A valid Idempotency-Key is required.');
  const body = await readJson(request);

  if (path === '/deliver') {
    const input = parseNotification(body);
    const contact = await resolveVerifiedContact(db, input.userId, input.channel === 'EMAIL' ? 'EMAIL' : 'PHONE');
    await deliver(response, idempotencyKey, 'NOTIFICATION', input, contact);
    return;
  }
  if (path === '/auth-otp') {
    const input = parseDirect(body, false);
    const contact = await resolveVerifiedContact(db, input.userId, 'PHONE');
    await deliver(response, idempotencyKey, 'AUTH_OTP', input, contact);
    return;
  }
  if (path === '/contact-verification') {
    const input = parseDirect(body, true);
    if (!input.contactId) throw new HttpError(400, 'contactId is required.');
    const contact = await resolveContactById(db, input.userId, input.contactId);
    await deliver(response, idempotencyKey, 'CONTACT_VERIFICATION', input, contact);
    return;
  }
  throw new HttpError(404, 'Not found.');
}

async function deliver(
  response: ServerResponse,
  idempotencyKey: string,
  requestKind: RequestKind,
  input: GatewayRequest,
  contact: { id: string; value: string },
): Promise<void> {
  const claim = await claimDelivery(db, {
    idempotencyKey,
    requestKind,
    recipientUserId: input.userId,
    contactId: contact.id,
    channel: input.channel,
  });
  if (!claim.claimed) {
    sendJson(response, 200, {
      provider: claim.row.provider ?? 'IDEMPOTENT_REPLAY',
      messageId: claim.row.provider_message_id,
      replayed: true,
    });
    return;
  }

  try {
    const result = await deliverProvider({
      destination: contact.value,
      channel: input.channel,
      templateCode: input.templateCode,
      locale: input.locale,
      payload: input.payload,
      idempotencyKey,
    });
    await markSent(db, idempotencyKey, result.provider, result.messageId);
    log('info', 'delivery.sent', { requestKind, channel: input.channel, provider: result.provider });
    sendJson(response, 200, { provider: result.provider, messageId: result.messageId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markFailed(db, idempotencyKey, message);
    throw new HttpError(502, message);
  }
}

async function resolveVerifiedContact(
  database: Kysely<Database>,
  userId: string,
  kind: 'PHONE' | 'EMAIL',
): Promise<{ id: string; value: string }> {
  const result = await sql<{ id: string; value_ciphertext: Uint8Array }>`
    SELECT id, value_ciphertext
    FROM auth_delivery_contacts
    WHERE user_id = ${userId}::uuid
      AND kind = ${kind}
      AND is_primary = true
      AND verified_at IS NOT NULL
    ORDER BY verified_at DESC
    LIMIT 1
  `.execute(database);
  const row = result.rows[0];
  if (!row) throw new HttpError(422, `No verified primary ${kind.toLowerCase()} contact is available.`);
  return { id: row.id, value: decryptContactValue(row.value_ciphertext, required('CONTACT_ENCRYPTION_KEY_BASE64')) };
}

async function resolveContactById(
  database: Kysely<Database>,
  userId: string,
  contactId: string,
): Promise<{ id: string; value: string }> {
  const result = await sql<{ id: string; value_ciphertext: Uint8Array }>`
    SELECT id, value_ciphertext
    FROM auth_delivery_contacts
    WHERE id = ${contactId}::uuid
      AND user_id = ${userId}::uuid
      AND kind = 'PHONE'
    LIMIT 1
  `.execute(database);
  const row = result.rows[0];
  if (!row) throw new HttpError(404, 'Enrollment contact not found.');
  return { id: row.id, value: decryptContactValue(row.value_ciphertext, required('CONTACT_ENCRYPTION_KEY_BASE64')) };
}

async function claimDelivery(database: Kysely<Database>, input: {
  idempotencyKey: string;
  requestKind: RequestKind;
  recipientUserId: string;
  contactId: string;
  channel: Channel;
}): Promise<{ claimed: boolean; row: DeliveryLedger }> {
  const inserted = await sql<DeliveryLedger>`
    INSERT INTO notification_gateway_deliveries (
      idempotency_key, request_kind, recipient_user_id, contact_id, channel, status
    ) VALUES (
      ${input.idempotencyKey}, ${input.requestKind}, ${input.recipientUserId}::uuid,
      ${input.contactId}::uuid, ${input.channel}, 'PROCESSING'
    )
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING idempotency_key, status, provider, provider_message_id, updated_at
  `.execute(database);
  const fresh = inserted.rows[0];
  if (fresh) return { claimed: true, row: fresh };

  const existingResult = await sql<DeliveryLedger>`
    SELECT idempotency_key, status, provider, provider_message_id, updated_at
    FROM notification_gateway_deliveries
    WHERE idempotency_key = ${input.idempotencyKey}
  `.execute(database);
  const existing = existingResult.rows[0];
  if (!existing) throw new HttpError(409, 'Delivery claim conflict.');
  if (existing.status === 'SENT') return { claimed: false, row: existing };

  const staleBefore = new Date(Date.now() - 5 * 60 * 1000);
  if (existing.status === 'PROCESSING' && existing.updated_at.getTime() > staleBefore.getTime()) {
    throw new HttpError(409, 'Delivery is already processing.');
  }

  const retried = await sql<DeliveryLedger>`
    UPDATE notification_gateway_deliveries
    SET status = 'PROCESSING', provider = NULL, provider_message_id = NULL, last_error = NULL, updated_at = now()
    WHERE idempotency_key = ${input.idempotencyKey}
      AND (status = 'FAILED' OR updated_at <= ${staleBefore})
    RETURNING idempotency_key, status, provider, provider_message_id, updated_at
  `.execute(database);
  const row = retried.rows[0];
  if (!row) throw new HttpError(409, 'Delivery is already processing.');
  return { claimed: true, row };
}

async function markSent(database: Kysely<Database>, key: string, provider: string, messageId: string | null): Promise<void> {
  await sql`
    UPDATE notification_gateway_deliveries
    SET status = 'SENT', provider = ${provider}, provider_message_id = ${messageId}, last_error = NULL, updated_at = now()
    WHERE idempotency_key = ${key}
  `.execute(database);
}

async function markFailed(database: Kysely<Database>, key: string, error: string): Promise<void> {
  await sql`
    UPDATE notification_gateway_deliveries
    SET status = 'FAILED', last_error = ${error.slice(0, 1000)}, updated_at = now()
    WHERE idempotency_key = ${key}
  `.execute(database);
}

async function deliverProvider(input: {
  destination: string;
  channel: Channel;
  templateCode: string;
  locale: string;
  payload: JsonValue;
  idempotencyKey: string;
}): Promise<{ provider: string; messageId: string | null }> {
  if (input.channel === 'WHATSAPP') return sendWhatsApp(input);
  if (input.channel === 'SMS') return sendWebhook('SMS', input);
  return sendWebhook('EMAIL', input);
}

async function sendWhatsApp(input: {
  destination: string;
  templateCode: string;
  locale: string;
  payload: JsonValue;
}): Promise<{ provider: string; messageId: string | null }> {
  const binding = templateBinding(input.templateCode, input.locale);
  const version = required('META_GRAPH_API_VERSION');
  const phoneNumberId = required('META_WHATSAPP_PHONE_NUMBER_ID');
  const accessToken = required('META_WHATSAPP_ACCESS_TOKEN');
  const parameters = (binding.bodyParameterPaths ?? []).map((path) => ({
    type: 'text',
    text: parameterText(readPath(input.payload, path)),
  }));
  const components = parameters.length > 0 ? [{ type: 'body', parameters }] : undefined;

  const response = await fetch(`https://graph.facebook.com/${encodeURIComponent(version)}/${encodeURIComponent(phoneNumberId)}/messages`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: input.destination,
      type: 'template',
      template: {
        name: binding.name,
        language: { code: binding.language ?? metaLanguage(input.locale) },
        ...(components ? { components } : {}),
      },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Meta WhatsApp returned HTTP ${response.status}.`);
  const result = await response.json() as { messages?: Array<{ id?: string }> };
  return { provider: 'META_WHATSAPP', messageId: result.messages?.[0]?.id ?? null };
}

async function sendWebhook(
  channel: 'SMS' | 'EMAIL',
  input: {
    destination: string;
    templateCode: string;
    locale: string;
    payload: JsonValue;
    idempotencyKey: string;
  },
): Promise<{ provider: string; messageId: string | null }> {
  const url = required(channel === 'SMS' ? 'SMS_PROVIDER_URL' : 'EMAIL_PROVIDER_URL');
  const token = process.env[channel === 'SMS' ? 'SMS_PROVIDER_TOKEN' : 'EMAIL_PROVIDER_TOKEN'];
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': input.idempotencyKey,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      to: input.destination,
      templateCode: input.templateCode,
      locale: input.locale,
      payload: input.payload,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`${channel} provider returned HTTP ${response.status}.`);
  const result = await response.json().catch(() => ({})) as { messageId?: string | null; provider?: string };
  return { provider: result.provider ?? `${channel}_WEBHOOK`, messageId: result.messageId ?? null };
}

let bindingCache: Record<string, TemplateBinding> | null = null;
function templateBinding(templateCode: string, locale: string): TemplateBinding {
  if (!bindingCache) {
    const raw = required('WHATSAPP_TEMPLATE_BINDINGS_JSON');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('WHATSAPP_TEMPLATE_BINDINGS_JSON must be a JSON object.');
    }
    bindingCache = parsed as Record<string, TemplateBinding>;
  }
  const localized = bindingCache[`${templateCode}:${locale}`];
  const fallback = bindingCache[templateCode];
  const binding = localized ?? fallback;
  if (!binding || typeof binding.name !== 'string' || binding.name.length === 0) {
    throw new Error(`No WhatsApp template binding is configured for ${templateCode}.`);
  }
  return binding;
}

function parseNotification(value: unknown): GatewayRequest {
  const body = object(value);
  return {
    userId: uuid(body.recipientUserId, 'recipientUserId'),
    channel: channel(body.channel),
    templateCode: nonEmpty(body.templateCode, 'templateCode'),
    locale: nonEmpty(body.locale, 'locale'),
    payload: jsonValue(body.payload),
  };
}

function parseDirect(value: unknown, requireContact: boolean): GatewayRequest {
  const body = object(value);
  const parsedChannel = channel(body.channel);
  if (parsedChannel === 'EMAIL') throw new HttpError(400, 'OTP/contact verification requires a phone channel.');
  return {
    userId: uuid(body.userId, 'userId'),
    ...(requireContact ? { contactId: uuid(body.contactId, 'contactId') } : {}),
    channel: parsedChannel,
    templateCode: nonEmpty(body.templateCode, 'templateCode'),
    locale: nonEmpty(body.locale, 'locale'),
    payload: jsonValue(body.payload),
  };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'JSON object body required.');
  return value as Record<string, unknown>;
}

function channel(value: unknown): Channel {
  if (value === 'WHATSAPP' || value === 'SMS' || value === 'EMAIL') return value;
  throw new HttpError(400, 'Unsupported notification channel.');
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new HttpError(400, `Invalid ${field}.`);
  }
  return value;
}

function nonEmpty(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 200) throw new HttpError(400, `Invalid ${field}.`);
  return value.trim();
}

function jsonValue(value: unknown): JsonValue {
  if (value === undefined) return {};
  try {
    return JSON.parse(JSON.stringify(value)) as JsonValue;
  } catch {
    throw new HttpError(400, 'payload must be JSON serializable.');
  }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 256 * 1024) throw new HttpError(413, 'Request body too large.');
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new HttpError(400, 'Invalid JSON body.');
  }
}

function assertAuthorized(request: IncomingMessage): void {
  const expected = required('NOTIFICATION_GATEWAY_TOKEN');
  if (expected.length < 32) throw new Error('NOTIFICATION_GATEWAY_TOKEN must contain at least 32 characters.');
  const headerValue = header(request, 'authorization');
  const supplied = headerValue?.startsWith('Bearer ') ? headerValue.slice(7) : '';
  const left = createHash('sha256').update(expected).digest();
  const right = createHash('sha256').update(supplied).digest();
  if (!timingSafeEqual(left, right)) throw new HttpError(401, 'Unauthorized.');
}

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function positiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65_535) throw new Error(`${name} must be a valid TCP port.`);
  return parsed;
}

function metaLanguage(locale: string): string {
  if (locale.toLowerCase().startsWith('ar')) return 'ar';
  if (locale.toLowerCase() === 'en-us') return 'en_US';
  return locale.replace('-', '_');
}

function readPath(payload: JsonValue, path: string): JsonValue | undefined {
  let current: JsonValue | undefined = payload;
  for (const segment of path.split('.')) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function parameterText(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  if (response.headersSent) return;
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function log(level: 'info' | 'error', event: string, details: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level, event, at: new Date().toISOString(), ...details }));
}

async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  log('info', 'gateway.shutdown_requested', { signal });
  server.close(async () => {
    await db.destroy().catch(() => undefined);
    process.exitCode = 0;
  });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
