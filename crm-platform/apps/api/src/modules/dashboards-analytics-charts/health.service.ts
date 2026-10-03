import { HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { ModuleRef } from '@nestjs/core';
import { sql } from 'drizzle-orm';
import { statfs } from 'node:fs/promises';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import {
  ERROR_CODES,
  type ClearQueueResponse,
  type HealthCheck,
  type HealthQueueRow,
  type HealthResponse,
  type HealthVitals,
} from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { QUEUES } from '../../infra/queue/queues';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
import { AuthAuditService } from '../auth';
import { NodeBridgeSettingsService } from '../node-bridge-runtime';
import { overallState, queueState, shortError } from './health-rules';

/** A poll storm (several consoles at 20 s) shares one run of the probes. */
const CACHE_MS = 3_000;
const PROBE_TIMEOUT_MS = 5_000;
const JOB_STATES = ['waiting', 'paused', 'delayed', 'prioritized', 'failed'] as const;

/**
 * System health (WD-DASH-048, 049, 050, 051). Reads only platform plumbing (Postgres, Redis, BullMQ, the bridge, storage);
 * it never reads a tenant table, so it needs no cross-tenant door.
 */
@Injectable()
export class HealthService {
  private cached: { at: number; value: HealthResponse } | null = null;
  private inflight: Promise<HealthResponse> | null = null;

  constructor(
    private readonly db: DatabaseService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService,
    private readonly moduleRef: ModuleRef,
    private readonly audit: AuthAuditService,
    @Optional() private readonly bridge?: NodeBridgeSettingsService,
  ) {}

  /** Every queue by its fixed name. */
  private queues(): Array<{ name: string; queue: Queue }> {
    return Object.values(QUEUES).map((name) => ({
      name,
      queue: this.moduleRef.get<Queue>(getQueueToken(name), { strict: false }),
    }));
  }

  async snapshot(fresh = false): Promise<HealthResponse> {
    if (!fresh && this.cached && Date.now() - this.cached.at < CACHE_MS) return this.cached.value;
    this.inflight ??= this.run().finally(() => {
      this.inflight = null;
    });
    const value = await this.inflight;
    this.cached = { at: Date.now(), value };
    return value;
  }

  private async run(): Promise<HealthResponse> {
    const [database, cache, queue, bridge, storage] = await Promise.all([
      this.probeDatabase(),
      this.probeCache(),
      this.probeQueue(),
      this.probeBridge(),
      this.probeStorage(),
    ]);
    const checks = [database, cache, queue.check, bridge, storage];
    return {
      overall: overallState(checks.map((c) => c.state)),
      checks,
      queues: queue.rows,
      vitals: await this.vitals(),
      ts: new Date().toISOString(),
    };
  }

  /** One probe: a thrown error downgrades only its own card (rule 2). */
  private async timed(
    key: HealthCheck['key'],
    value: string,
    fn: () => Promise<Pick<HealthCheck, 'state' | 'detail'>>,
  ): Promise<HealthCheck> {
    const t0 = Date.now();
    try {
      const r = await fn();
      return { key, value, ...r, ping: Date.now() - t0 };
    } catch (err) {
      return { key, value, state: 'down', detail: shortError(err), ping: null };
    }
  }

  private probeDatabase(): Promise<HealthCheck> {
    return this.timed('database', 'Postgres', async () => {
      const t0 = Date.now();
      await this.db.primary.execute(sql`SELECT 1`);
      return { state: 'up', detail: `${Date.now() - t0} ms` };
    });
  }

  private probeCache(): Promise<HealthCheck> {
    return this.timed('cache', 'Redis', async () => {
      await this.redis.set('health:probe', '1', 'EX', 10);
      const back = await this.redis.get('health:probe');
      return back === '1'
        ? { state: 'up', detail: 'read/write ok' }
        : { state: 'warn', detail: 'write failed' };
    });
  }

  private async probeQueue(): Promise<{ check: HealthCheck; rows: HealthQueueRow[] }> {
    const t0 = Date.now();
    try {
      const rows = await Promise.all(
        this.queues().map(async ({ name, queue }) => {
          const c = await queue.getJobCounts(...JOB_STATES);
          return {
            name,
            pending: (c.waiting ?? 0) + (c.paused ?? 0) + (c.delayed ?? 0) + (c.prioritized ?? 0),
            failed: c.failed ?? 0,
          };
        }),
      );
      const pending = rows.reduce((n, r) => n + r.pending, 0);
      const failed = rows.reduce((n, r) => n + r.failed, 0);
      return {
        rows,
        check: {
          key: 'queue',
          value: 'BullMQ',
          state: queueState(pending, failed),
          detail: `${pending} pending · ${failed} failed`,
          ping: Date.now() - t0,
        },
      };
    } catch (err) {
      return {
        rows: [],
        check: {
          key: 'queue',
          value: 'BullMQ',
          state: 'down',
          detail: shortError(err),
          ping: null,
        },
      };
    }
  }

  /** Reachability, not correctness: any HTTP answer counts as up (WD-DASH-048 rule 3). */
  private async probeBridge(): Promise<HealthCheck> {
    // The address an operator saved in the Node bridge panel (WD-NODE-052) wins; the environment is the fallback.
    const saved = await this.bridge?.target();
    const url = saved?.serverUrl || this.config.get<string>('NODE_BRIDGE_URL')?.trim();
    if (!url) {
      return {
        key: 'bridge',
        state: 'warn',
        value: 'Not configured',
        detail: 'Set the Node bridge URL',
        ping: null,
      };
    }
    const t0 = Date.now();
    let host = url;
    try {
      host = new URL(url).host;
      const token = saved?.token ?? this.config.get<string>('NODE_BRIDGE_TOKEN');
      const res = await fetch(url, {
        headers: token ? { 'X-Node-Token': token } : {},
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      const ms = Date.now() - t0;
      return {
        key: 'bridge',
        state: 'up',
        value: host,
        detail: `HTTP ${res.status} · ${ms} ms`,
        ping: ms,
      };
    } catch {
      return {
        key: 'bridge',
        state: 'down',
        value: host,
        detail: 'unreachable - process down?',
        ping: null,
      };
    }
  }

  /**
   * ponytail: reachability only. WaDesk writes, reads back and deletes a probe object; that needs the storage adapter
   * (no S3 client is installed yet), so this asks the endpoint for any answer. Upgrade when the media-storage domain lands.
   */
  private async probeStorage(): Promise<HealthCheck> {
    const endpoint = this.config.get<string>('S3_ENDPOINT')?.trim();
    if (!endpoint) {
      return {
        key: 'storage',
        state: 'idle',
        value: 'Not configured',
        detail: 'No object storage endpoint set',
        ping: null,
      };
    }
    const value = `S3 · ${this.config.get<string>('S3_BUCKET_MEDIA') ?? 'media'}`;
    const t0 = Date.now();
    try {
      await fetch(endpoint, { method: 'HEAD', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
      const ms = Date.now() - t0;
      return { key: 'storage', state: 'up', value, detail: `reachable · ${ms} ms`, ping: ms };
    } catch (err) {
      return { key: 'storage', state: 'down', value, detail: shortError(err), ping: null };
    }
  }

  private async vitals(): Promise<HealthVitals> {
    const mem = process.memoryUsage();
    let diskFreeGb: number | null = null;
    let diskUsedPct: number | null = null;
    try {
      const s = await statfs(process.cwd());
      const total = s.blocks * s.bsize;
      const free = s.bavail * s.bsize;
      if (total > 0) {
        diskFreeGb = Math.round((free / 1024 ** 3) * 10) / 10;
        diskUsedPct = Math.round(((total - free) / total) * 1000) / 10;
      }
    } catch {
      // a platform without statfs simply shows no disk bar
    }
    return {
      nodeVersion: process.version,
      appVersion: process.env.npm_package_version ?? '0.1.0',
      environment: this.config.get<string>('NODE_ENV') ?? 'development',
      uptimeSeconds: Math.floor(process.uptime()),
      memoryRssMb: Math.round(mem.rss / 1024 / 1024),
      memoryHeapMb: Math.round(mem.heapUsed / 1024 / 1024),
      diskFreeGb,
      diskUsedPct,
    };
  }

  /**
   * WD-DASH-051 in BullMQ terms: per queue, drain waiting and delayed jobs and remove failed ones. Active jobs are never
   * touched (a deliberate fix of WaDesk's blanket delete). One audit row records what was removed.
   */
  async clearQueues(only?: string): Promise<ClearQueueResponse> {
    const targets = this.queues().filter((q) => !only || q.name === only);
    if (only && targets.length === 0) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'Unknown queue.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    let clearedPending = 0;
    let clearedFailed = 0;
    for (const { queue } of targets) {
      const c = await queue.getJobCounts(...JOB_STATES);
      clearedPending +=
        (c.waiting ?? 0) + (c.paused ?? 0) + (c.delayed ?? 0) + (c.prioritized ?? 0);
      clearedFailed += c.failed ?? 0;
      await queue.drain(true);
      await queue.clean(0, 0, 'failed');
    }
    await this.audit.recordStandalone({
      event: 'platform.health.queues_cleared',
      status: 'success',
      payload: { queue: only ?? 'all', clearedPending, clearedFailed },
    });
    this.cached = null;
    return {
      ok: true,
      clearedPending,
      clearedFailed,
      message: `Cleared ${clearedPending} pending and ${clearedFailed} failed job(s).`,
    };
  }
}
