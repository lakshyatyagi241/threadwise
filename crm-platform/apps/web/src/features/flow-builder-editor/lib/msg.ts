import { useCallback } from 'react';
import { useTranslations } from 'next-intl';

/**
 * A message as data: the key (relative to the `flb` namespace) and its ICU values. Helpers that run outside a component
 * (the Simple model's checks and import notes, the canvas operations) return these instead of English text; the component
 * that shows one resolves it with `useMsg()`. A value may itself be a `Msg` (a node's name inside a sentence).
 */
export type MsgValue = string | number | Msg;
export interface Msg {
  key: string;
  values?: Record<string, MsgValue>;
  /** Shown when the catalogue has no entry for `key` (a node type the web app has no text for yet). */
  fallback?: string;
}

export const msg = (key: string, values?: Record<string, MsgValue>, fallback?: string): Msg => ({
  key,
  ...(values ? { values } : {}),
  ...(fallback !== undefined ? { fallback } : {}),
});

/** The translator bound to the `flb` namespace, as next-intl hands it out (and as the tests build one). */
export interface Translate {
  (key: string, values?: Record<string, string | number>): string;
  has?: (key: string) => boolean;
}

/** Resolve a `Msg` (and any `Msg` inside its values) to text. */
export function renderMsg(t: Translate, m: Msg): string {
  const values: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(m.values ?? {}))
    values[k] = typeof v === 'object' ? renderMsg(t, v) : v;
  if (m.fallback !== undefined && t.has && !t.has(m.key)) return m.fallback;
  return t(m.key, values);
}

/** A resolver for the components: `const m = useMsg(); m(problem.message)`. */
export function useMsg(): (m: Msg) => string {
  const t = useTranslations('flb') as unknown as Translate;
  return useCallback((m: Msg) => renderMsg(t, m), [t]);
}

/** The `flb` translator itself, for the helpers that take one (`contract-text.ts`). */
export function useFlb(): Translate {
  return useTranslations('flb') as unknown as Translate;
}

/** The same list without repeats (two identical notes read as one). */
export function dedupeMsgs(list: readonly Msg[]): Msg[] {
  const seen = new Set<string>();
  return list.filter((m) => {
    const k = JSON.stringify(m);
    return seen.has(k) ? false : (seen.add(k), true);
  });
}
