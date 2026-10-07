import { createDatabase } from '@preneura/database';
import { assertRuntimeReadiness } from '@preneura/database/runtime-readiness';

async function bootstrap(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');

  const db = createDatabase(connectionString);
  try {
    await assertRuntimeReadiness(db);
  } finally {
    await db.destroy().catch(() => undefined);
  }

  await import('./main.js');
}

void bootstrap().catch((error) => {
  console.error(
    JSON.stringify({
      level: 'error',
      event: 'gateway.startup_failed',
      at: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exitCode = 1;
});
