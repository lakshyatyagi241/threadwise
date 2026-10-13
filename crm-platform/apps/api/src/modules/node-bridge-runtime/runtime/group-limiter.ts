import { Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { WA_DEVICE_GROUP_LIMIT_DEFAULTS, type WaGroupRateScope } from '@crm/contracts';
import type { GroupAction } from '../../../infra/providers/node-bridge-runtime/socket.port';
import { waKeys } from './wa-redis';

/**
 * The per-device limits on group operations (ban safety, decision D11). Personal numbers get restricted fastest through groups: creating
 * many, adding many strangers, joining by link and polling the whole list are the usual triggers. Counted per workspace and device in Redis,
 * checked by `DeviceControlService` BEFORE a command is sent to the worker (local and Redis paths alike), and a refusal that looks like a
 * limit or ban signal pauses the device's group operations for a while.
 */
export interface GroupLimits {
  opsPerMinute: number;
  opsPerDay: number;
  createsPerDay: number;
  joinByLinkPerDay: number;
  /** Joining by invite link (and previewing one) is refused unless the platform switches it on. Off by default (highest ban risk). */
  joinByLinkEnabled: boolean;
  cooldownSeconds: number;
  /** People per add, remove, promote or demote call. */
  participantsPerCall: number;
}

/**
 * Environment variables (all optional; an invalid or negative value falls back to the default):
 * `WA_GROUPS_OPS_PER_MINUTE` (20), `WA_GROUPS_OPS_PER_DAY` (200), `WA_GROUPS_CREATES_PER_DAY` (5), `WA_GROUPS_JOIN_BY_LINK_PER_DAY` (5),
 * `WA_GROUPS_JOIN_BY_LINK_ENABLED` (`true`/`1` to turn on; default off), `WA_GROUPS_COOLDOWN_SECONDS` (600),
 * `WA_GROUPS_PARTICIPANTS_PER_CALL` (20).
 */
export function loadGroupLimits(
  env: Record<string, string | undefined> = process.env,
): GroupLimits {
  const int = (name: string, fallback: number): number => {
    const raw = env[name];
    if (raw === undefined || raw.trim() === '') return fallback;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 ? n : fallback;
  };
  const d = WA_DEVICE_GROUP_LIMIT_DEFAULTS;
  return {
    opsPerMinute: int('WA_GROUPS_OPS_PER_MINUTE', d.opsPerMinute),
    opsPerDay: int('WA_GROUPS_OPS_PER_DAY', d.opsPerDay),
    createsPerDay: int('WA_GROUPS_CREATES_PER_DAY', d.createsPerDay),
    joinByLinkPerDay: int('WA_GROUPS_JOIN_BY_LINK_PER_DAY', d.joinByLinkPerDay),
    joinByLinkEnabled: /^(1|true|yes|on)$/i.test((env.WA_GROUPS_JOIN_BY_LINK_ENABLED ?? '').trim()),
    cooldownSeconds: int('WA_GROUPS_COOLDOWN_SECONDS', d.cooldownSeconds),
    participantsPerCall: Math.max(1, int('WA_GROUPS_PARTICIPANTS_PER_CALL', d.participantsPerCall)),
  };
}

/** What an action costs against the counters: every action is an `op`; a create also counts as a create, a link join or preview as a join. */
export type GroupOpKind = 'op' | 'create' | 'join_link';

export function opKindOf(action: GroupAction): GroupOpKind {
  switch (action.type) {
    case 'create':
      return 'create';
    case 'accept_invite':
    case 'get_invite_info':
      return 'join_link';
    default:
      return 'op';
  }
}

/** Why the limiter said no, and when to try again. */
export interface GroupRefusal {
  scope: WaGroupRateScope;
  retryAfterSeconds: number;
  limit: number;
}

export interface GroupLimitCounter {
  limit: number;
  remaining: number;
  /** ISO time the counter resets, null when nothing was counted. */
  resetsAt: string | null;
}
export interface GroupLimitsView {
  opsPerMinute: GroupLimitCounter;
  opsPerDay: GroupLimitCounter;
  createsPerDay: GroupLimitCounter;
  joinByLinkPerDay: GroupLimitCounter;
  cooldownUntil: string | null;
  participantsPerCall: number;
  joinByLinkEnabled: boolean;
}

const MINUTE_S = 60;
const secondsToUtcMidnight = (now: Date): number =>
  Math.max(
    1,
    Math.ceil(
      (Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime()) /
        1000,
    ),
  );
const dayBucket = (now: Date): string => now.toISOString().slice(0, 10);
const minuteBucket = (now: Date): string => String(Math.floor(now.getTime() / 60_000));

/**
 * Fixed windows: a minute counter, and day counters that reset at 00:00 UTC. Fail-open on a Redis error (the same trade the other throttles
 * make: a cache outage must not stop the product; it is logged).
 */
export class GroupOpLimiter {
  private readonly logger = new Logger(GroupOpLimiter.name);

  constructor(
    private readonly redis: Redis,
    readonly limits: GroupLimits,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /**
   * Counts one action and returns null when it may go ahead, or why it must not. A refusal gives back what it counted (a refused call
   * costs nothing). Order: cooldown, then the per-minute counter, the day counter, then the create or join counter.
   */
  async acquire(orgId: number, deviceId: number, kind: GroupOpKind): Promise<GroupRefusal | null> {
    try {
      const now = this.clock();
      const cool = await this.cooldownRemaining(orgId, deviceId);
      if (cool > 0) return { scope: 'cooldown', retryAfterSeconds: cool, limit: 0 };

      const steps: Array<{
        scope: WaGroupRateScope;
        part: string;
        bucket: string;
        limit: number;
        ttl: number;
      }> = [
        {
          scope: 'ops_minute',
          part: 'min',
          bucket: minuteBucket(now),
          limit: this.limits.opsPerMinute,
          ttl: MINUTE_S,
        },
        {
          scope: 'ops_day',
          part: 'day',
          bucket: dayBucket(now),
          limit: this.limits.opsPerDay,
          ttl: secondsToUtcMidnight(now),
        },
      ];
      if (kind === 'create') {
        steps.push({
          scope: 'creates_day',
          part: 'create',
          bucket: dayBucket(now),
          limit: this.limits.createsPerDay,
          ttl: secondsToUtcMidnight(now),
        });
      } else if (kind === 'join_link') {
        steps.push({
          scope: 'join_link_day',
          part: 'join',
          bucket: dayBucket(now),
          limit: this.limits.joinByLinkPerDay,
          ttl: secondsToUtcMidnight(now),
        });
      }
      const taken: string[] = [];
      for (const step of steps) {
        const k = waKeys.groupCount(orgId, deviceId, step.part, step.bucket);
        const res = await this.redis.multi().incr(k).expire(k, step.ttl, 'NX').ttl(k).exec();
        const count = Number(res?.[0]?.[1] ?? 1);
        taken.push(k);
        if (count > step.limit) {
          // Give back everything this call counted: a refused call costs nothing.
          for (const t of taken) await this.redis.decr(t);
          const ttl = Number(res?.[2]?.[1] ?? step.ttl);
          return {
            scope: step.scope,
            retryAfterSeconds: ttl > 0 ? ttl : step.ttl,
            limit: step.limit,
          };
        }
      }
      return null;
    } catch (err) {
      this.logger.warn({ err: String(err) }, 'group limiter failed open');
      return null;
    }
  }

  /** Pauses the device's group operations for the cooldown. Called when WhatsApp refuses in a way that looks like a limit or a ban signal. */
  async startCooldown(orgId: number, deviceId: number): Promise<void> {
    if (this.limits.cooldownSeconds <= 0) return;
    try {
      await this.redis.set(
        waKeys.groupCooldown(orgId, deviceId),
        String(this.clock().getTime() + this.limits.cooldownSeconds * 1000),
        'EX',
        this.limits.cooldownSeconds,
      );
    } catch (err) {
      this.logger.warn({ err: String(err) }, 'group cooldown could not be set');
    }
  }

  /** Seconds left of the cooldown, 0 when none. */
  async cooldownRemaining(orgId: number, deviceId: number): Promise<number> {
    const ttl = await this.redis.ttl(waKeys.groupCooldown(orgId, deviceId));
    return ttl > 0 ? ttl : 0;
  }

  /** What is left of every counter, without counting anything (for the Groups tab's state and its "3 of 5 created today"). */
  async peek(orgId: number, deviceId: number): Promise<GroupLimitsView> {
    const now = this.clock();
    const midnight = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
    ).toISOString();
    const counter = async (
      part: string,
      bucket: string,
      limit: number,
      resets: (ttl: number) => string,
    ): Promise<GroupLimitCounter> => {
      try {
        const k = waKeys.groupCount(orgId, deviceId, part, bucket);
        const [raw, ttl] = await Promise.all([this.redis.get(k), this.redis.ttl(k)]);
        const used = Math.max(0, Number(raw ?? 0));
        return {
          limit,
          remaining: Math.max(0, limit - used),
          resetsAt: raw !== null && ttl > 0 ? resets(ttl) : null,
        };
      } catch {
        return { limit, remaining: limit, resetsAt: null };
      }
    };
    const inSeconds = (ttl: number) => new Date(now.getTime() + ttl * 1000).toISOString();
    const [opsPerMinute, opsPerDay, createsPerDay, joinByLinkPerDay, cool] = await Promise.all([
      counter('min', minuteBucket(now), this.limits.opsPerMinute, inSeconds),
      counter('day', dayBucket(now), this.limits.opsPerDay, () => midnight),
      counter('create', dayBucket(now), this.limits.createsPerDay, () => midnight),
      counter('join', dayBucket(now), this.limits.joinByLinkPerDay, () => midnight),
      this.cooldownRemaining(orgId, deviceId).catch(() => 0),
    ]);
    return {
      opsPerMinute,
      opsPerDay,
      createsPerDay,
      joinByLinkPerDay,
      cooldownUntil: cool > 0 ? inSeconds(cool) : null,
      participantsPerCall: this.limits.participantsPerCall,
      joinByLinkEnabled: this.limits.joinByLinkEnabled,
    };
  }
}
