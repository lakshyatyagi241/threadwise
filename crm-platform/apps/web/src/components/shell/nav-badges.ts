'use client';

import { createContext, useContext } from 'react';
import type { NavCounterKey, ResolvedNavItem } from '@/features/_registry/types';

/**
 * Live numbers on menu entries (the Inbox's unread conversations). A domain that owns a number provides it through this context,
 * keyed by the `counter` its `nav.ts` entry names; the shell only draws it. No provider (or a number not known yet) means no
 * badge, so a menu entry never shows a wrong zero.
 */
export type NavCounts = Readonly<Partial<Record<NavCounterKey, number>>>;

export const NavCountsContext = createContext<NavCounts>({});

export function useNavCounts(): NavCounts {
  return useContext(NavCountsContext);
}

/** "99+" past 99; nothing at 0, below it, or when the number is not a finite count. */
export function countBadge(count: number | undefined): string | null {
  if (count === undefined || !Number.isFinite(count) || count <= 0) return null;
  const whole = Math.floor(count);
  if (whole <= 0) return null;
  return whole > 99 ? '99+' : String(whole);
}

/** The number an entry shows (0 when it has no counter or the number is unknown). */
export function itemCount(
  item: { counter?: ResolvedNavItem['counter'] },
  counts: NavCounts,
): number {
  const value = item.counter ? counts[item.counter] : undefined;
  return value !== undefined && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** The number a group's single icon shows: the sum of its entries' counters, so a collapsed group still tells you something waits. */
export function groupCount(
  items: ReadonlyArray<Pick<ResolvedNavItem, 'counter' | 'comingSoon' | 'locked'>>,
  counts: NavCounts,
): number {
  return items.reduce(
    (sum, item) => sum + (item.comingSoon || item.locked ? 0 : itemCount(item, counts)),
    0,
  );
}
