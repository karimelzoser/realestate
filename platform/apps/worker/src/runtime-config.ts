type Env = NodeJS.ProcessEnv;

const MIN_SECRET_LENGTH = 32;
const PLACEHOLDER_PATTERN = /(replace|change[-_ ]?me|placeholder|example-secret|your[-_ ]|dummy)/i;

export function validateWorkerRuntimeConfig(env: Env = process.env): void {
  if (env.NODE_ENV !== 'production') return;

  const failures: string[] = [];
  requireUrl(env, 'DATABASE_URL', ['postgres:', 'postgresql:'], false, failures);
  requireUrl(env, 'NOTIFICATION_GATEWAY_URL', ['https:', 'http:'], true, failures);
  requireSecret(env, 'NOTIFICATION_GATEWAY_TOKEN', MIN_SECRET_LENGTH, failures);

  // Inventory expiry is a correctness reconciliation loop, not a browser timer or
  // cache refresh. Bound both cadence and batch size so production cannot disable
  // timely capacity release or accidentally configure a database busy loop. These
  // bounds are certified by runtime-readiness, production-config, durability and
  // telemetry-ready production startup gates.
  requireInterval(env, 'INVENTORY_LOCK_EXPIRY_SCAN_MS', 100, 60_000, failures);
  requireIntegerRange(env, 'INVENTORY_LOCK_EXPIRY_BATCH_SIZE', 1, 5000, failures);
  requireInterval(env, 'OUTBOX_POLL_MS', 50, 60_000, failures);
  requireInterval(env, 'NOTIFICATION_POLL_MS', 100, 60_000, failures);
  requireInterval(env, 'SLA_SCAN_MS', 1_000, 3_600_000, failures);
  requireInterval(env, 'INSTALLMENT_REMINDER_SCAN_MS', 1_000, 3_600_000, failures);
  requireInterval(env, 'COMMISSION_DUE_SCAN_MS', 1_000, 3_600_000, failures);

  if (failures.length > 0) {
    throw new Error(`Invalid production worker configuration:\n- ${failures.join('\n- ')}`);
  }
}

function requireUrl(
  env: Env,
  name: string,
  protocols: string[],
  rejectLocalhost: boolean,
  failures: string[],
): void {
  const value = requiredValue(env, name, failures);
  if (!value) return;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    failures.push(`${name} must be a valid absolute URL.`);
    return;
  }

  if (!protocols.includes(parsed.protocol)) {
    failures.push(`${name} uses an unsupported protocol.`);
  }
  if (rejectLocalhost && isLocalHostname(parsed.hostname)) {
    failures.push(`${name} must not target localhost in production.`);
  }
}

function requireSecret(env: Env, name: string, minimum: number, failures: string[]): void {
  const value = requiredValue(env, name, failures);
  if (!value) return;
  if (value.length < minimum) {
    failures.push(`${name} must contain at least ${minimum} characters.`);
  }
}

function requireInterval(
  env: Env,
  name: string,
  minimum: number,
  maximum: number,
  failures: string[],
): void {
  requireIntegerRange(env, name, minimum, maximum, failures);
}

function requireIntegerRange(
  env: Env,
  name: string,
  minimum: number,
  maximum: number,
  failures: string[],
): void {
  const raw = requiredValue(env, name, failures);
  if (!raw) return;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    failures.push(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
}

function requiredValue(env: Env, name: string, failures: string[]): string | null {
  const value = env[name]?.trim();
  if (!value) {
    failures.push(`${name} is required in production.`);
    return null;
  }
  if (PLACEHOLDER_PATTERN.test(value)) {
    failures.push(`${name} contains a placeholder value.`);
    return null;
  }
  return value;
}

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}
