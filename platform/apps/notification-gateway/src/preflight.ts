import { createDatabase } from '@preneura/database';
import { assertRuntimeReadiness } from '@preneura/database/runtime-readiness';
import { validateGatewayRuntimeConfig } from './runtime-config.js';

async function main(): Promise<void> {
  validateGatewayRuntimeConfig();

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');

  const db = createDatabase(connectionString);
  try {
    const readiness = await assertRuntimeReadiness(db);
    console.log(
      JSON.stringify({
        level: 'info',
        event: 'notification_gateway.preflight_ready',
        at: new Date().toISOString(),
        runtimeSchemaVersion: readiness.runtimeSchemaVersion,
        databaseSchemaVersion: readiness.databaseSchemaVersion,
        minimumRuntimeVersion: readiness.minimumRuntimeVersion,
        migrationMarker: readiness.migrationMarker,
        databaseLatencyMs: readiness.latencyMs,
      }),
    );
  } finally {
    await db.destroy();
  }
}

void main().catch((error) => {
  console.error(
    JSON.stringify({
      level: 'error',
      event: 'notification_gateway.preflight_failed',
      at: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exitCode = 1;
});
