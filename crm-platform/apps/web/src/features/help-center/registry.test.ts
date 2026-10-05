import { describe, expect, it } from 'vitest';
import { isPlanFeatureKey } from '@crm/contracts';
import { HELP_DOCS } from '@/features/_registry/help.generated';
import { NAV } from '@/features/_registry/nav.generated';
import { SETTINGS } from '@/features/_registry/settings.generated';

/** Checks the generator cannot make: documents point at real screens, plan keys are real, areas match their screen. */
describe('help registry', () => {
  const live = new Map<string, string>([
    ...NAV.map((n): [string, string] => [`nav:${n.id}`, n.group]),
    ...SETTINGS.map((t): [string, string] => [`tile:${t.id}`, 'settings']),
  ]);

  it('every documents entry names a declared screen (a planned one only counts once a domain declares it)', () => {
    const bad = HELP_DOCS.flatMap((d) =>
      d.documents.filter((ref) => !live.has(ref)).map((ref) => `${d.id} -> ${ref}`),
    );
    expect(bad).toEqual([]);
  });

  it('every planFeature gate is a real plan feature key', () => {
    const bad = HELP_DOCS.flatMap((d) =>
      [d.gates.planFeature]
        .filter((k): k is string => Boolean(k) && !isPlanFeatureKey(k!))
        .map((k) => `${d.id}: ${k}`),
    );
    expect(bad).toEqual([]);
  });

  it("a guide on a menu screen sits in that screen's menu group, or in a help-only area", () => {
    const helpOnly = new Set(['settings', 'account', 'getting-started']);
    const bad = HELP_DOCS.flatMap((d) => {
      if (d.documents.length !== 1 || !d.documents[0]!.startsWith('nav:')) return [];
      const group = live.get(d.documents[0]!);
      return group && group !== d.area && !helpOnly.has(d.area)
        ? [`${d.id}: ${d.area} vs ${group}`]
        : [];
    });
    expect(bad).toEqual([]);
  });

  it('a guide with no screen and no plan feature is a getting-started guide', () => {
    const bad = HELP_DOCS.filter(
      (d) => d.documents.length === 0 && !d.gates.planFeature && d.area !== 'getting-started',
    ).map((d) => d.id);
    expect(bad).toEqual([]);
  });
});
