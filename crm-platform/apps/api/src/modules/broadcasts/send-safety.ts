import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import type { Tx } from '@crm/db';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
import { NodeBridgeSettingsService } from '../node-bridge-runtime';
import { DEFAULT_PACING, utcDayKey, type PacingSettings, type Random } from './pacing';

/** The clock and the dice of a run, so a test can make time instant and chance fixed. */
@Injectable()
export class PacingRuntime {
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  random: Random = Math.random;
  now: () => Date = () => new Date();
}

/** The pacing settings of an organization. The platform settings domain owns them (System Message settings: `msg_gap`, ...). */
export interface PacingSettingsSource {
  get(tx: Tx, orgId: number): Promise<PacingSettings>;
}
export const PACING_SETTINGS = Symbol('BROADCAST_PACING_SETTINGS');

/**
 * The platform's sender pacing, as the operator saved it in the Node bridge panel (WD-NODE-029). WaDesk's bridge re-pulled it
 * before every bulk run; reading it here at the start of each run does the same. The daily cap was never configurable in WaDesk
 * (Laravel never sent `baileys_daily_cap`), so its default stays.
 */
@Injectable()
export class PlatformPacingSettings implements PacingSettingsSource {
  constructor(private readonly node: NodeBridgeSettingsService) {}

  async get(): Promise<PacingSettings> {
    const p = await this.node.pacing();
    return {
      msgGapSeconds: p.msgGap,
      enableBatches: p.enableBatches,
      batchSize: p.batchesGap,
      batchGapMinutes: p.bwMsgGap,
      baileysDailyCap: DEFAULT_PACING.baileysDailyCap,
    };
  }
}

/**
 * Messages sent today by one sender on the unofficial engine, per UTC day (WD-BCAST-022). WaDesk kept this in Node's memory,
 * so a restart reset it; it is in Redis here, shared by every worker, and expires on its own.
 */
@Injectable()
export class CapTally {
  constructor(
    private readonly runtime: PacingRuntime,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  private key(orgId: number, engine: string, senderId: number) {
    return `bcast:cap:${orgId}:${engine}:${senderId}:${utcDayKey(this.runtime.now())}`;
  }

  async sentToday(orgId: number, engine: string, senderId: number): Promise<number> {
    try {
      return Number((await this.redis.get(this.key(orgId, engine, senderId))) ?? 0);
    } catch {
      return 0; // Redis down: the cap cannot be known, sending goes on
    }
  }

  async bump(orgId: number, engine: string, senderId: number): Promise<void> {
    try {
      const key = this.key(orgId, engine, senderId);
      if ((await this.redis.incr(key)) === 1) await this.redis.expire(key, 2 * 86_400);
    } catch {
      /* the next send simply counts from here */
    }
  }
}

const LEASE_MS = 60_000;

/**
 * One broadcast at a time per sender (WD-BCAST-022: Node ran a sender's loops strictly in sequence). Two runs through the same
 * number would break the gaps between messages that the number's quality depends on. The lease expires by itself, so a
 * worker that dies does not hold the number.
 */
@Injectable()
export class SenderLease {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  static key(orgId: number, engine: string, senderId: number) {
    return `bcast:sender:${orgId}:${engine}:${senderId}`;
  }

  /** A token when the lease is taken, null when another run holds it. Redis down means no lease and no blocking. */
  async acquire(key: string): Promise<string | null> {
    const token = randomUUID();
    try {
      return (await this.redis.set(key, token, 'PX', LEASE_MS, 'NX')) === 'OK' ? token : null;
    } catch {
      return token;
    }
  }

  async renew(key: string, token: string): Promise<void> {
    try {
      if ((await this.redis.get(key)) === token) await this.redis.pexpire(key, LEASE_MS);
    } catch {
      /* the lease runs out, which only lets another run start */
    }
  }

  async release(key: string, token: string): Promise<void> {
    try {
      if ((await this.redis.get(key)) === token) await this.redis.del(key);
    } catch {
      /* expires by itself */
    }
  }
}
