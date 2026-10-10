const MIN_SECRET_LENGTH = 32;

export function validateGatewayRuntimeConfig(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== 'production') return;

  const failures: string[] = [];
  requirePostgresUrl(env, 'DATABASE_URL', failures);
  requireSecret(env, 'NOTIFICATION_GATEWAY_TOKEN', failures);
  requireBase64Key(env, 'CONTACT_ENCRYPTION_KEY_BASE64', 32, failures);

  requireNonPlaceholder(env, 'META_GRAPH_API_VERSION', failures);
  requireNonPlaceholder(env, 'META_WHATSAPP_PHONE_NUMBER_ID', failures);
  requireSecret(env, 'META_WHATSAPP_ACCESS_TOKEN', failures, 16);
  validateBindings(env, failures);

  validateOptionalProvider(env, 'SMS_PROVIDER_URL', 'SMS_PROVIDER_TOKEN', failures);
  validateOptionalProvider(env, 'EMAIL_PROVIDER_URL', 'EMAIL_PROVIDER_TOKEN', failures);
  validatePort(env.PORT ?? '4300', failures);

  if (failures.length > 0) {
    throw new Error(`Invalid production notification gateway configuration:\n- ${failures.join('\n- ')}`);
  }
}

function requirePostgresUrl(env: NodeJS.ProcessEnv, name: string, failures: string[]): void {
  const value = requireNonPlaceholder(env, name, failures);
  if (!value) return;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
      failures.push(`${name} must use a PostgreSQL URL.`);
    }
  } catch {
    failures.push(`${name} must be a valid PostgreSQL URL.`);
  }
}

function requireNonPlaceholder(env: NodeJS.ProcessEnv, name: string, failures: string[]): string | null {
  const value = env[name]?.trim();
  if (!value) {
    failures.push(`${name} is required.`);
    return null;
  }
  if (isPlaceholder(value)) {
    failures.push(`${name} still contains a placeholder value.`);
    return null;
  }
  return value;
}

function requireSecret(
  env: NodeJS.ProcessEnv,
  name: string,
  failures: string[],
  minimumLength = MIN_SECRET_LENGTH,
): void {
  const value = requireNonPlaceholder(env, name, failures);
  if (value && value.length < minimumLength) {
    failures.push(`${name} must be at least ${minimumLength} characters.`);
  }
}

function requireBase64Key(
  env: NodeJS.ProcessEnv,
  name: string,
  expectedBytes: number,
  failures: string[],
): void {
  const value = requireNonPlaceholder(env, name, failures);
  if (!value) return;
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length !== expectedBytes || decoded.toString('base64') !== value) {
    failures.push(`${name} must be canonical base64 encoding of exactly ${expectedBytes} bytes.`);
  }
}

function validateBindings(env: NodeJS.ProcessEnv, failures: string[]): void {
  const raw = requireNonPlaceholder(env, 'WHATSAPP_TEMPLATE_BINDINGS_JSON', failures);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).length === 0) {
      failures.push('WHATSAPP_TEMPLATE_BINDINGS_JSON must be a non-empty JSON object.');
      return;
    }
    for (const [code, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        failures.push(`WhatsApp template binding ${code} must be an object.`);
        continue;
      }
      const binding = value as Record<string, unknown>;
      if (typeof binding.name !== 'string' || binding.name.trim().length === 0) {
        failures.push(`WhatsApp template binding ${code} requires a non-empty name.`);
      }
      if (
        binding.bodyParameterPaths !== undefined &&
        (!Array.isArray(binding.bodyParameterPaths) ||
          binding.bodyParameterPaths.some((item) => typeof item !== 'string' || item.length === 0))
      ) {
        failures.push(`WhatsApp template binding ${code} has invalid bodyParameterPaths.`);
      }
    }
  } catch {
    failures.push('WHATSAPP_TEMPLATE_BINDINGS_JSON must contain valid JSON.');
  }
}

function validateOptionalProvider(
  env: NodeJS.ProcessEnv,
  urlName: string,
  tokenName: string,
  failures: string[],
): void {
  const url = env[urlName]?.trim();
  const token = env[tokenName]?.trim();
  if (!url && !token) return;
  if (!url) {
    failures.push(`${urlName} is required when ${tokenName} is configured.`);
    return;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      failures.push(`${urlName} must use HTTP or HTTPS.`);
    }
  } catch {
    failures.push(`${urlName} must be a valid absolute URL.`);
  }
  if (!token || token.length < 16 || isPlaceholder(token)) {
    failures.push(`${tokenName} must be a non-placeholder secret of at least 16 characters.`);
  }
}

function validatePort(value: string, failures: string[]): void {
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    failures.push('PORT must be a valid TCP port.');
  }
}

function isPlaceholder(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    normalized.includes('replace-me') ||
    normalized.includes('changeme') ||
    normalized.includes('change-me') ||
    normalized.includes('placeholder') ||
    normalized.includes('your-secret') ||
    normalized === 'secret'
  );
}
