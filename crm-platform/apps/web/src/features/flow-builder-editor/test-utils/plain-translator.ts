import { loadMessages } from '@/i18n/messages';
import type { Translate } from '../lib/msg';

const flb = (loadMessages('en') as unknown as { flb: Record<string, unknown> }).flb;

const lookup = (key: string): string | undefined => {
  let cur: unknown = flb;
  for (const part of key.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === 'string' ? cur : undefined;
};

/**
 * A `flb` translator that does not go through next-intl, for the tests that replace `next-intl` with a mock: it returns the
 * real English text and fills plain `{name}` placeholders (no plural / select).
 */
export const plainFlbTranslator: Translate = Object.assign(
  (key: string, values: Record<string, string | number> = {}) =>
    (lookup(key) ?? key).replace(/\{(\w+)\}/g, (m, k: string) =>
      k in values ? String(values[k]) : m,
    ),
  { has: (key: string) => lookup(key) !== undefined },
);
