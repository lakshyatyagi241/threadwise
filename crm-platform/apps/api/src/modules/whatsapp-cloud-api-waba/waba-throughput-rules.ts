/**
 * Pure rules of the throughput console: what a stored number says about its limits, and the view the super admin page shows.
 * No database, no Redis, no clock of its own.
 */
import type {
  WabaNumberControl,
  WabaNumberThroughput,
  WabaThroughputSettings,
  WabaThroughputTotals,
} from '@crm/contracts';
import {
  parseThroughput,
  parseTier,
  resolveRate,
  tierState,
} from '../../infra/providers/whatsapp-cloud-api-waba/throughput/throughput-rules';
import type {
  NumberLive,
  PublishedNumber,
} from '../../infra/providers/whatsapp-cloud-api-waba/throughput/throughput-store';
import { isCoexistence } from './waba-rules';

type Meta = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const int = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null;

/** Where an operator's limits for one number live on its stored row: `meta_json.send_limits`. */
export const SEND_LIMITS_KEY = 'send_limits';

export interface StoredLimits {
  overrideMps: number | null;
  paused: boolean;
  pauseReason: string | null;
  updatedAt: string | null;
}

export function limitsOf(meta: Meta | null | undefined): StoredLimits {
  const raw = meta?.[SEND_LIMITS_KEY];
  const l = raw && typeof raw === 'object' ? (raw as Meta) : {};
  return {
    overrideMps: int(l.override_mps),
    paused: l.paused === true,
    pauseReason: str(l.pause_reason),
    updatedAt: str(l.updated_at),
  };
}

export const phoneNumberIdOf = (meta: Meta | null | undefined): string | null =>
  str(meta?.phone_number_id);

export const isCoexistenceMeta = (meta: Meta | null | undefined): boolean =>
  meta?.coexistence === true || isCoexistence(str(meta?.platform_type));

/** What the governor needs for a stored number: the rate, the pause and the tier. */
export function publishedOf(
  meta: Meta | null | undefined,
  s: WabaThroughputSettings,
): PublishedNumber {
  const l = limitsOf(meta);
  const t = parseThroughput(meta?.throughput);
  const rate = resolveRate({
    overrideMps: l.overrideMps,
    coexistence: isCoexistenceMeta(meta),
    metaMps: t.mps,
    defaultMps: s.defaultMps,
    safetyMarginPct: s.safetyMarginPct,
  });
  const tier = parseTier(meta?.messaging_limit_tier);
  return {
    mps: rate.mps,
    capMps: rate.capMps,
    source: rate.source,
    paused: l.paused,
    pauseReason: l.pauseReason,
    tierName: tier.name,
    tierCap: tier.cap ?? 0,
    tierUnlimited: tier.unlimited,
  };
}

export interface NumberRow {
  orgId: number;
  uuid: string;
  status: string;
  phone_number: string | null;
  display_label: string | null;
  meta_json: Meta | null;
  row_version: number;
  workspace: string;
}

const EMPTY_LIVE: NumberLive = {
  mpsNow: 0,
  peak1m: 0,
  sent5m: 0,
  waited5m: 0,
  waitMs5m: 0,
  deferred5m: 0,
  metaThrottled5m: 0,
  speedFactor: 1,
  paused: false,
};

/** One row of the console. `live` and `tierUsed` come from Redis; when it could not be read they are zero and the page says so. */
export function numberView(
  row: NumberRow,
  s: WabaThroughputSettings,
  live: NumberLive | undefined,
  tierUsed: number,
): WabaNumberThroughput {
  const meta = row.meta_json ?? {};
  const limits = limitsOf(meta);
  const control: WabaNumberControl = {
    overrideMps: limits.overrideMps,
    paused: limits.paused,
    pauseReason: limits.pauseReason,
    updatedAt: limits.updatedAt,
  };
  const pub = publishedOf(meta, s);
  const through = parseThroughput(meta.throughput);
  const tier = parseTier(meta.messaging_limit_tier);
  const st = tierState(tier, tierUsed, s.tierWarnPct);
  const l = live ?? EMPTY_LIVE;
  return {
    id: row.uuid,
    workspace: row.workspace,
    phoneNumberId: phoneNumberIdOf(meta) ?? '',
    displayPhoneNumber: str(meta.display_phone_number) ?? row.phone_number,
    label: row.display_label,
    status: row.status,
    qualityRating: str(meta.quality_rating),
    coexistence: isCoexistenceMeta(meta),
    metaLevel: through.level,
    metaMps: through.mps,
    effectiveMps: pub.mps,
    source: pub.source,
    control,
    tier: { name: tier.name, cap: tier.cap, used24h: tierUsed, pct: st.pct, state: st.state },
    live: {
      mpsNow: l.mpsNow,
      peak1m: l.peak1m,
      sent5m: l.sent5m,
      waited5m: l.waited5m,
      avgWaitMs5m: l.waited5m > 0 ? Math.round(l.waitMs5m / l.waited5m) : 0,
      deferred5m: l.deferred5m,
      metaThrottled5m: l.metaThrottled5m,
      speedFactor: l.speedFactor,
    },
    syncedAt: str(meta.throughput_synced_at),
    syncError: str(meta.throughput_sync_error),
    rowVersion: row.row_version,
  };
}

export function totalsOf(numbers: WabaNumberThroughput[]): WabaThroughputTotals {
  const t: WabaThroughputTotals = {
    numbers: numbers.length,
    paused: 0,
    throttled: 0,
    tierWarn: 0,
    mpsNow: 0,
    sent5m: 0,
    deferred5m: 0,
    metaThrottled5m: 0,
  };
  for (const n of numbers) {
    if (n.control.paused) t.paused++;
    if (n.live.speedFactor < 1 || n.live.metaThrottled5m > 0) t.throttled++;
    if (n.tier.state === 'warn' || n.tier.state === 'full') t.tierWarn++;
    t.mpsNow += n.live.mpsNow;
    t.sent5m += n.live.sent5m;
    t.deferred5m += n.live.deferred5m;
    t.metaThrottled5m += n.live.metaThrottled5m;
  }
  t.mpsNow = Math.round(t.mpsNow * 10) / 10;
  return t;
}

/** What a sync writes onto the stored number from what Meta reported. */
export function syncPatch(
  phone: {
    throughput: unknown;
    messagingLimitTier: string | null;
    qualityRating: string | null;
    platformType: string | null;
  },
  now: Date,
): Meta {
  return {
    throughput: phone.throughput ?? null,
    messaging_limit_tier: phone.messagingLimitTier,
    quality_rating: phone.qualityRating,
    platform_type: phone.platformType,
    throughput_synced_at: now.toISOString(),
    throughput_sync_error: null,
  };
}

/** True when this stored number is due to be re-read from Meta. */
export function syncDue(
  meta: Meta | null | undefined,
  intervalMinutes: number,
  now: Date,
): boolean {
  const at = str(meta?.throughput_synced_at);
  if (!at) return true;
  const t = Date.parse(at);
  return !Number.isFinite(t) || now.getTime() - t >= intervalMinutes * 60_000;
}
