import { describe, expect, it } from 'vitest';
import { PLAN_FEATURE_KEYS } from '@crm/contracts';
import { NAV } from '@/features/_registry/nav.generated';
import { SETTINGS } from '@/features/_registry/settings.generated';
import { HELP_DOCS } from '@/features/_registry/help.generated';
import { coverage } from './coverage';
import pendingFile from './pending.json';

/** Every built screen, Settings tile and plan feature has a guide, or an owned entry in pending.json. Fails the test run otherwise. */
describe('help coverage gate', () => {
  const report = coverage({
    nav: NAV,
    tiles: SETTINGS,
    docs: HELP_DOCS,
    planFeatureKeys: PLAN_FEATURE_KEYS,
    pending: pendingFile.pending as Parameters<typeof coverage>[0]['pending'],
  });

  it('has a guide or a pending entry for every unit', () => {
    expect(report.undocumented, 'add a guide or a pending.json entry').toEqual([]);
  });

  it('has no stale or malformed pending entries', () => {
    expect(report.stalePending).toEqual([]);
    expect(report.badPending).toEqual([]);
  });
});
