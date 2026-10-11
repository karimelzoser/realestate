import { Controller, Get, Inject, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { Database } from '@preneura/database';
import {
  assertRuntimeReadiness,
  RuntimeReadinessError,
  type RuntimeReadinessErrorCode,
} from '@preneura/database/runtime-readiness';
import type { Kysely } from 'kysely';
import { DATABASE } from '../database/database.module.js';
import { readBuildIdentity, type BuildIdentity } from '../release/build-identity.js';

interface LiveHealthResponse {
  status: 'ok';
  service: 'preneura-api';
}

interface ReadyHealthResponse {
  status: 'ready';
  service: 'preneura-api';
  build: BuildIdentity;
  checks: {
    database: 'ok';
    schema: 'ok';
    runtimeSchemaVersion: number;
    databaseSchemaVersion: number;
    minimumRuntimeVersion: number;
    migrationMarker: string;
    latencyMs: number;
  };
}

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  @Get()
  getHealth(): LiveHealthResponse {
    return this.live();
  }

  @Get('live')
  getLiveness(): LiveHealthResponse {
    return this.live();
  }

  @Get('ready')
  async getReadiness(): Promise<ReadyHealthResponse> {
    const build = readBuildIdentity();
    if (build.matchesExpected === false) {
      this.logger.warn(
        `Readiness check failed: RELEASE_IDENTITY_MISMATCH running=${build.gitSha} expected=${build.expectedGitSha}`,
      );
      throw new ServiceUnavailableException({
        status: 'not_ready',
        service: 'preneura-api',
        checks: {
          database: 'unknown',
          schema: 'unknown',
          code: 'RELEASE_IDENTITY_MISMATCH',
        },
        build,
      });
    }

    try {
      const readiness = await assertRuntimeReadiness(this.db);
      return {
        status: 'ready',
        service: 'preneura-api',
        build,
        checks: readiness,
      };
    } catch (error) {
      const code: RuntimeReadinessErrorCode =
        error instanceof RuntimeReadinessError ? error.code : 'DATABASE_UNAVAILABLE';
      this.logger.warn(`Readiness check failed: ${code}`);
      throw new ServiceUnavailableException({
        status: 'not_ready',
        service: 'preneura-api',
        checks: {
          database: code === 'DATABASE_UNAVAILABLE' ? 'failed' : 'ok',
          schema: code === 'DATABASE_UNAVAILABLE' ? 'unknown' : 'failed',
          code,
        },
        build,
      });
    }
  }

  private live(): LiveHealthResponse {
    return { status: 'ok', service: 'preneura-api' };
  }
}
