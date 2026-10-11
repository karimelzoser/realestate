import pg from 'pg';

const { Client } = pg;
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

const timeoutMs = Number(process.env.DATABASE_WAIT_TIMEOUT_MS ?? '60000');
if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 600000) {
  throw new Error('DATABASE_WAIT_TIMEOUT_MS must be an integer between 1000 and 600000.');
}

const deadline = Date.now() + timeoutMs;
let attempt = 0;
let lastError;

while (Date.now() < deadline) {
  attempt += 1;
  const client = new Client({ connectionString, connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
    await client.query('SELECT 1');
    await client.end();
    console.log(JSON.stringify({ event: 'database.reachable', attempt, at: new Date().toISOString() }));
    process.exit(0);
  } catch (error) {
    lastError = error;
    await client.end().catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, Math.min(5000, 500 * attempt)));
  }
}

throw new Error(
  `Database did not become reachable within ${timeoutMs}ms: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
);
