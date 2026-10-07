import { describe, expect, it } from 'vitest';
import {
  NOTE_MAX,
  canChangeList,
  checkNote,
  navBadgeState,
  panelBanner,
  searchReady,
  toOptions,
  toRow,
} from './workspaces';

const row = {
  orgUuid: '0b7f6d1e-6a0e-4c52-9a4b-1c2d3e4f5a6b',
  name: 'Acme Trading',
  slug: 'acme',
  planSlug: 'pro',
  enabledAt: '2026-10-06T08:00:00.000Z',
  enabledBy: { operatorUuid: 'op-1', name: ' Sam Ops ' },
  note: 'pilot',
  deviceCount: 3,
  activeDeviceCount: 2,
};

describe('allow-list rows', () => {
  it('maps a row for display', () => {
    expect(toRow(row)).toEqual({
      orgUuid: row.orgUuid,
      name: 'Acme Trading',
      slug: 'acme',
      planSlug: 'pro',
      enabledAt: row.enabledAt,
      enabledByName: 'Sam Ops',
      note: 'pilot',
      deviceCount: 3,
      activeDeviceCount: 2,
    });
  });

  it('keeps a missing operator, plan and active count as null', () => {
    const r = toRow({ ...row, enabledBy: null, planSlug: null, activeDeviceCount: undefined });
    expect(r.enabledByName).toBeNull();
    expect(r.planSlug).toBeNull();
    expect(r.activeDeviceCount).toBeNull();
    expect(toRow({ ...row, enabledBy: {} }).enabledByName).toBeNull();
  });
});

describe('add-workspace search results', () => {
  it('an already allowed workspace cannot be added again', () => {
    const [a, b] = toOptions([
      {
        orgUuid: 'a',
        name: 'A',
        slug: 'a',
        planSlug: 'pro',
        ownerEmail: null,
        alreadyEnabled: false,
      },
      {
        orgUuid: 'b',
        name: 'B',
        slug: 'b',
        planSlug: null,
        ownerEmail: 'b@x.io',
        alreadyEnabled: true,
      },
    ]);
    expect(a?.canAdd).toBe(true);
    expect(b?.canAdd).toBe(false);
  });

  it('searches only from two characters', () => {
    expect(searchReady('')).toBe(false);
    expect(searchReady(' a ')).toBe(false);
    expect(searchReady('ac')).toBe(true);
  });
});

describe('the note', () => {
  it('is optional: blank is no note', () => {
    expect(checkNote('')).toEqual({ ok: true, value: undefined });
    expect(checkNote('   ')).toEqual({ ok: true, value: undefined });
  });
  it('is trimmed', () => {
    expect(checkNote('  pilot client ')).toEqual({ ok: true, value: 'pilot client' });
  });
  it('allows exactly 500 characters and refuses 501', () => {
    expect(checkNote('x'.repeat(NOTE_MAX)).ok).toBe(true);
    expect(checkNote('x'.repeat(NOTE_MAX + 1))).toEqual({ ok: false, error: 'tooLong' });
  });
});

describe('banner and badge states', () => {
  it('warns only when the switch is off and the list is not empty', () => {
    expect(panelBanner(false, 2)).toBe('engineOff');
    expect(panelBanner(false, 0)).toBeNull();
    expect(panelBanner(true, 2)).toBeNull();
    expect(panelBanner(true, 0)).toBeNull();
  });

  it('badge: Not supported while off, No workspaces when on with an empty list, none otherwise', () => {
    expect(navBadgeState(false, 0)).toBe('notSupported');
    expect(navBadgeState(false, 5)).toBe('notSupported');
    expect(navBadgeState(true, 0)).toBe('noWorkspaces');
    expect(navBadgeState(true, 1)).toBeNull();
  });

  it('only a super admin changes the list', () => {
    expect(canChangeList('super_admin')).toBe(true);
    expect(canChangeList('admin')).toBe(false);
  });
});
