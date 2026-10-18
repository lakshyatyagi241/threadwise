import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import {
  WABA_THROUGHPUT_SETTINGS_DEFAULTS,
  type WabaRateSource,
  type WabaThroughputEvent,
  type WabaThroughputEventKind,
  type WabaThroughputSeriesPoint,
  type WabaThroughputSettings,
} from '@crm/contracts';
import { REDIS_CLIENT } from '../../../redis/redis.module';
import {
  CFG_TTL_S,
  EVENTS_MAX,
  EVENTS_TTL_S,
  MINUTE_TTL_S,
  SECOND_TTL_S,
  TIER_BUCKET_TTL_S,
  govKeys,
} from './throughput-keys';
import {
  MIN_SPEED_FACTOR,
  RECOVERY_MS,
  afterThrottle,
  hourBucket,
  minuteBucket,
  recoveredFactor,
  secondBucket,
} from './throughput-rules';

/** What the control plane publishes for a number, and the governor reads on every send. */
export interface PublishedNumber {
  /** Messages per second sends are paced to. */
  mps: number;
  /** The cap before the safety margin (Meta's, or the operator's). */
  capMps: number;
  source: WabaRateSource;
  paused: boolean;
  pauseReason: string | null;
  tierName: string | null;
  /** Unique recipients per 24 hours the tier allows; 0 when unlimited or unknown. */
  tierCap: number;
  tierUnlimited: boolean;
}

export type ReservationStatus = 'ok' | 'paused' | 'deferred';

export interface Reservation {
  status: ReservationStatus;
  /** For `ok`: how long this send waits for its turn. For `deferred`: how long until a slot is within the local wait limit. */
  waitMs: number;
  /** The rate in force for this send after the adaptive factor. */
  mps: number;
  /** 0 to 100. */
  speedPct: number;
}

export interface NumberLive {
  mpsNow: number;
  peak1m: number;
  sent5m: number;
  waited5m: number;
  waitMs5m: number;
  deferred5m: number;
  metaThrottled5m: number;
  speedFactor: number;
  paused: boolean;
}

const BURST_MS = 250;

/**
 * GCRA (generic cell rate) pacing in one atomic step. Each number has one "theoretical arrival time" (`slot`): the instant the next
 * send is due at the number's rate. A send may go once `now >= slot - burst`; otherwise it is told how long to wait. The wait is
 * reserved by moving `slot` forward, so concurrent workers on any machine take consecutive turns and the sum never exceeds the rate.
 * A send whose wait would pass the local maximum is NOT reserved: it is handed back, so a deep backlog does not push the slot out
 * into the future for everyone behind it.
 *
 * Time is Redis's own clock, so workers with drifting clocks agree. The adaptive factor (set when Meta throttled the number) shrinks the
 * rate and climbs back linearly.
 *
 * KEYS: cfg, slot, penalty.   ARGV: default mps, max wait ms, adaptive (0/1), burst ms, recovery ms, minimum factor.
 * Returns { status (0 ok, 2 paused, 3 deferred), wait ms, rate, speed percent }.
 */
const RESERVE_LUA = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local cfg = redis.call('HMGET', KEYS[1], 'mps', 'paused')
if cfg[2] == '1' then return {2, 0, 0, 0} end
local mps = tonumber(cfg[1]) or tonumber(ARGV[1])
local factor = 1
if ARGV[3] == '1' then
  local p = redis.call('HMGET', KEYS[3], 'f', 'at')
  local f = tonumber(p[1])
  local at = tonumber(p[2])
  if f and at then
    factor = math.min(1, f + ((now - at) / tonumber(ARGV[5])) * (1 - tonumber(ARGV[6])))
  end
end
local rate = math.max(1, math.floor(mps * factor))
local interval = 1000 / rate
local tat = tonumber(redis.call('GET', KEYS[2]))
if (not tat) or tat < now then tat = now end
local wait = tat - tonumber(ARGV[4]) - now
if wait < 0 then wait = 0 end
if wait > tonumber(ARGV[2]) then return {3, math.ceil(wait), rate, math.floor(factor * 100)} end
redis.call('SET', KEYS[2], string.format('%.3f', tat + interval), 'PX', 120000)
return {0, math.ceil(wait), rate, math.floor(factor * 100)}
`;

type ReserveFn = (
  cfg: string,
  slot: string,
  penalty: string,
  defaultMps: number,
  maxWaitMs: number,
  adaptive: number,
  burstMs: number,
  recoveryMs: number,
  minFactor: number,
) => Promise<[number, number, number, number]>;

const hashRecipient = (to: string) => createHash('sha1').update(to).digest('base64').slice(0, 16);

/**
 * Everything the send governor and the console keep in Redis: the published limits of each number, the pacing slot, the adaptive
 * back-off, and the counters behind the live view. Limits are written by the control plane (`WabaThroughputService`) and only read here
 * on the hot path, so a send never touches Postgres. Every method that runs on a send swallows Redis errors: a limiter that cannot be
 * read must let the send through, not stop WhatsApp.
 */
@Injectable()
export class ThroughputStore {
  private readonly logger = new Logger(ThroughputStore.name);
  private globalCache: { at: number; value: WabaThroughputSettings } | null = null;
  private readonly reserveFn: ReserveFn;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {
    (
      this.redis as unknown as {
        defineCommand(name: string, def: { numberOfKeys: number; lua: string }): void;
      }
    ).defineCommand('wabaGovReserve', { numberOfKeys: 3, lua: RESERVE_LUA });
    this.reserveFn = (...args) =>
      (this.redis as unknown as Record<string, ReserveFn>).wabaGovReserve!(...args);
  }

  // --- limits (written by the control plane) -----------------------------------------------------------------------------------

  async publishGlobal(s: WabaThroughputSettings): Promise<void> {
    await this.redis.hset(govKeys.global, {
      enabled: s.enabled ? '1' : '0',
      defaultMps: String(s.defaultMps),
      safetyMarginPct: String(s.safetyMarginPct),
      maxLocalWaitMs: String(s.maxLocalWaitMs),
      adaptiveBackoff: s.adaptiveBackoff ? '1' : '0',
      tierWarnPct: String(s.tierWarnPct),
      enforceTierCap: s.enforceTierCap ? '1' : '0',
      syncIntervalMinutes: String(s.syncIntervalMinutes),
    });
    this.globalCache = null;
  }

  /** The platform settings as sends see them: cached for five seconds in each process, defaults when nothing is published. */
  async global(): Promise<WabaThroughputSettings> {
    const now = Date.now();
    if (this.globalCache && now - this.globalCache.at < 5_000) return this.globalCache.value;
    const d = WABA_THROUGHPUT_SETTINGS_DEFAULTS;
    const h = await this.redis.hgetall(govKeys.global);
    const int = (v: string | undefined, fallback: number) => {
      const n = Number(v);
      return v !== undefined && Number.isFinite(n) ? n : fallback;
    };
    const bool = (v: string | undefined, fallback: boolean) =>
      v === undefined ? fallback : v === '1';
    const value: WabaThroughputSettings = {
      enabled: bool(h.enabled, d.enabled),
      defaultMps: int(h.defaultMps, d.defaultMps),
      safetyMarginPct: int(h.safetyMarginPct, d.safetyMarginPct),
      maxLocalWaitMs: int(h.maxLocalWaitMs, d.maxLocalWaitMs),
      adaptiveBackoff: bool(h.adaptiveBackoff, d.adaptiveBackoff),
      tierWarnPct: int(h.tierWarnPct, d.tierWarnPct),
      enforceTierCap: bool(h.enforceTierCap, d.enforceTierCap),
      syncIntervalMinutes: int(h.syncIntervalMinutes, d.syncIntervalMinutes),
    };
    this.globalCache = { at: now, value };
    return value;
  }

  async publishNumber(phoneNumberId: string, n: PublishedNumber): Promise<void> {
    const key = govKeys.cfg(phoneNumberId);
    await this.redis
      .multi()
      .hset(key, {
        mps: String(n.mps),
        capMps: String(n.capMps),
        source: n.source,
        paused: n.paused ? '1' : '0',
        pauseReason: n.pauseReason ?? '',
        tierName: n.tierName ?? '',
        tierCap: String(n.tierCap),
        tierUnlimited: n.tierUnlimited ? '1' : '0',
      })
      .expire(key, CFG_TTL_S)
      .exec();
  }

  /** The published limits of a number, or null when none were published (the governor then uses the platform default). */
  async number(phoneNumberId: string): Promise<PublishedNumber | null> {
    const h = await this.redis.hgetall(govKeys.cfg(phoneNumberId));
    if (!h.mps) return null;
    return {
      mps: Number(h.mps),
      capMps: Number(h.capMps ?? h.mps),
      source: (h.source as WabaRateSource) ?? 'default',
      paused: h.paused === '1',
      pauseReason: h.pauseReason || null,
      tierName: h.tierName || null,
      tierCap: Number(h.tierCap ?? 0),
      tierUnlimited: h.tierUnlimited === '1',
    };
  }

  // --- the send path ------------------------------------------------------------------------------------------------------------

  async reserve(phoneNumberId: string, g: WabaThroughputSettings): Promise<Reservation> {
    const [status, waitMs, mps, speedPct] = await this.reserveFn(
      govKeys.cfg(phoneNumberId),
      govKeys.slot(phoneNumberId),
      govKeys.penalty(phoneNumberId),
      g.defaultMps,
      g.maxLocalWaitMs,
      g.adaptiveBackoff ? 1 : 0,
      BURST_MS,
      RECOVERY_MS,
      MIN_SPEED_FACTOR,
    );
    return {
      status: status === 2 ? 'paused' : status === 3 ? 'deferred' : 'ok',
      waitMs,
      mps,
      speedPct,
    };
  }

  /** Meta accepted a message: the per-second and per-minute counters, and the recipient in the hour's tier count. */
  async recordSent(
    phoneNumberId: string,
    recipient: string | null,
    businessInitiated: boolean,
  ): Promise<void> {
    const now = Date.now();
    const sec = govKeys.second(phoneNumberId, secondBucket(now));
    const min = govKeys.minute(phoneNumberId, minuteBucket(now));
    const p = this.redis
      .multi()
      .incr(sec)
      .expire(sec, SECOND_TTL_S)
      .hincrby(min, 'sent', 1)
      .expire(min, MINUTE_TTL_S);
    if (businessInitiated && recipient) {
      const tier = govKeys.tier(phoneNumberId, hourBucket(now));
      p.pfadd(tier, hashRecipient(recipient)).expire(tier, TIER_BUCKET_TTL_S);
    }
    await p.exec();
  }

  async recordWait(phoneNumberId: string, waitMs: number): Promise<void> {
    const min = govKeys.minute(phoneNumberId, minuteBucket(Date.now()));
    await this.redis
      .multi()
      .hincrby(min, 'waited', 1)
      .hincrby(min, 'waitMs', Math.round(waitMs))
      .expire(min, MINUTE_TTL_S)
      .exec();
  }

  async recordDeferred(phoneNumberId: string): Promise<void> {
    const min = govKeys.minute(phoneNumberId, minuteBucket(Date.now()));
    await this.redis.multi().hincrby(min, 'deferred', 1).expire(min, MINUTE_TTL_S).exec();
  }

  /**
   * Meta answered 130429: halve the number's speed (it climbs back by itself, see `recoveredFactor`). Meta answered 131057: the number is
   * being upgraded and unusable for up to a minute, so the slot is pushed out and sends are handed back until it is over.
   */
  async recordMetaThrottle(
    phoneNumberId: string,
    kind: 'throughput' | 'upgrade',
    adaptive: boolean,
  ): Promise<void> {
    const now = Date.now();
    const min = govKeys.minute(phoneNumberId, minuteBucket(now));
    const p = this.redis.multi().hincrby(min, 'throttled', 1).expire(min, MINUTE_TTL_S);
    if (kind === 'upgrade') {
      p.set(govKeys.slot(phoneNumberId), String(now + 65_000), 'PX', 120_000);
    } else if (adaptive) {
      const current = await this.speedFactor(phoneNumberId, now);
      const pen = govKeys.penalty(phoneNumberId);
      p.hset(pen, { f: String(afterThrottle(current)), at: String(now) }).expire(pen, 600);
    }
    await p.exec();
  }

  async speedFactor(phoneNumberId: string, now = Date.now()): Promise<number> {
    const h = await this.redis.hgetall(govKeys.penalty(phoneNumberId));
    const f = Number(h.f);
    const at = Number(h.at);
    if (!h.f || !Number.isFinite(f) || !Number.isFinite(at)) return 1;
    return recoveredFactor(f, now - at);
  }

  /**
   * Unique recipients of template messages over the last 24 hourly buckets (a HyperLogLog per hour: constant memory, about 1% error).
   * An estimate of what Meta's messaging tier counts, not Meta's own figure.
   */
  async tierUsed(phoneNumberId: string, now = Date.now()): Promise<number> {
    const hour = hourBucket(now);
    const keys = Array.from({ length: 24 }, (_, i) => govKeys.tier(phoneNumberId, hour - i));
    return Number(await this.redis.pfcount(...keys));
  }

  /** {@link tierUsed} for many numbers in one round trip. */
  async tierUsedMany(phoneNumberIds: string[], now = Date.now()): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (phoneNumberIds.length === 0) return out;
    const hour = hourBucket(now);
    const pipe = this.redis.pipeline();
    for (const pn of phoneNumberIds)
      pipe.pfcount(...Array.from({ length: 24 }, (_, i) => govKeys.tier(pn, hour - i)));
    const res = (await pipe.exec()) ?? [];
    phoneNumberIds.forEach((pn, i) => out.set(pn, Number(res[i]?.[1] ?? 0)));
    return out;
  }

  // --- the event log -------------------------------------------------------------------------------------------------------------

  /**
   * Appends to the number's capped event list. A kind that repeats on every send (a hold, a deferral) is let through once every
   * `gateMs`, so one busy minute cannot flush the history.
   */
  async pushEvent(
    phoneNumberId: string,
    kind: WabaThroughputEventKind,
    detail: string | null,
    gateMs = 0,
  ): Promise<void> {
    if (gateMs > 0) {
      const ok = await this.redis.set(govKeys.eventGate(phoneNumberId, kind), '1', 'PX', gateMs, 'NX');
      if (ok !== 'OK') return;
    }
    const key = govKeys.events(phoneNumberId);
    await this.redis
      .multi()
      .lpush(key, JSON.stringify({ at: new Date().toISOString(), kind, detail }))
      .ltrim(key, 0, EVENTS_MAX - 1)
      .expire(key, EVENTS_TTL_S)
      .exec();
  }

  async events(phoneNumberId: string, limit = 50): Promise<WabaThroughputEvent[]> {
    const rows = await this.redis.lrange(govKeys.events(phoneNumberId), 0, limit - 1);
    const out: WabaThroughputEvent[] = [];
    for (const r of rows) {
      try {
        const e = JSON.parse(r) as WabaThroughputEvent;
        if (e && typeof e.at === 'string' && typeof e.kind === 'string') out.push(e);
      } catch {
        /* a row from an older shape: skipped */
      }
    }
    return out;
  }

  // --- the live view -------------------------------------------------------------------------------------------------------------

  /** The counters of many numbers in one round trip: a 10 second rate, a 60 second peak and the last five minutes. */
  async live(phoneNumberIds: string[], now = Date.now()): Promise<Map<string, NumberLive>> {
    const out = new Map<string, NumberLive>();
    if (phoneNumberIds.length === 0) return out;
    const sec = secondBucket(now);
    const min = minuteBucket(now);
    const pipe = this.redis.pipeline();
    for (const pn of phoneNumberIds) {
      pipe.mget(...Array.from({ length: 60 }, (_, i) => govKeys.second(pn, sec - i)));
      for (let i = 0; i < 5; i++) pipe.hgetall(govKeys.minute(pn, min - i));
      pipe.hgetall(govKeys.penalty(pn));
      pipe.hget(govKeys.cfg(pn), 'paused');
    }
    const res = (await pipe.exec()) ?? [];
    const per = 8;
    phoneNumberIds.forEach((pn, idx) => {
      const base = idx * per;
      const secs = ((res[base]?.[1] as Array<string | null> | undefined) ?? []).map((v) =>
        Number(v ?? 0),
      );
      let sent5m = 0;
      let waited5m = 0;
      let waitMs5m = 0;
      let deferred5m = 0;
      let metaThrottled5m = 0;
      for (let i = 1; i <= 5; i++) {
        const h = (res[base + i]?.[1] as Record<string, string> | undefined) ?? {};
        sent5m += Number(h.sent ?? 0);
        waited5m += Number(h.waited ?? 0);
        waitMs5m += Number(h.waitMs ?? 0);
        deferred5m += Number(h.deferred ?? 0);
        metaThrottled5m += Number(h.throttled ?? 0);
      }
      const pen = (res[base + 6]?.[1] as Record<string, string> | undefined) ?? {};
      const f = Number(pen.f);
      const at = Number(pen.at);
      const factor = pen.f && Number.isFinite(f) && Number.isFinite(at) ? recoveredFactor(f, now - at) : 1;
      out.set(pn, {
        mpsNow: Math.round((secs.slice(0, 10).reduce((a, b) => a + b, 0) / 10) * 10) / 10,
        peak1m: secs.reduce((a, b) => Math.max(a, b), 0),
        sent5m,
        waited5m,
        waitMs5m,
        deferred5m,
        metaThrottled5m,
        speedFactor: Math.round(factor * 100) / 100,
        paused: res[base + 7]?.[1] === '1',
      });
    });
    return out;
  }

  /** Sends per second for the last 60 seconds and per minute for the last 60 minutes, oldest first. */
  async series(
    phoneNumberId: string,
    now = Date.now(),
  ): Promise<{ perSecond: WabaThroughputSeriesPoint[]; perMinute: WabaThroughputSeriesPoint[] }> {
    const sec = secondBucket(now);
    const min = minuteBucket(now);
    const pipe = this.redis.pipeline();
    pipe.mget(...Array.from({ length: 60 }, (_, i) => govKeys.second(phoneNumberId, sec - 59 + i)));
    for (let i = 59; i >= 0; i--) pipe.hgetall(govKeys.minute(phoneNumberId, min - i));
    const res = (await pipe.exec()) ?? [];
    const secs = (res[0]?.[1] as Array<string | null> | undefined) ?? [];
    const perSecond = secs.map((v, i) => ({
      at: new Date((sec - 59 + i) * 1000).toISOString(),
      sent: Number(v ?? 0),
      deferred: 0,
      metaThrottled: 0,
    }));
    const perMinute: WabaThroughputSeriesPoint[] = [];
    for (let i = 0; i < 60; i++) {
      const h = (res[1 + i]?.[1] as Record<string, string> | undefined) ?? {};
      perMinute.push({
        at: new Date((min - 59 + i) * 60_000).toISOString(),
        sent: Number(h.sent ?? 0),
        deferred: Number(h.deferred ?? 0),
        metaThrottled: Number(h.throttled ?? 0),
      });
    }
    return { perSecond, perMinute };
  }

  /** One run of the sync at a time across every worker. True when this process holds the lock. */
  async tryLock(ttlMs: number): Promise<boolean> {
    return (await this.redis.set(govKeys.syncLock, '1', 'PX', ttlMs, 'NX')) === 'OK';
  }

  warn(msg: string, err: unknown): void {
    this.logger.warn({ err: err instanceof Error ? err.message : String(err) }, msg);
  }
}
