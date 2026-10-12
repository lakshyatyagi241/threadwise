import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { DatabaseService } from '../../infra/db/database.service';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
import {
  UNOFFICIAL_WHATSAPP_GATE,
  type UnofficialWhatsappGate,
} from '../auth/unofficial-whatsapp.port';
import { DeviceControlService } from '../node-bridge-runtime';
import { DeviceGroupsSyncService } from './device-groups-sync.service';

/** How often a worker looks for a number whose directory is due. A tick reads few rows and does nothing when none is due. */
export const SWEEP_TICK_MS = 10 * 60_000;
/** Numbers one tick may refresh at most: the sweep is a safety net, never a burst. */
export const SWEEP_PER_TICK = 5;
/** Up to this long a refresh waits before it starts, so a restart does not make every number read at the same second. */
export const SWEEP_JITTER_MS = 20_000;

/** `WA_GROUPS_SWEEP_HOURS`: how stale a number's directory may get before the sweep re-reads it (default 6; 0 turns the sweep off). */
export function sweepHours(env: Record<string, string | undefined> = process.env): number {
  const raw = env.WA_GROUPS_SWEEP_HOURS;
  if (raw === undefined || raw.trim() === '') return 6;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 6;
}

const sweepKey = (orgId: number, deviceId: number) => `wa:grpsweep:${orgId}:${deviceId}`;

/**
 * The low-frequency safety net of the group directory (worker): the socket events keep it fresh, and this reads the whole list again for a
 * connected number now and then, in case an event was missed (a worker restart, a dropped connection). It never loops: a number is claimed
 * for `WA_GROUPS_SWEEP_HOURS` in Redis (so only one worker does it, and a restart does not repeat it), at most five numbers per ten
 * minutes, each after a random delay, and the read goes through the same per-number ban-safety limiter as every group action (a number
 * that is resting or over its budget is skipped and tried again on a later tick). Only workspaces on the unofficial allow-list.
 */
@Injectable()
export class DeviceGroupsSweepService {
  private readonly logger = new Logger(DeviceGroupsSweepService.name);
  /** Tests set this to 0. */
  jitterMs = SWEEP_JITTER_MS;
  private running = false;

  constructor(
    private readonly db: DatabaseService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(UNOFFICIAL_WHATSAPP_GATE) private readonly gate: UnofficialWhatsappGate,
    private readonly control: DeviceControlService,
    private readonly sync: DeviceGroupsSyncService,
  ) {}

  @Interval(SWEEP_TICK_MS)
  async tick(): Promise<number> {
    try {
      return await this.run();
    } catch (err) {
      this.logger.error({ err: String(err) }, '[GROUPS] directory sweep failed');
      return 0;
    }
  }

  /** One pass; returns how many numbers were re-read. */
  async run(): Promise<number> {
    const hours = sweepHours();
    if (hours === 0 || this.running) return 0;
    this.running = true;
    try {
      const orgs = await this.gate.enabledOrgIds();
      if (orgs.size === 0) return 0;
      const rows = await this.db.privileged(async (tx) => {
        const res = await tx.execute(sql`
          SELECT org_id, id FROM devices WHERE status = 'connected' ORDER BY random() LIMIT 200`);
        return res.rows as unknown as Array<{ org_id: number | string; id: number | string }>;
      });
      let done = 0;
      for (const r of rows) {
        if (done >= SWEEP_PER_TICK) break;
        const orgId = Number(r.org_id);
        const deviceId = Number(r.id);
        if (!orgs.has(orgId)) continue;
        const key = sweepKey(orgId, deviceId);
        const claimed = await this.redis.set(key, '1', 'EX', Math.ceil(hours * 3600), 'NX');
        if (claimed !== 'OK') continue;
        if (this.jitterMs > 0) {
          await new Promise((res) => setTimeout(res, Math.floor(Math.random() * this.jitterMs)));
        }
        if (await this.refresh(orgId, deviceId)) done++;
        else await this.redis.del(key).catch(() => undefined); // not done: due again on a later tick
      }
      return done;
    } finally {
      this.running = false;
    }
  }

  private async refresh(orgId: number, deviceId: number): Promise<boolean> {
    const res = await this.control.groupAction(orgId, deviceId, { type: 'list' });
    if (!res.ok || res.status !== 'group' || !('groups' in res.result)) {
      this.logger.debug({ orgId, deviceId, status: res.status }, '[GROUPS] sweep skipped a number');
      return false;
    }
    await this.sync.applySnapshots(orgId, deviceId, res.result.groups, { complete: true });
    return true;
  }
}
