const MIN_SECRET_LENGTH = 32;

export function validateWorkerRuntimeConfig(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== 'production') return;

  const failures: string[] = [];
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    failures.push('DATABASE_URL is required.');
  } else {
    try {
      const parsed = new URL(databaseUrl);
      if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
        failures.push('DATABASE_URL must use a PostgreSQL URL.');
      }
    } catch {
      failures.push('DATABASE_URL must be a valid PostgreSQL URL.');
    }
  }

  requireAbsoluteUrl(env, 'NOTIFICATION_GATEWAY_URL', failures);
  const gatewayToken = env.NOTIFICATION_GATEWAY_TOKEN?.trim();
  if (!gatewayToken || gatewayToken.length < MIN_SECRET_LENGTH || isPlaceholder(gatewayToken)) {
    failures.push(`NOTIFICATION_GATEWAY_TOKEN must be a non-placeholder secret of at least ${MIN_SECRET_LENGTH} characters.`);
  }

  validateInterval(env, 'OUTBOX_POLL_MS', 50, 60_000, failures);
  validateInterval(env, 'NOTIFICATION_POLL_MS', 100, 60_000, failures);
  validateInterval(env, 'SLA_SCAN_MS', 1_000, 3_600_000, failures);
  validateInterval(env, 'INSTALLMENT_REMINDER_SCAN_MS', 1_000, 3_600_000, failures);
  validateInterval(env, 'COMMISSION_DUE_SCAN_MS', 1_000, 3_600_000, failures);

  if (failures.length > 0) {
    throw new Error(`Invalid production worker configuration:\n- ${failures.join('\n- ')}`);
  }
}

function requireAbsoluteUrl(env: NodeJS.ProcessEnv, name: string, failures: string[]): void {
  const value = env[name]?.trim();
  if (!value || isPlaceholder(value)) {
    failures.push(`${name} is required and must not be a placeholder.`);
    return;
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      failures.push(`${name} must use HTTP or HTTPS.`);
    }
  } catch {
    failures.push(`${name} must be a valid absolute URL.`);
  }
}

function validateInterval(
  env: NodeJS.ProcessEnv,
  name: string,
  minimum: number,
  maximum: number,
  failures: string[],
): void {
  const raw = env[name]?.trim();
  if (!raw) return;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    failures.push(`${name} must be an integer between ${minimum} and ${maximum} milliseconds.`);
  }
}

function isPlaceholder(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    normalized.includes('replace-me') ||
    normalized.includes('replace-with') ||
    normalized.includes('changeme') ||
    normalized.includes('change-me') ||
    normalized.includes('placeholder') ||
    normalized.includes('your-secret') ||
    normalized === 'secret'
  );
}
