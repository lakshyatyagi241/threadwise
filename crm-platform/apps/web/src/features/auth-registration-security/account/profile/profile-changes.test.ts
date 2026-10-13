import type { ProfileResponse } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { profileChanges, savedMyZone, savedZone, type ProfileDraft } from './profile-changes';

const profile: ProfileResponse = {
  fullName: 'Asha Rao',
  displayName: 'Asha',
  email: 'asha@acme.test',
  emailVerified: true,
  pendingEmail: null,
  phone: '+919876543210',
  locale: 'en',
  timezone: null,
  effectiveTimezone: 'Asia/Calcutta',
  theme: 'paper',
  avatarUrl: null,
  workspaceTimezone: 'Asia/Calcutta',
  canEditWorkspaceTimezone: true,
};
const same: ProfileDraft = {
  fullName: 'Asha Rao',
  displayName: 'Asha',
  phone: '+919876543210',
  locale: 'en',
  theme: 'paper',
  zone: 'Asia/Kolkata',
  myZone: '',
};

describe('profileChanges', () => {
  it('is empty when nothing changed, even though the saved zone uses an old alias', () => {
    expect(savedZone(profile)).toBe('Asia/Kolkata');
    expect(profileChanges(profile, same)).toEqual({});
  });

  it('sends only what changed', () => {
    expect(profileChanges(profile, { ...same, fullName: '  Asha R. Rao ' })).toEqual({
      fullName: 'Asha R. Rao',
    });
    expect(profileChanges(profile, { ...same, theme: 'dark' })).toEqual({ theme: 'dark' });
    expect(profileChanges(profile, { ...same, zone: 'Asia/Dubai' })).toEqual({
      workspaceTimezone: 'Asia/Dubai',
    });
  });

  it('a blank display name clears it', () => {
    expect(profileChanges(profile, { ...same, displayName: '   ' })).toEqual({ displayName: null });
    expect(profileChanges({ ...profile, displayName: null }, { ...same, displayName: '' })).toEqual(
      {},
    );
  });

  it('clearing the phone sends null, a new number sends E.164', () => {
    expect(profileChanges(profile, { ...same, phone: null })).toEqual({ phone: null });
    expect(profileChanges(profile, { ...same, phone: '+971501234567' })).toEqual({
      phone: '+971501234567',
    });
    expect(profileChanges({ ...profile, phone: null }, { ...same, phone: null })).toEqual({});
  });

  it('a blank language goes back to the default (null)', () => {
    expect(profileChanges(profile, { ...same, locale: '' })).toEqual({ locale: null });
    expect(profileChanges({ ...profile, locale: null }, { ...same, locale: '' })).toEqual({});
    expect(profileChanges({ ...profile, locale: null }, { ...same, locale: 'ar' })).toEqual({
      locale: 'ar',
    });
  });

  it('never sends the workspace timezone for someone who cannot edit it', () => {
    const member = { ...profile, canEditWorkspaceTimezone: false };
    expect(profileChanges(member, { ...same, zone: 'Asia/Dubai' })).toEqual({});
  });

  it('does not send a blank workspace timezone', () => {
    expect(profileChanges({ ...profile, workspaceTimezone: null }, { ...same, zone: '' })).toEqual(
      {},
    );
  });

  it("sends the person's own zone, and null when they go back to the workspace's", () => {
    expect(profileChanges(profile, { ...same, myZone: 'America/New_York' })).toEqual({
      timezone: 'America/New_York',
    });
    const own = { ...profile, timezone: 'America/New_York' };
    expect(savedMyZone(own)).toBe('America/New_York');
    expect(profileChanges(own, { ...same, myZone: 'America/New_York' })).toEqual({});
    expect(profileChanges(own, { ...same, myZone: '' })).toEqual({ timezone: null });
    // The workspace zone and the person's own zone are separate settings.
    expect(
      profileChanges(profile, { ...same, zone: 'Asia/Dubai', myZone: 'Europe/London' }),
    ).toEqual({ workspaceTimezone: 'Asia/Dubai', timezone: 'Europe/London' });
  });
});
