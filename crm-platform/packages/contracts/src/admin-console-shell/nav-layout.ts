import { z } from 'zod';

/**
 * The customer top-bar catalogue (WD-ASHELL-009/013). One list feeds the bar,
 * the More page and the operator editor, so the three can never disagree (WaDesk's
 * editor and header had different defaults; this port has one).
 */
export const NAV_LAYOUT_KEYS = [
  'dashboard',
  'team-inbox',
  'wa-campaigns',
  'flows',
  'templates',
  'devices',
  'metaads',
  'broadcasts',
  'contacts',
  'deals',
  'chat',
  'analytics',
  'auto-reply',
  'scheduled',
  'message-history',
  'ai-assistants',
  'ai-training',
  'wa-links',
  'chatbot-widgets',
  'webhooks',
  'integrations',
  'warmer',
  'call-logs',
  'support',
  'more',
] as const;
export type NavLayoutKey = (typeof NAV_LAYOUT_KEYS)[number];

/** The gateway entry: always in the bar, cannot be removed. */
export const NAV_LAYOUT_LOCKED_KEY: NavLayoutKey = 'more';

/** The bar of a fresh install, and what "reset" restores. */
export const NAV_LAYOUT_DEFAULT_BAR: readonly NavLayoutKey[] = [
  'dashboard',
  'team-inbox',
  'wa-campaigns',
  'flows',
  'templates',
  'devices',
  'more',
];

const KNOWN = new Set<string>(NAV_LAYOUT_KEYS);

/**
 * Keeps known keys once each in the order given, drops the rest, and appends
 * `more` if it is missing. An empty result falls back to the default bar.
 */
export function normalizeNavBar(input: readonly unknown[] | null | undefined): NavLayoutKey[] {
  const seen = new Set<string>();
  const bar: NavLayoutKey[] = [];
  for (const k of input ?? []) {
    if (typeof k === 'string' && KNOWN.has(k) && !seen.has(k)) {
      seen.add(k);
      bar.push(k as NavLayoutKey);
    }
  }
  const real = bar.filter((k) => k !== NAV_LAYOUT_LOCKED_KEY);
  if (real.length === 0) return [...NAV_LAYOUT_DEFAULT_BAR];
  if (!seen.has(NAV_LAYOUT_LOCKED_KEY)) bar.push(NAV_LAYOUT_LOCKED_KEY);
  return bar;
}

/**
 * Reads a stored value: the current `{ bar: [...] }` shape, or the legacy flat
 * list WaDesk wrote earlier (which only ever reordered the default bar keys).
 */
export function resolveNavBar(stored: unknown): NavLayoutKey[] {
  if (Array.isArray(stored)) {
    const defaults = new Set<string>(NAV_LAYOUT_DEFAULT_BAR);
    return normalizeNavBar(stored.filter((k) => typeof k === 'string' && defaults.has(k)));
  }
  if (stored && typeof stored === 'object' && Array.isArray((stored as { bar?: unknown }).bar)) {
    return normalizeNavBar((stored as { bar: unknown[] }).bar);
  }
  return [...NAV_LAYOUT_DEFAULT_BAR];
}

/** Every catalogue key not in the bar, in catalogue order (the "More" zone). */
export const navMoreZone = (bar: readonly string[]): NavLayoutKey[] =>
  NAV_LAYOUT_KEYS.filter((k) => !bar.includes(k));

/** Unknown keys are dropped, not rejected, like WaDesk; the response shows what was kept. */
export const saveNavLayoutRequestSchema = z.object({
  bar: z.array(z.string().max(64)).max(100),
});
export type SaveNavLayoutRequest = z.infer<typeof saveNavLayoutRequestSchema>;

export interface NavLayoutResponse {
  bar: NavLayoutKey[];
  more: NavLayoutKey[];
  isDefault: boolean;
}

export const navLayoutResponseSchema = z.object({
  bar: z.array(z.enum(NAV_LAYOUT_KEYS)),
  more: z.array(z.enum(NAV_LAYOUT_KEYS)),
  isDefault: z.boolean(),
});
