import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import type { SystemCheck, SystemStatusResponse } from '@crm/contracts';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
import { PlatformStore } from '../auth';
import { MigrationStateService } from './migration-state.service';
import { ReleaseInfoService } from './release-info.service';
import { SetupService } from './setup.service';

/**
 * The operator System page (WD-INST-019, -025, -027): what is running, whether it is healthy, and whether the
 * database matches this build. Read-only; deploys are an image plus the migrator, not a button.
 */
@Injectable()
export class SystemService {
  private readonly startedAt = Date.now();

  constructor(
    private readonly store: PlatformStore,
    private readonly release: ReleaseInfoService,
    private readonly setup: SetupService,
    private readonly migrations: MigrationStateService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async status(): Promise<SystemStatusResponse> {
    const [db, redis, setup] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.setup.snapshot(),
    ]);
    const migrations = db.report ?? { status: 'unknown' as const, appliedCount: 0, rows: [] };
    const migrationsCheck: SystemCheck =
      migrations.status === 'current'
        ? { key: 'migrations', status: 'up' }
        : migrations.status === 'unknown'
          ? {
              key: 'migrations',
              status: 'degraded',
              detail: 'migration files are not shipped with this build',
            }
          : { key: 'migrations', status: 'down', detail: migrations.status };

    return {
      release: this.release.info,
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      setup: {
        state: setup.state,
        completedAt: setup.completedAt ? setup.completedAt.toISOString() : null,
        completedVersion: setup.completedVersion,
        prerequisites: setup.prerequisites,
      },
      migrations,
      checks: [db.check, redis, migrationsCheck],
    };
  }

  private async checkDatabase() {
    const started = Date.now();
    try {
      const report = await this.store.tx((tx) => this.migrations.report(tx));
      return {
        check: { key: 'database', status: 'up', latencyMs: Date.now() - started } as SystemCheck,
        report,
      };
    } catch (err) {
      return {
        check: {
          key: 'database',
          status: 'down',
          detail: err instanceof Error ? err.message : 'unknown',
        } as SystemCheck,
        report: null,
      };
    }
  }

  private async checkRedis(): Promise<SystemCheck> {
    const started = Date.now();
    try {
      await this.redis.ping();
      return { key: 'redis', status: 'up', latencyMs: Date.now() - started };
    } catch (err) {
      return {
        key: 'redis',
        status: 'down',
        detail: err instanceof Error ? err.message : 'unknown',
      };
    }
  }
}
