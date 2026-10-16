import { describe, expect, it } from 'vitest';
import {
  GRAPH_SUBSCRIPTION_MINUTES,
  actionOf,
  clientStateOf,
  deriveClientStateKey,
  isPublicHttpsUrl,
  notificationsOf,
  renewalDue,
  verifyClientState,
} from '../../../src/modules/channel-email/graph-push-rules';

const key = deriveClientStateKey(Buffer.alloc(32, 9).toString('base64'));
const other = deriveClientStateKey(Buffer.alloc(32, 8).toString('base64'));
const UUID = '0b6f0c0e-7a54-4e3b-9d6e-0a1b2c3d4e5f';

describe('clientState (the secret Graph hands back with every notification)', () => {
  it('round-trips and names the workspace and the mailbox', () => {
    const state = clientStateOf(key, 42, UUID);
    expect(state.length).toBeLessThanOrEqual(128);
    expect(verifyClientState(key, state)).toEqual({ orgId: 42, mailboxUuid: UUID });
  });
  it('rejects a forged, altered or foreign-key state', () => {
    const state = clientStateOf(key, 42, UUID);
    expect(verifyClientState(other, state)).toBeNull();
    expect(verifyClientState(key, state.replace(/^42\./, '43.'))).toBeNull();
    expect(verifyClientState(key, `${state.slice(0, -2)}xx`)).toBeNull();
    expect(verifyClientState(key, 'guess')).toBeNull();
    expect(verifyClientState(key, '')).toBeNull();
    expect(verifyClientState(key, null)).toBeNull();
    expect(verifyClientState(key, undefined)).toBeNull();
  });
});

describe('notificationsOf', () => {
  it('keeps the well formed entries of the value array and drops the rest', () => {
    const out = notificationsOf({
      value: [
        { subscriptionId: 's1', clientState: 'c', changeType: 'created', resource: 'Users/x' },
        { nope: true },
        { subscriptionId: 's2', lifecycleEvent: 'missed' },
        'junk',
      ],
    });
    expect(out?.map((n) => n.subscriptionId)).toEqual(['s1', 's2']);
  });
  it('is null when the body has no value array', () => {
    expect(notificationsOf({})).toBeNull();
    expect(notificationsOf(null)).toBeNull();
    expect(notificationsOf({ value: 'x' })).toBeNull();
  });
});

describe('actionOf', () => {
  it('maps lifecycle events to what we do', () => {
    expect(actionOf({ lifecycleEvent: undefined })).toBe('sync');
    expect(actionOf({ lifecycleEvent: 'missed' })).toBe('sync');
    expect(actionOf({ lifecycleEvent: 'reauthorizationRequired' })).toBe('renew');
    expect(actionOf({ lifecycleEvent: 'subscriptionRemoved' })).toBe('forget');
  });
});

describe('renewalDue', () => {
  const now = Date.parse('2026-10-16T12:00:00Z');
  const hours = (h: number) => new Date(now + h * 3_600_000).toISOString();
  it('is due with no subscription, a flag, or an unreadable expiry', () => {
    expect(renewalDue(null, now, 24 * 3_600_000)).toBe(true);
    expect(renewalDue({ expiresAt: hours(60), renewNow: true }, now, 24 * 3_600_000)).toBe(true);
    expect(renewalDue({ expiresAt: 'soon' }, now, 24 * 3_600_000)).toBe(true);
    expect(renewalDue({}, now, 24 * 3_600_000)).toBe(true);
  });
  it('is due inside the renew-before window, not before it', () => {
    expect(renewalDue({ expiresAt: hours(30) }, now, 24 * 3_600_000)).toBe(false);
    expect(renewalDue({ expiresAt: hours(23) }, now, 24 * 3_600_000)).toBe(true);
    expect(renewalDue({ expiresAt: hours(-1) }, now, 24 * 3_600_000)).toBe(true);
  });
  it('never waits longer than half the lifetime, however large the window is set', () => {
    const lifetimeHours = GRAPH_SUBSCRIPTION_MINUTES / 60;
    expect(renewalDue({ expiresAt: hours(lifetimeHours - 1) }, now, 72 * 3_600_000)).toBe(false);
    expect(renewalDue({ expiresAt: hours(lifetimeHours / 2 - 1) }, now, 72 * 3_600_000)).toBe(true);
  });
});

describe('isPublicHttpsUrl (Microsoft calls it from the internet)', () => {
  it('accepts an https URL on a public host', () => {
    expect(isPublicHttpsUrl('https://api.example.com/v2/public/email/microsoft/push')).toBe(true);
    expect(isPublicHttpsUrl('https://8.8.8.8/x')).toBe(true);
  });
  it('refuses plain http, localhost and private or internal hosts', () => {
    for (const url of [
      'http://api.example.com/x',
      'https://localhost/x',
      'https://app.localhost/x',
      'https://127.0.0.1/x',
      'https://10.0.0.5/x',
      'https://192.168.1.2/x',
      'https://172.20.0.1/x',
      'https://169.254.169.254/x',
      'https://intranet/x',
      'https://box.internal/x',
      'https://box.local/x',
      'https://[::1]/x',
      'not a url',
    ]) {
      expect(isPublicHttpsUrl(url), url).toBe(false);
    }
  });
});
