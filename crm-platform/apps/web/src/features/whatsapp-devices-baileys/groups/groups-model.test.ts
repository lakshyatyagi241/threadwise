import { describe, expect, it } from 'vitest';
import type { PersonalDevice, WaDeviceGroup } from '@crm/contracts';
import {
  checkPicture,
  clock,
  draftOf,
  editPatch,
  isOnline,
  numbersOk,
  offlineReason,
  parseNumbers,
  pickDevice,
  rowAccess,
  rowBadges,
  secondsUntil,
  summarizeResults,
  toggleSelected,
} from './groups-model';

const dev = (id: string, state: PersonalDevice['connectionState']) =>
  ({ id, connectionState: state }) as PersonalDevice;

const group = (over: Partial<WaDeviceGroup> = {}): WaDeviceGroup =>
  ({
    id: 'g1',
    subject: 'VIP',
    description: 'Hello',
    announce: false,
    restrict: false,
    joinApproval: false,
    memberAddMode: 'all_member_add',
    isAdmin: true,
    left: false,
    ...over,
  }) as WaDeviceGroup;

const ALL = { create: true, manage: true, leave: true };

describe('which number the page shows', () => {
  const a = dev('a', 'disconnected');
  const b = dev('b', 'connected');
  it('takes the one named in ?device=, else the first connected one, else the first', () => {
    expect(pickDevice([a, b], 'a')?.id).toBe('a');
    expect(pickDevice([a, b], undefined)?.id).toBe('b');
    expect(pickDevice([a, b], 'nope')?.id).toBe('b');
    expect(pickDevice([a], undefined)?.id).toBe('a');
    expect(pickDevice([], 'a')).toBeNull();
  });
  it('is online only while connected', () => {
    expect(isOnline(b)).toBe(true);
    expect(isOnline(a)).toBe(false);
  });
  it('reads the state endpoint into the two offline notes', () => {
    expect(offlineReason(undefined)).toBeNull();
    expect(offlineReason({ connected: true, reason: 'ready' })).toBeNull();
    expect(offlineReason({ connected: false, reason: 'not_connected' })).toBe('not_connected');
    expect(offlineReason({ connected: false, reason: 'worker_unavailable' })).toBe(
      'worker_unavailable',
    );
  });
});

describe('phone numbers typed into a form', () => {
  const SELF = '+917690059356';
  it('reads one per line or comma separated, with spaces and dashes, into E.164', () => {
    const p = parseNumbers('+91 98765-43210\n+1 (415) 555-2671, 0044 20 7946 0958', SELF);
    expect(p.valid).toEqual(['+919876543210', '+14155552671', '+442079460958']);
    expect(p.invalid).toEqual([]);
    expect(numbersOk(p)).toBe(true);
  });
  it('reports what is not a phone number, and does not accept the list until it is fixed', () => {
    const p = parseNumbers('+919876543210\nabc\n12', SELF);
    expect(p.valid).toEqual(['+919876543210']);
    expect(p.invalid).toEqual(['abc', '12']);
    expect(numbersOk(p)).toBe(false);
  });
  it('drops repeats and this number itself, and says so', () => {
    const p = parseNumbers(`+919876543210\n+919876543210\n${SELF}`, SELF);
    expect(p.valid).toEqual(['+919876543210']);
    expect(p.duplicates).toBe(1);
    expect(p.includesSelf).toBe(true);
  });
  it('refuses more than 20 in one call', () => {
    const many = Array.from({ length: 21 }, (_, i) => `+9198765${String(10000 + i)}`).join('\n');
    const p = parseNumbers(many, SELF);
    expect(p.valid).toHaveLength(21);
    expect(p.overCap).toBe(true);
    expect(numbersOk(p)).toBe(false);
    const ok = parseNumbers(many.split('\n').slice(0, 20).join('\n'), SELF);
    expect(ok.overCap).toBe(false);
    expect(numbersOk(ok)).toBe(true);
  });
  it('needs at least one number', () => {
    expect(numbersOk(parseNumbers('', SELF))).toBe(false);
    expect(numbersOk(parseNumbers('  \n ', SELF))).toBe(false);
  });
});

describe('the outcome of a call', () => {
  it('counts the people done and lists the others by reason', () => {
    const s = summarizeResults([
      { number: '+1', outcome: 'ok', code: '200' },
      { number: '+2', outcome: 'privacy_blocked', code: '403' },
      { number: '+3', outcome: 'privacy_blocked', code: '403' },
      { number: '+4', outcome: 'not_on_whatsapp', code: '404' },
    ]);
    expect(s.ok).toBe(1);
    expect(s.failed.map((r) => r.number)).toEqual(['+2', '+3', '+4']);
    expect(s.byOutcome).toEqual({ privacy_blocked: 2, not_on_whatsapp: 1 });
  });
});

describe('ticking members', () => {
  it('toggles and never goes past the cap', () => {
    expect(toggleSelected([], 'a')).toEqual(['a']);
    expect(toggleSelected(['a'], 'a')).toEqual([]);
    expect(toggleSelected(['a', 'b'], 'c', 2)).toEqual(['a', 'b']);
    const twenty = Array.from({ length: 20 }, (_, i) => `n${i}`);
    expect(toggleSelected(twenty, 'extra')).toEqual(twenty);
  });
});

describe('editing a group', () => {
  it('sends only the fields that changed, trimmed', () => {
    const g = group();
    expect(editPatch(g, draftOf(g))).toBeNull();
    expect(editPatch(g, { ...draftOf(g), subject: '  New  ' })).toEqual({ subject: 'New' });
    expect(editPatch(g, { ...draftOf(g), announce: true, memberAddMode: 'admin_add' })).toEqual({
      announce: true,
      memberAddMode: 'admin_add',
    });
    expect(editPatch(g, { ...draftOf(g), description: '' })).toEqual({ description: '' });
  });
  it('does not save a blank name', () => {
    const g = group();
    expect(editPatch(g, { ...draftOf(g), subject: '   ' })).toBeNull();
  });
  it('treats a missing subject and description as empty', () => {
    const g = group({ subject: null, description: null });
    expect(draftOf(g).subject).toBe('');
    expect(editPatch(g, { ...draftOf(g), subject: 'A' })).toEqual({ subject: 'A' });
  });
});

describe('what a row offers', () => {
  it('a manager of an admin group on an online number may change it, see members and leave', () => {
    const a = rowAccess(group(), ALL, true);
    expect(a.canAdminister).toBe(true);
    expect(a.canSeeMembers).toBe(true);
    expect(a.canLeave).toBe(true);
    expect(a.blockedBy).toBeNull();
  });
  it('is read-only for a number that is not an admin: the reason is not-admin, members still readable', () => {
    const a = rowAccess(group({ isAdmin: false }), ALL, true);
    expect(a.canAdminister).toBe(false);
    expect(a.blockedBy).toBe('notAdmin');
    expect(a.canSeeMembers).toBe(true);
    expect(a.canLeave).toBe(true);
  });
  it('is read-only for a group the number left, whatever the role', () => {
    const a = rowAccess(group({ left: true }), ALL, true);
    expect(a.canAdminister).toBe(false);
    expect(a.canLeave).toBe(false);
    expect(a.blockedBy).toBe('left');
  });
  it('is read-only while the number is offline', () => {
    const a = rowAccess(group(), ALL, false);
    expect(a.canAdminister).toBe(false);
    expect(a.canLeave).toBe(false);
    expect(a.blockedBy).toBe('offline');
  });
  it('follows the permissions: read only means no change, no members, no leave', () => {
    const a = rowAccess(group(), { create: false, manage: false, leave: false }, true);
    expect(a.canAdminister).toBe(false);
    expect(a.canSeeMembers).toBe(false);
    expect(a.canLeave).toBe(false);
    const b = rowAccess(group(), { create: false, manage: false, leave: true }, true);
    expect(b.canLeave).toBe(true);
  });
  it('draws the badges in order', () => {
    expect(rowBadges(group())).toEqual(['admin']);
    expect(rowBadges(group({ isAdmin: false }))).toEqual(['notAdmin']);
    expect(
      rowBadges(group({ left: true, announce: true, restrict: true, joinApproval: true })),
    ).toEqual(['left', 'announce', 'restrict', 'approval']);
  });
});

describe('the picture', () => {
  const MB5 = 5 * 1024 * 1024;
  it('accepts JPEG and PNG up to 5 MB only', () => {
    const types = ['image/jpeg', 'image/png'];
    expect(checkPicture({ type: 'image/png', size: 1000 }, MB5, types)).toBe('ok');
    expect(checkPicture({ type: 'image/jpeg', size: MB5 }, MB5, types)).toBe('ok');
    expect(checkPicture({ type: 'image/jpeg', size: MB5 + 1 }, MB5, types)).toBe('size');
    expect(checkPicture({ type: 'image/gif', size: 10 }, MB5, types)).toBe('type');
    expect(checkPicture({ type: 'application/pdf', size: 10 }, MB5, types)).toBe('type');
  });
});

describe('the rate limit countdown', () => {
  it('shows minutes and seconds', () => {
    expect(clock(65)).toBe('1:05');
    expect(clock(9)).toBe('0:09');
    expect(clock(600)).toBe('10:00');
    expect(clock(0)).toBe('0:00');
    expect(clock(-5)).toBe('0:00');
    expect(clock(8.2)).toBe('0:09');
  });
  it('counts the seconds until a time, never below zero, and is null without one', () => {
    const now = Date.parse('2026-10-12T10:00:00.000Z');
    expect(secondsUntil('2026-10-12T10:01:05.000Z', now)).toBe(65);
    expect(secondsUntil('2026-10-12T09:00:00.000Z', now)).toBe(0);
    expect(secondsUntil(null, now)).toBeNull();
    expect(secondsUntil('garbage', now)).toBeNull();
  });
});
