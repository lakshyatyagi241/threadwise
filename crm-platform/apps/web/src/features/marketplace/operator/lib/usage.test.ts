import { describe, expect, it } from 'vitest';
import { ID, usageRow } from '../test-fixtures';
import { sortUsage, usageFlags, usageTotals } from './usage';

const counts = (failed: number) => ({ accepted: 5, duplicate: 0, rejected: 0, failed });

describe('usageFlags: "Needs a look"', () => {
  it('a quiet app is not flagged', () => {
    const f = usageFlags(usageRow());
    expect(f).toEqual({
      needsLook: false,
      reasons: [],
      brokenInstalls: 0,
      recipeMayBeBreaking: false,
    });
  });

  it('an installation in error flags the row', () => {
    const f = usageFlags(
      usageRow({ health: { healthy: 1, degraded: 0, error: 2, needsReauth: 0, unknown: 0 } }),
    );
    expect(f.needsLook).toBe(true);
    expect(f.reasons).toEqual(['installErrors']);
    expect(f.brokenInstalls).toBe(2);
  });

  it('an installation that needs to sign in again flags the row', () => {
    const f = usageFlags(
      usageRow({ health: { healthy: 1, degraded: 0, error: 0, needsReauth: 1, unknown: 0 } }),
    );
    expect(f.reasons).toEqual(['needsReauth']);
    expect(f.brokenInstalls).toBe(1);
  });

  it('degraded and unknown installations alone are not a flag', () => {
    expect(
      usageFlags(
        usageRow({ health: { healthy: 0, degraded: 3, error: 0, needsReauth: 0, unknown: 2 } }),
      ).needsLook,
    ).toBe(false);
  });

  it('any failed delivery flags the row, in either window', () => {
    expect(
      usageFlags(usageRow({ events: { last24h: counts(1), last7d: counts(1) } })).reasons,
    ).toEqual(['failed24h', 'failed7d']);
    expect(
      usageFlags(usageRow({ events: { last24h: counts(0), last7d: counts(4) } })).reasons,
    ).toEqual(['failed7d']);
  });

  it('rejected deliveries alone are not failures', () => {
    const e = { accepted: 1, duplicate: 1, rejected: 9, failed: 0 };
    expect(usageFlags(usageRow({ events: { last24h: e, last7d: e } })).needsLook).toBe(false);
  });

  it('the recipe hint is for integrations only (a mini app has no recipe)', () => {
    const failing = { events: { last24h: counts(2), last7d: counts(2) } };
    expect(usageFlags(usageRow({ ...failing, kind: 'integration' })).recipeMayBeBreaking).toBe(
      true,
    );
    expect(usageFlags(usageRow({ ...failing, kind: 'mini_app' })).recipeMayBeBreaking).toBe(false);
    expect(usageFlags(usageRow({ kind: 'integration' })).recipeMayBeBreaking).toBe(false);
  });
});

describe('sortUsage', () => {
  const rows = [
    usageRow({
      appId: ID(1),
      slug: 'b-app',
      name: 'Beta',
      installs: { active: 1, disabled: 0, killed: 0, total: 1 },
      events: { last24h: counts(0), last7d: counts(3) },
    }),
    usageRow({
      appId: ID(2),
      slug: 'a-app',
      name: 'alpha',
      installs: { active: 9, disabled: 0, killed: 0, total: 9 },
      events: { last24h: counts(0), last7d: counts(0) },
    }),
    usageRow({
      appId: ID(3),
      slug: 'c-app',
      name: 'Charlie',
      installs: { active: 4, disabled: 0, killed: 0, total: 4 },
      events: { last24h: counts(2), last7d: counts(3) },
    }),
  ];

  it('by name, A to Z, ignoring case', () => {
    expect(sortUsage(rows, 'name').map((r) => r.slug)).toEqual(['a-app', 'b-app', 'c-app']);
  });

  it('by installations, most first', () => {
    expect(sortUsage(rows, 'installs').map((r) => r.slug)).toEqual(['a-app', 'c-app', 'b-app']);
  });

  it('by failed deliveries, most in 7 days first, then in 24 hours, then by name', () => {
    expect(sortUsage(rows, 'failed').map((r) => r.slug)).toEqual(['c-app', 'b-app', 'a-app']);
  });

  it('does not change the list it was given', () => {
    const copy = [...rows];
    sortUsage(rows, 'name');
    expect(rows).toEqual(copy);
  });
});

describe('usageTotals', () => {
  it('adds up the apps, installations, flagged apps and failed deliveries', () => {
    const rows = [
      usageRow({ appId: ID(1) }),
      usageRow({ appId: ID(2), events: { last24h: counts(1), last7d: counts(5) } }),
      usageRow({
        appId: ID(3),
        health: { healthy: 0, degraded: 0, error: 1, needsReauth: 0, unknown: 0 },
      }),
    ];
    expect(usageTotals(rows)).toEqual({
      apps: 3,
      installs: 12,
      activeInstalls: 9,
      needsLook: 2,
      failed7d: 5,
    });
    expect(usageTotals([])).toEqual({
      apps: 0,
      installs: 0,
      activeInstalls: 0,
      needsLook: 0,
      failed7d: 0,
    });
  });
});
