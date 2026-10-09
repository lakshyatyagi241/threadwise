import {
  AI_TEXT_EXTRA_KEYS,
  AI_USAGE_WINDOW_DAYS,
  type AiTextExtraKey,
  type AiUsageWindow,
} from '@crm/contracts';

/**
 * Pure rules of the AI keys domain (WD-AIADM-002, 003, 009, 010, 017, 019, 025..027), kept free of the database so
 * each one can be tested alone.
 */

// --- stored extras ---------------------------------------------------------------------------------------------------

/** What `admin_ai_keys.extra_config` carries: the per-request output ceiling and extra model ids for the pickers. */
export interface ProviderExtras {
  maxTokens: number | null;
  models: string[];
  /** Organization ID / Project ID / Default voice ID, whichever the provider's card carries. Stored, never read. */
  text: Partial<Record<AiTextExtraKey, string>>;
}

/**
 * Reads `extra_config` without ever throwing: a hand-edited or legacy value that is not the expected shape reads as
 * "nothing set". WaDesk stored the ceiling as a string and read a non-numeric one as 0 (no cap); so does this.
 */
export function parseExtras(raw: string | null | undefined): ProviderExtras {
  const empty: ProviderExtras = { maxTokens: null, models: [], text: {} };
  if (!raw) return empty;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return empty;
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return empty;
  const obj = json as Record<string, unknown>;
  const n =
    typeof obj.max_tokens === 'string' ? Number.parseInt(obj.max_tokens, 10) : obj.max_tokens;
  const maxTokens = typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : null;
  const models = Array.isArray(obj.models)
    ? obj.models.filter((m): m is string => typeof m === 'string' && m.trim() !== '')
    : [];
  const text: ProviderExtras['text'] = {};
  for (const k of AI_TEXT_EXTRA_KEYS) {
    const v = obj[k];
    if (typeof v === 'string' && v !== '') text[k] = v;
  }
  return { maxTokens, models, text };
}

/**
 * The JSON to store after a save. Fields the request left out keep their stored value; `maxTokens` is only written
 * on a provider that has the field, and only a positive whole number is stored (null clears it).
 */
export function mergeExtras(
  stored: ProviderExtras,
  patch: { maxTokens?: number | null; extraModels?: string[]; textExtra?: string },
  supportsMaxTokens: boolean,
  textKey: AiTextExtraKey | null = null,
): { json: string; next: ProviderExtras } {
  const next: ProviderExtras = {
    maxTokens:
      supportsMaxTokens && patch.maxTokens !== undefined ? patch.maxTokens : stored.maxTokens,
    models:
      patch.extraModels !== undefined
        ? [...new Set(patch.extraModels.map((m) => m.trim()))]
        : stored.models,
    text: { ...stored.text },
  };
  if (textKey && patch.textExtra !== undefined) {
    if (patch.textExtra === '') delete next.text[textKey];
    else next.text[textKey] = patch.textExtra;
  }
  const out: Record<string, unknown> = {};
  if (next.maxTokens !== null) out.max_tokens = next.maxTokens;
  if (next.models.length > 0) out.models = next.models;
  for (const k of AI_TEXT_EXTRA_KEYS) if (next.text[k] !== undefined) out[k] = next.text[k];
  return { json: JSON.stringify(out), next };
}

/** The ceiling lowers a request, never raises it; no ceiling (or a non-positive one) leaves it alone. */
export function capRequestedTokens(requested: number, ceiling: number | null): number {
  return ceiling !== null && ceiling > 0 && ceiling < requested ? ceiling : requested;
}

// --- secrets ---------------------------------------------------------------------------------------------------------

/** The last four characters of a key, for "which key is saved" (a key shorter than eight is not shown at all). */
export function lastFour(key: string): string | null {
  return key.length >= 8 ? key.slice(-4) : null;
}

// --- entitlements ----------------------------------------------------------------------------------------------------

/** The slice of PlanEntitlementService's resolved entitlements these rules read. */
export interface EntitlementFacts {
  platformOwned: boolean;
  planKnown: boolean;
  overrides: { limits?: Record<string, unknown>; features?: Record<string, unknown> };
  planLimits: Record<string, unknown>;
  planFeatures: Record<string, unknown>;
}

export const BYOK_FEATURE = 'allow_byok_ai_keys';
export const AI_TOKEN_LIMIT = 'ai_token_limit_monthly';

/**
 * May this workspace's own key take precedence (WD-AIADM-010 rule 2)? The platform-owned workspace is never gated, a
 * per-workspace override wins outright, then the plan's flag (default off). Same order as the plan resolver; written
 * here because the plan registry does not list this flag yet (see the port map), so it cannot call it.
 * A workspace on a plan with no catalogue row is not locked (the plan domain's rule 4).
 */
export function byokAllowed(e: EntitlementFacts): boolean {
  if (e.platformOwned) return true;
  const override = e.overrides.features?.[BYOK_FEATURE];
  if (typeof override === 'boolean') return override;
  if (!e.planKnown) return true;
  const stored = e.planFeatures[BYOK_FEATURE];
  return typeof stored === 'boolean' ? stored : false;
}

/**
 * The monthly token cap on platform-key use, or null for none. Whole numbers; 0, absent and an override of -1 all mean
 * unlimited, as every cap in the plan registry does (WaDesk read null as unlimited and 0 as "blocked", a reading
 * nobody could have meant).
 */
export function monthlyTokenLimit(e: EntitlementFacts): number | null {
  if (e.platformOwned) return null;
  const override = e.overrides.limits?.[AI_TOKEN_LIMIT];
  if (typeof override === 'number' && Number.isInteger(override))
    return override > 0 ? override : null;
  if (!e.planKnown) return null;
  const stored = e.planLimits[AI_TOKEN_LIMIT];
  return typeof stored === 'number' && Number.isInteger(stored) && stored > 0 ? stored : null;
}

/** Which key a call takes: the workspace's own when allowed and present, else the platform's, else none. */
export function pickSource(
  allowByok: boolean,
  hasWorkspaceKey: boolean,
  hasPlatformKey: boolean,
): 'workspace' | 'admin' | 'none' {
  if (allowByok && hasWorkspaceKey) return 'workspace';
  return hasPlatformKey ? 'admin' : 'none';
}

// --- usage windows and figures ---------------------------------------------------------------------------------------

const DAY_MS = 86_400_000;

/** The first instant of a window: the UTC midnight `days - 1` days before today, so today is the last bucket. */
export function windowStart(window: AiUsageWindow, now: Date): Date {
  const days = AI_USAGE_WINDOW_DAYS[window];
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(today - (days - 1) * DAY_MS);
}

/** A resolved usage range: `from` inclusive, `until` exclusive, `days` UTC day buckets, `to` the last day. */
export interface UsageRange {
  window: AiUsageWindow | 'custom';
  from: Date;
  until: Date;
  days: number;
  to: string;
}

/** The range a query asks for: its custom from/to days when sent, else the preset window ending today. */
export function usageRange(
  query: { window: AiUsageWindow; from?: string | undefined; to?: string | undefined },
  now: Date,
): UsageRange {
  if (query.from !== undefined && query.to !== undefined) {
    const from = new Date(`${query.from}T00:00:00Z`);
    const until = new Date(Date.parse(`${query.to}T00:00:00Z`) + DAY_MS);
    return {
      window: 'custom',
      from,
      until,
      days: Math.round((until.getTime() - from.getTime()) / DAY_MS),
      to: query.to,
    };
  }
  const from = windowStart(query.window, now);
  const days = AI_USAGE_WINDOW_DAYS[query.window];
  const until = new Date(from.getTime() + days * DAY_MS);
  return {
    window: query.window,
    from,
    until,
    days,
    to: new Date(until.getTime() - DAY_MS).toISOString().slice(0, 10),
  };
}

/** The start of the calendar month (UTC) that `now` falls in: the cap counts from here. */
export function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** One point per day of the window, zero where nothing was spent. `rows` keys are `YYYY-MM-DD`. */
export function fillDaily(
  rows: ReadonlyArray<{ date: string; tokens: number }>,
  from: Date,
  days: number,
): Array<{ date: string; tokens: number }> {
  const byDate = new Map(rows.map((r) => [r.date, r.tokens]));
  return Array.from({ length: days }, (_, i) => {
    const date = new Date(from.getTime() + i * DAY_MS).toISOString().slice(0, 10);
    return { date, tokens: byDate.get(date) ?? 0 };
  });
}

/**
 * Blended dollars per 1,000 tokens, in millionths of a dollar so the sum is exact integer arithmetic. An ESTIMATE
 * only (WD-AIADM-019): input and output are not priced apart. WaDesk listed `grok` where the catalogue's slug is `xai`
 * (so xAI fell to the default); both are listed here.
 */
const MICRO_USD_PER_1K: Record<string, number> = {
  openai: 5000,
  anthropic: 6000,
  gemini: 1000,
  google: 1000,
  deepseek: 800,
  grok: 5000,
  xai: 5000,
  mistral: 2000,
};
const DEFAULT_MICRO_USD_PER_1K = 4000;

/** Estimated spend as a decimal string with two places, summed per provider at its blended rate. */
export function estimateCostUsd(rows: ReadonlyArray<{ provider: string; tokens: number }>): string {
  let micro = 0;
  for (const r of rows) {
    const rate = MICRO_USD_PER_1K[r.provider.toLowerCase()] ?? DEFAULT_MICRO_USD_PER_1K;
    micro += (r.tokens * rate) / 1000;
  }
  const cents = Math.round(micro / 10_000);
  return `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

/** The cap meter: used against the limit, the percentage clamped to 100, and whether it has been reached. */
export function capView(used: number, limit: number | null) {
  if (limit === null) return { used, limit, percent: 0, reached: false };
  return {
    used,
    limit,
    percent: Math.min(100, Math.round((used / limit) * 100)),
    reached: used >= limit,
  };
}

/** A token count off the wire: a whole number from 0 to the column's maximum. */
export function clampTokens(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(Math.floor(n), 2_147_483_647);
}
