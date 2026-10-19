import { describe, expect, it } from 'vitest';
import {
  deriveStateKey,
  newState,
  returnUrl,
  signState,
  signTicket,
  verifyState,
  verifyTicket,
} from '../../../src/modules/meeting-conferencing/conferencing-state';
import { snapshotOf } from '../../../src/modules/meeting-conferencing/conferencing-release.consumer';
import { problemOf } from '../../../src/modules/meeting-conferencing/meeting-conferencing.service';
import { VideoNotConnectedError } from '../../../src/modules/meeting-conferencing/conferencing-tokens.service';
import { ConferencingError } from '../../../src/infra/providers/meeting-conferencing';

const KEY = deriveStateKey(Buffer.alloc(32, 3).toString('base64'));
const OTHER = deriveStateKey(Buffer.alloc(32, 4).toString('base64'));
const NOW = 1_800_000_000_000;

describe('connect state and ticket', () => {
  it('round-trips a state and binds it to its provider', () => {
    const s = newState({ orgId: 4, userId: 9, provider: 'zoom', returnTo: '/settings/video-meetings' }, NOW);
    const out = verifyState(signState(s, KEY), KEY, NOW + 1000);
    expect(out).toMatchObject({ ok: true, value: { orgId: 4, userId: 9, provider: 'zoom' } });
  });

  it('refuses a forged, expired or foreign-key state', () => {
    const s = newState({ orgId: 4, userId: 9, provider: 'teams', returnTo: '/x' }, NOW);
    const token = signState(s, KEY);
    expect(verifyState(token, OTHER, NOW)).toEqual({ ok: false, reason: 'signature' });
    expect(verifyState(token, KEY, NOW + 11 * 60_000)).toEqual({ ok: false, reason: 'expired' });
    expect(verifyState('nonsense', KEY, NOW)).toEqual({ ok: false, reason: 'malformed' });
    const [payload] = token.split('.');
    expect(verifyState(`${payload}.AAAA`, KEY, NOW)).toEqual({ ok: false, reason: 'signature' });
  });

  it('a state is not a ticket and a ticket is not a state', () => {
    const s = signState(newState({ orgId: 1, userId: 2, provider: 'zoom', returnTo: '/' }, NOW), KEY);
    expect(verifyTicket(s, KEY, NOW).ok).toBe(false);
    const t = signTicket(
      { orgId: 1, userId: 2, provider: 'zoom', returnTo: '/', sealedCode: 'sealed', expiresAt: NOW + 5000 },
      KEY,
    );
    expect(verifyState(t, KEY, NOW).ok).toBe(false);
    expect(verifyTicket(t, KEY, NOW)).toMatchObject({ ok: true, value: { userId: 2, sealedCode: 'sealed' } });
  });

  it('returns only to a path inside the app', () => {
    expect(returnUrl('https://app.example/', '/settings/video-meetings', { video: 'confirm' })).toBe(
      'https://app.example/settings/video-meetings?video=confirm',
    );
    expect(returnUrl('https://app.example', '//evil.example', { video: 'failed' })).toBe(
      'https://app.example/settings/video-meetings?video=failed',
    );
    expect(returnUrl('https://app.example', 'https://evil.example', { video: 'failed' })).toBe(
      'https://app.example/settings/video-meetings?video=failed',
    );
  });
});

describe('release payload', () => {
  it('shapes what the outbox carries and ignores anything malformed', () => {
    expect(
      snapshotOf({
        hostUserId: 5,
        video: { provider: 'zoom', id: '123' },
        calendar: { provider: 'google', calendarId: 'primary', eventId: 'e1' },
      }),
    ).toEqual({
      hostUserId: 5,
      video: { provider: 'zoom', id: '123' },
      calendar: { provider: 'google', calendarId: 'primary', eventId: 'e1' },
    });
    expect(snapshotOf({ video: { provider: 'skype', id: '1' }, calendar: null })).toBeNull();
    expect(snapshotOf({ video: { provider: 'teams', id: '' } })).toBeNull();
    expect(snapshotOf({})).toBeNull();
  });
});

describe('problem codes', () => {
  it('names a failure the way the meeting shows it', () => {
    expect(problemOf(new VideoNotConnectedError('none'))).toBe('not_connected');
    expect(problemOf(new VideoNotConnectedError('needs_reconnect'))).toBe('needs_reconnect');
    expect(problemOf(new VideoNotConnectedError('scope_missing'))).toBe('needs_reconnect');
    expect(problemOf(new VideoNotConnectedError('not_configured'))).toBe('not_configured');
    expect(problemOf(new ConferencingError('invalid_client', 401, 'x'))).toBe('not_configured');
    expect(problemOf(new ConferencingError('server', 500, 'x'))).toBe('provider_failed');
    expect(problemOf(new Error('boom'))).toBe('provider_failed');
  });
});
