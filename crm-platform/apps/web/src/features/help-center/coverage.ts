import type { SettingsTile } from '@/features/_registry/settings-types';
import type { NavItem } from '@/features/_registry/types';
import type { HelpDoc } from './types';

export const OWNERS = ['lakshya', 'vedant', 'punya'] as const;

/** One line of `pending.json`: a built screen or plan feature that has no guide yet, who owns writing it, and why it waits. */
export interface PendingEntry {
  unit: string;
  owner: (typeof OWNERS)[number];
  reason: string;
}

export interface CoverageInput {
  nav: readonly NavItem[];
  tiles: readonly SettingsTile[];
  docs: readonly HelpDoc[];
  planFeatureKeys: readonly string[];
  pending: readonly PendingEntry[];
}

export interface CoverageReport {
  /** Units with no guide and no pending entry: what a change must not leave behind. */
  undocumented: string[];
  /** Pending entries that are documented now, or that name no unit at all: the list may only shrink honestly. */
  stalePending: string[];
  /** Pending entries with an unknown owner, a blank reason, or a duplicate. */
  badPending: string[];
}

/**
 * Everything that needs a guide: every declared menu entry (`nav:<id>`), every declared Settings tile (`tile:<id>`) and every
 * plan feature (`feature:<key>`). Screens that are only planned are not declared in a domain's `nav.ts`, so they are not here.
 */
export function unitsOf(
  nav: readonly NavItem[],
  tiles: readonly SettingsTile[],
  planFeatureKeys: readonly string[],
): string[] {
  return [
    ...new Set([
      ...nav.map((n) => `nav:${n.id}`),
      ...tiles.map((t) => `tile:${t.id}`),
      ...planFeatureKeys.map((k) => `feature:${k}`),
    ]),
  ].sort();
}

/**
 * A screen is covered when some guide lists it under `documents`. A plan feature is covered when a guide is gated on it, or when a
 * guide documents a screen whose own gates carry it (the screen's gate is the guide's gate).
 */
export function coverage(input: CoverageInput): CoverageReport {
  const units = new Set(unitsOf(input.nav, input.tiles, input.planFeatureKeys));
  const covered = new Set<string>();
  const gateOf = new Map<string, string | undefined>([
    ...input.nav.map((n): [string, string | undefined] => [`nav:${n.id}`, n.gates?.planFeature]),
    ...input.tiles.map((t): [string, string | undefined] => [`tile:${t.id}`, t.gates?.planFeature]),
  ]);
  for (const doc of input.docs) {
    for (const unit of doc.documents) {
      covered.add(unit);
      const feature = gateOf.get(unit);
      if (feature) covered.add(`feature:${feature}`);
    }
    if (doc.gates.planFeature) covered.add(`feature:${doc.gates.planFeature}`);
  }

  const pendingUnits = new Set(input.pending.map((p) => p.unit));
  const seen = new Set<string>();
  const bad: string[] = [];
  for (const p of input.pending) {
    const duplicate = seen.has(p.unit);
    seen.add(p.unit);
    if (!(OWNERS as readonly string[]).includes(p.owner) || p.reason.trim() === '' || duplicate) {
      bad.push(p.unit);
    }
  }

  return {
    undocumented: [...units].filter((u) => !covered.has(u) && !pendingUnits.has(u)),
    stalePending: [...pendingUnits].filter((u) => covered.has(u) || !units.has(u)),
    badPending: bad,
  };
}
