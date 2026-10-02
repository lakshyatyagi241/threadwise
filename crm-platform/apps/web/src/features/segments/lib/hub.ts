import type { Segment } from '../api/schemas';
import type { HubParams } from './url';

/** The hub's list: search, the Mine / Shared filter, newest change first, and the page window. All pure. */

export function filterSegments(
  rows: readonly Segment[],
  params: Pick<HubParams, 'q' | 'show'>,
  meId: string | null,
): Segment[] {
  const needle = params.q.trim().toLocaleLowerCase();
  return rows
    .filter((s) => {
      if (params.show === 'mine' && s.ownerId !== meId) return false;
      if (params.show === 'shared' && s.visibility !== 'shared') return false;
      if (!needle) return true;
      return `${s.name} ${s.description ?? ''} ${s.ownerName ?? ''}`
        .toLocaleLowerCase()
        .includes(needle);
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name));
}

export interface PageWindow<T> {
  items: T[];
  /** The page actually shown, 1-based: a page past the end lands on the last one. */
  page: number;
  pages: number;
  /** 1-based range of the rows shown, 0 when there are none. */
  from: number;
  to: number;
  total: number;
}

export function pageWindow<T>(rows: readonly T[], page: number, per: number): PageWindow<T> {
  const pages = Math.max(1, Math.ceil(rows.length / per));
  const at = Math.min(Math.max(1, Math.trunc(page) || 1), pages);
  const items = rows.slice((at - 1) * per, at * per);
  return {
    items,
    page: at,
    pages,
    from: items.length === 0 ? 0 : (at - 1) * per + 1,
    to: items.length === 0 ? 0 : (at - 1) * per + items.length,
    total: rows.length,
  };
}

export type CountState =
  { kind: 'unknown' } | { kind: 'exact'; count: number } | { kind: 'approximate'; count: number };

/** How a member count reads: "-" until counted, "N", or "about N" when the server could only estimate. */
export function countState(s: Pick<Segment, 'memberCount' | 'countApproximate'>): CountState {
  if (s.memberCount === null) return { kind: 'unknown' };
  return s.countApproximate
    ? { kind: 'approximate', count: s.memberCount }
    : { kind: 'exact', count: s.memberCount };
}

/** A segment whose rules point at something deleted matches less than it says: the hub flags it. */
export const needsAttention = (s: Pick<Segment, 'invalidConditions'>): boolean =>
  s.invalidConditions.length > 0;

/** A free name for a duplicate: "X (copy)", then "X (copy 2)"..., within the name limit (names are unique ignoring case). */
export function copyName(name: string, taken: Iterable<string>, max: number): string {
  const used = new Set([...taken].map((n) => n.toLocaleLowerCase()));
  for (let i = 1; i < 1000; i++) {
    const suffix = i === 1 ? ' (copy)' : ` (copy ${i})`;
    const candidate = `${name.slice(0, Math.max(1, max - suffix.length))}${suffix}`;
    if (!used.has(candidate.toLocaleLowerCase())) return candidate;
  }
  return `${name.slice(0, max - 6)} ${Date.now() % 100000}`;
}
