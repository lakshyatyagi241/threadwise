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
  type HealthActivity,
  type HealthEngine,
  type HealthCheck,
  type HealthQueueRow,
  type HealthResponse,
  type HealthVitals,
} from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { QUEUES } from '../../infra/queue/queues';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
import { AuthAuditService, PlatformStore } from '../auth';
import { NodeBridgeSettingsService, NodeWorkerStatus } from '../node-bridge-runtime';
import { overallState, queueState, shortError } from './health-rules';

/** A poll storm (several consoles at 20 s) shares one run of the probes. */
const CACHE_MS = 3_000;
const PROBE_TIMEOUT_MS = 5_000;
const JOB_STATES = ['waiting', 'paused', 'delayed', 'prioritized', 'failed'] as const;

/**
 * System health (TW-DASH-048, 049, 050, 051). Reads only platform plumbing (Postgres, Redis, BullMQ, the bridge, storage);
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
    private readonly store: PlatformStore,
    @Optional() private readonly bridge?: NodeBridgeSettingsService,
    @Optional() private readonly workers?: NodeWorkerStatus,
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
      engines: await this.engines(),
      vitals: await this.vitals(),
      activity: await this.activity(),
      throughput: await this.throughput(),
      ts: new Date().toISOString(),
    };
  }

  /** A counter that fails or finds no table reads 0 (Reference rule); one tx each so a failure cannot abort the others. */
  private async count(query: ReturnType<typeof sql>): Promise<number> {
    try {
      return await this.store.tx(async (tx) => {
        const r = await tx.execute(query);
        return Number((r.rows[0] as { n: number | string } | undefined)?.n ?? 0);
      });
    } catch {
      return 0;
    }
  }

  /**
   * TW-DASH-050: numbers per engine across every workspace. Unofficial devices by status, then WABA and Twilio provider configs (other
   * providers, such as Meta Ads, are not messaging engines). A query that fails omits its engine.
   */
  private async engines(): Promise<HealthEngine[]> {
    const out: HealthEngine[] = [];
    const rowsOf = async (query: ReturnType<typeof sql>) => {
      try {
        return await this.store.tx(
          async (tx) =>
            (await tx.execute(query)).rows as Array<{
              provider?: string;
              status: string;
              n: number;
            }>,
        );
      } catch {
        return null;
      }
    };
    const engine = (
      key: HealthEngine['key'],
      label: string,
      rows: Array<{ status: string; n: number }>,
      isUp: (status: string) => boolean,
    ): HealthEngine => {
      const total = rows.reduce((a, r) => a + Number(r.n), 0);
      const connected = rows.filter((r) => isUp(r.status)).reduce((a, r) => a + Number(r.n), 0);
      return {
        key,
        label,
        connected,
        total,
        state: total === 0 ? 'idle' : connected > 0 ? 'up' : 'down',
        breakdown: rows.map((r) => ({ status: r.status, count: Number(r.n) })),
      };
    };
    const devices = await rowsOf(
      sql`SELECT status, count(*)::int AS n FROM devices GROUP BY status ORDER BY status`,
    );
    if (devices) out.push(engine('baileys', 'Unofficial API', devices, (s) => s === 'connected'));
    const configs = await rowsOf(sql`
      SELECT provider, status, count(*)::int AS n FROM wa_provider_configs
      WHERE provider IN ('waba', 'twilio') GROUP BY provider, status ORDER BY provider, status`);
    for (const provider of ['waba', 'twilio'] as const) {
      const rows = (configs ?? []).filter((r) => r.provider === provider);
      if (rows.length > 0)
        out.push(
          engine(provider, provider === 'twilio' ? 'Twilio' : 'WhatsApp Cloud (WABA)', rows, (s) =>
            ['connected', 'active', 'verified'].includes(s),
          ),
        );
    }
    return out;
  }

  /** TW-DASH-049: last 24 hours, every workspace. */
  private async activity(): Promise<HealthActivity> {
    const [messages, aiCalls, conversations, webhooks] = await Promise.all([
      this.count(
        sql`SELECT count(*)::int AS n FROM messages WHERE created_at >= now() - interval '24 hours'`,
      ),
      this.count(
        sql`SELECT count(*)::int AS n FROM ai_token_usage WHERE created_at >= now() - interval '24 hours'`,
      ),
      this.count(
        sql`SELECT count(*)::int AS n FROM conversations WHERE created_at >= now() - interval '24 hours'`,
      ),
      this.count(
        sql`SELECT count(*)::int AS n FROM incoming_webhook_events WHERE created_at >= now() - interval '24 hours'`,
      ),
    ]);
    return { messages, aiCalls, conversations, webhooks };
  }

  /** TW-DASH-049: 14 UTC days (today and 13 before), every direction and status, soft-deleted rows included like Reference. */
  private async throughput(): Promise<Array<{ date: string; count: number }>> {
    let rows: Array<{ d: string; n: number }> = [];
    try {
      rows = await this.store.tx(
        async (tx) =>
          (
            await tx.execute(sql`
            SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d, count(*)::int AS n FROM messages
            WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' - interval '13 days' GROUP BY 1`)
          ).rows as Array<{ d: string; n: number }>,
      );
    } catch {
      rows = [];
    }
    const by = new Map(rows.map((r) => [r.d, Number(r.n)]));
    const today = Date.now();
    return Array.from({ length: 14 }, (_, i) => {
      const date = new Date(today - (13 - i) * 86_400_000).toISOString().slice(0, 10);
      return { date, count: by.get(date) ?? 0 };
    });
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

  /** Reachability, not correctness: any HTTP answer counts as up (TW-DASH-048 rule 3). */
  private async probeBridge(): Promise<HealthCheck> {
    // The runtime is a worker with no HTTP surface: when one reports in, that is the answer (TW-NODE-004).
    const running = await this.workers?.read().catch(() => null);
    if (running && running.workers > 0) {
      return {
        key: 'bridge',
        state: 'up',
        value: `${running.workers} worker${running.workers === 1 ? '' : 's'}`,
        detail: `${running.devices} device${running.devices === 1 ? '' : 's'} connected`,
        ping: null,
      };
    }
    // The address an operator saved in the Node bridge panel (TW-NODE-052) wins; the environment is the fallback.
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
   * ponytail: reachability only. Reference writes, reads back and deletes a probe object; that needs the storage adapter
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
   * TW-DASH-051 in BullMQ terms: per queue, drain waiting and delayed jobs and remove failed ones. Active jobs are never
   * touched (a deliberate fix of Reference's blanket delete). One audit row records what was removed.
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
