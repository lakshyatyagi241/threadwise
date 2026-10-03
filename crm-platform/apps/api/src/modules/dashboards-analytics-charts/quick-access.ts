import {
  QUICK_ACCESS_CATALOG,
  QUICK_ACCESS_DEFAULT_KEYS,
  QUICK_ACCESS_MAX,
  type QuickAccessItem,
  type QuickAccessTile,
} from '@crm/contracts';

const byKey = new Map<string, (typeof QUICK_ACCESS_CATALOG)[number]>(
  QUICK_ACCESS_CATALOG.map((c) => [c.key, c]),
);

/**
 * TW-DASH-009 rules 1 and 2: keep catalog keys, accept a custom link only with a label and a url that starts with "/" or http(s)://
 * (so `javascript:` dies), cut label to 40 and url to 255, cap at 10, drop everything else. No de-duplication (Reference's behaviour).
 */
export function sanitizeQuickAccess(input: unknown): QuickAccessItem[] {
  if (!Array.isArray(input)) return [];
  const out: QuickAccessItem[] = [];
  for (const e of input) {
    if (out.length >= QUICK_ACCESS_MAX) break;
    if (!e || typeof e !== 'object' || Array.isArray(e)) continue;
    const r = e as Record<string, unknown>;
    if (typeof r.key === 'string' && byKey.has(r.key)) {
      out.push({ key: r.key });
      continue;
    }
    const label = typeof r.label === 'string' ? r.label.trim() : '';
    const url = typeof r.url === 'string' ? r.url.trim() : '';
    if (!label || !url || !(url.startsWith('/') || /^https?:\/\//i.test(url))) continue;
    out.push({ label: label.slice(0, 40), url: url.slice(0, 255) });
  }
  return out;
}

/** Rule 3 quirk, kept: an empty saved list reads as "never customised". */
export function effectiveQuickAccess(stored: unknown): QuickAccessItem[] {
  const items = sanitizeQuickAccess(stored);
  return items.length > 0 ? items : QUICK_ACCESS_DEFAULT_KEYS.map((key) => ({ key }));
}

export function quickAccessTiles(items: QuickAccessItem[]): QuickAccessTile[] {
  return items.map((i) => {
    if ('key' in i) {
      const c = byKey.get(i.key)!;
      return { key: c.key, label: c.label, desc: c.desc, url: c.url, icon: c.icon, custom: false };
    }
    return {
      key: null,
      label: i.label,
      desc: `Open ${i.label}`,
      url: i.url,
      icon: 'link',
      custom: true,
    };
  });
}
