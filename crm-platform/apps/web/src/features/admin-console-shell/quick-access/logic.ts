import {
  QUICK_ACCESS_MAX,
  isSafeShortcutUrl,
  type QuickAccessEntry,
  type QuickAccessTile,
} from '@crm/contracts';

export interface Draft {
  keys: string[];
  custom: Array<{ label: string; url: string }>;
}

/** The editor starts from what is pinned now: catalogue pages by key, own links as label and address. */
export function draftFromTiles(tiles: readonly QuickAccessTile[]): Draft {
  return {
    keys: tiles.filter((t) => !t.custom && t.key).map((t) => t.key!),
    custom: tiles.filter((t) => t.custom).map((t) => ({ label: t.label, url: t.url })),
  };
}

export const pinnedCount = (d: Draft): number =>
  d.keys.length + d.custom.filter((c) => c.label.trim() && c.url.trim()).length;

/** Pinning past ten is refused (Reference toast "You can pin up to 10 shortcuts."); unpinning is always allowed. */
export function toggleKey(d: Draft, key: string): { draft: Draft; refused: boolean } {
  if (d.keys.includes(key))
    return { draft: { ...d, keys: d.keys.filter((k) => k !== key) }, refused: false };
  if (pinnedCount(d) >= QUICK_ACCESS_MAX) return { draft: d, refused: true };
  return { draft: { ...d, keys: [...d.keys, key] }, refused: false };
}

export function addCustom(d: Draft): { draft: Draft; refused: boolean } {
  if (pinnedCount(d) >= QUICK_ACCESS_MAX) return { draft: d, refused: true };
  return { draft: { ...d, custom: [...d.custom, { label: '', url: '' }] }, refused: false };
}

/** The request body: pinned pages first, then the own links that have both a label and a safe address. */
export function toItems(d: Draft): QuickAccessEntry[] {
  return [
    ...d.keys.map((key) => ({ key })),
    ...d.custom
      .map((c) => ({ label: c.label.trim(), url: c.url.trim() }))
      .filter((c) => c.label && c.url && isSafeShortcutUrl(c.url)),
  ].slice(0, QUICK_ACCESS_MAX);
}

/** True when a custom row has text the server would drop (unsafe or half filled), so the editor can say so before saving. */
export const customRowProblem = (c: {
  label: string;
  url: string;
}): 'incomplete' | 'unsafe' | null => {
  if (!c.label.trim() && !c.url.trim()) return null;
  if (!c.label.trim() || !c.url.trim()) return 'incomplete';
  return isSafeShortcutUrl(c.url.trim()) ? null : 'unsafe';
};

export const HANDLE_KEY = 'qadHandleTop';
export const HANDLE_DEFAULT_TOP = 120;

/** The edge handle's distance from the top: 8 pixels at least, and 60 pixels clear of the bottom edge. */
export function clampHandleTop(top: number, viewportHeight: number): number {
  const max = Math.max(8, viewportHeight - 60);
  if (!Number.isFinite(top)) return HANDLE_DEFAULT_TOP;
  return Math.min(Math.max(top, 8), max);
}
