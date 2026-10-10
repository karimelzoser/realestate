type Env = NodeJS.ProcessEnv;

type TemplateBinding = {
  name: string;
  language?: string;
  bodyParameterPaths?: string[];
};

const PLACEHOLDER_PATTERN = /(replace|change[-_ ]?me|placeholder|example-secret|your[-_ ]|dummy)/i;

export function assertNotificationGatewayRuntimeConfiguration(env: Env = process.env): void {
  if (env.NODE_ENV !== 'production') return;

  requiredUrl(env, 'DATABASE_URL', ['postgres:', 'postgresql:']);
  requiredBase64Key(env, 'CONTACT_ENCRYPTION_KEY_BASE64', 32);
  requiredSecret(env, 'NOTIFICATION_GATEWAY_TOKEN', 32);
  requiredValue(env, 'META_GRAPH_API_VERSION');
  requiredValue(env, 'META_WHATSAPP_PHONE_NUMBER_ID');
  requiredSecret(env, 'META_WHATSAPP_ACCESS_TOKEN', 24);
  validateBindings(requiredValue(env, 'WHATSAPP_TEMPLATE_BINDINGS_JSON'));
  validateOptionalWebhook(env, 'SMS_PROVIDER_URL', 'SMS_PROVIDER_TOKEN');
  validateOptionalWebhook(env, 'EMAIL_PROVIDER_URL', 'EMAIL_PROVIDER_TOKEN');

  const port = Number(env.PORT ?? '4300');
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) throw new Error('PORT must be a valid TCP port.');
}

function validateBindings(raw: string): void {
  let parsed: unknown;
  try { parsed = JSON.parse(raw) as unknown; } catch { throw new Error('WHATSAPP_TEMPLATE_BINDINGS_JSON must be valid JSON.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('WHATSAPP_TEMPLATE_BINDINGS_JSON must be a JSON object.');
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length === 0) throw new Error('WHATSAPP_TEMPLATE_BINDINGS_JSON must contain at least one template binding.');
  for (const [code, value] of entries) {
    if (!code.trim()) throw new Error('WhatsApp template binding codes must not be empty.');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`WhatsApp template binding ${code} must be an object.`);
    const binding = value as Partial<TemplateBinding>;
    if (typeof binding.name !== 'string' || !binding.name.trim()) throw new Error(`WhatsApp template binding ${code} requires a non-empty name.`);
    if (binding.language !== undefined && (typeof binding.language !== 'string' || !binding.language.trim())) throw new Error(`WhatsApp template binding ${code} has an invalid language.`);
    if (binding.bodyParameterPaths !== undefined && (!Array.isArray(binding.bodyParameterPaths) || binding.bodyParameterPaths.some((path) => typeof path !== 'string' || !path.trim()))) {
      throw new Error(`WhatsApp template binding ${code} has invalid bodyParameterPaths.`);
    }
  }
}

function validateOptionalWebhook(env: Env, urlName: string, tokenName: string): void {
  const rawUrl = env[urlName]?.trim();
  const rawToken = env[tokenName]?.trim();
  if (!rawUrl && !rawToken) return;
  if (!rawUrl) throw new Error(`${urlName} is required when ${tokenName} is configured.`);
  assertUrl(urlName, rawUrl, ['https:', 'http:'], true);
  if (rawToken) rejectPlaceholder(tokenName, rawToken);
}

function requiredValue(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required in production.`);
  rejectPlaceholder(name, value);
  return value;
}

function requiredSecret(env: Env, name: string, minLength: number): void {
  const value = requiredValue(env, name);
  if (value.length < minLength) throw new Error(`${name} must contain at least ${minLength} characters.`);
}

function requiredBase64Key(env: Env, name: string, bytes: number): void {
  const value = requiredValue(env, name);
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length !== bytes || decoded.toString('base64').replace(/=+$/u, '') !== value.replace(/=+$/u, '')) throw new Error(`${name} must decode to exactly ${bytes} bytes.`);
}

function requiredUrl(env: Env, name: string, protocols: string[]): void { assertUrl(name, requiredValue(env, name), protocols, false); }
function assertUrl(name: string, value: string, protocols: string[], rejectLocalhost: boolean): void {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`${name} must be a valid URL.`); }
  if (!protocols.includes(url.protocol)) throw new Error(`${name} uses an unsupported protocol.`);
  if (rejectLocalhost && isLocalHostname(url.hostname)) throw new Error(`${name} must not target localhost in production.`);
}
function rejectPlaceholder(name: string, value: string): void { if (PLACEHOLDER_PATTERN.test(value)) throw new Error(`${name} contains a placeholder value.`); }
function isLocalHostname(hostname: string): boolean { const normalized = hostname.toLowerCase(); return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1'; }
