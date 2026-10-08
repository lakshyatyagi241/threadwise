import { describe, expect, it } from 'vitest';
import {
  pushUiState,
  readPushEnv,
  safeInternalPath,
  sameApplicationKey,
  subscriptionToInput,
  testOutcome,
  urlBase64ToUint8Array,
  type PushEnv,
} from './support';

const capable: PushEnv = {
  serviceWorker: true,
  pushManager: true,
  notification: true,
  permission: 'default',
  secure: true,
  ios: false,
  standalone: false,
};

describe('the state of browser notifications on this device', () => {
  const state = (
    env: Partial<PushEnv> | null,
    over: { configured?: boolean; subscribed?: boolean } = {},
  ) =>
    pushUiState({
      configured: over.configured ?? true,
      env: env === null ? null : { ...capable, ...env },
      subscribed: over.subscribed ?? false,
    });

  it('does not exist when the deployment has no push keys', () => {
    expect(state({}, { configured: false })).toBe('unconfigured');
    expect(state({ permission: 'granted' }, { configured: false, subscribed: true })).toBe(
      'unconfigured',
    );
  });

  it('is checking until the browser has been asked', () => {
    expect(state(null)).toBe('checking');
  });

  it('is unsupported without service workers, the Push API, Notification or a secure page', () => {
    expect(state({ serviceWorker: false })).toBe('unsupported');
    expect(state({ pushManager: false })).toBe('unsupported');
    expect(state({ notification: false, permission: 'unsupported' })).toBe('unsupported');
    expect(state({ secure: false })).toBe('unsupported');
  });

  it('asks an iPhone or iPad in a Safari tab to add the app to the Home Screen first (honest iOS limit)', () => {
    expect(state({ ios: true, pushManager: false })).toBe('needs_install');
    expect(state({ ios: true, standalone: false, serviceWorker: false })).toBe('needs_install');
    // Installed, and capable: normal flow.
    expect(state({ ios: true, standalone: true })).toBe('off');
    // Installed but this iOS is too old to push: plain unsupported, not an install prompt.
    expect(state({ ios: true, standalone: true, pushManager: false })).toBe('unsupported');
  });

  it('is blocked when the person blocked notifications in the browser', () => {
    expect(state({ permission: 'denied' })).toBe('blocked');
    expect(state({ permission: 'denied' }, { subscribed: true })).toBe('blocked');
  });

  it('is off until permission is granted AND this device is saved on the server', () => {
    expect(state({ permission: 'default' })).toBe('off');
    expect(state({ permission: 'granted' }, { subscribed: false })).toBe('off');
    expect(state({ permission: 'default' }, { subscribed: true })).toBe('off');
  });

  it('is on only with permission and a subscription the server knows', () => {
    expect(state({ permission: 'granted' }, { subscribed: true })).toBe('on');
  });
});

describe('readPushEnv', () => {
  const fakeWindow = (over: Record<string, unknown> = {}, nav: Record<string, unknown> = {}) =>
    ({
      navigator: {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/126',
        platform: 'Win32',
        maxTouchPoints: 0,
        serviceWorker: {},
        ...nav,
      },
      Notification: { permission: 'default' },
      PushManager: class PushManager {},
      isSecureContext: true,
      matchMedia: () => ({ matches: false }),
      ...over,
    }) as never;

  it('reads a capable desktop browser', () => {
    expect(readPushEnv(fakeWindow())).toEqual({
      serviceWorker: true,
      pushManager: true,
      notification: true,
      permission: 'default',
      secure: true,
      ios: false,
      standalone: false,
    });
  });

  it('knows a missing API, an iPhone, iPadOS posing as a Mac, and an installed app', () => {
    const noPush = readPushEnv(fakeWindow({ PushManager: undefined, Notification: undefined }));
    expect(noPush).toMatchObject({
      pushManager: false,
      notification: false,
      permission: 'unsupported',
    });
    const iphone = readPushEnv(
      fakeWindow(
        {},
        { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Safari' },
      ),
    );
    expect(iphone.ios).toBe(true);
    const ipad = readPushEnv(
      fakeWindow(
        {},
        {
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)',
          platform: 'MacIntel',
          maxTouchPoints: 5,
        },
      ),
    );
    expect(ipad.ios).toBe(true);
    const mac = readPushEnv(fakeWindow({}, { platform: 'MacIntel', maxTouchPoints: 0 }));
    expect(mac.ios).toBe(false);
    expect(readPushEnv(fakeWindow({}, { standalone: true })).standalone).toBe(true);
    expect(readPushEnv(fakeWindow({ matchMedia: () => ({ matches: true }) })).standalone).toBe(
      true,
    );
  });

  it('never throws when the browser is hostile', () => {
    const hostile = fakeWindow({
      matchMedia: () => {
        throw new Error('no');
      },
    });
    expect(() => readPushEnv(hostile)).not.toThrow();
  });
});

describe('conversions the browser API needs', () => {
  it('turns a base64url VAPID key into bytes, with and without padding', () => {
    expect(Array.from(urlBase64ToUint8Array('AQID'))).toEqual([1, 2, 3]);
    expect(Array.from(urlBase64ToUint8Array('AQI'))).toEqual([1, 2]);
    expect(Array.from(urlBase64ToUint8Array('-_8'))).toEqual([251, 255]);
  });

  it('compares a saved subscription key with the deployment key', () => {
    const buffer = new Uint8Array([1, 2, 3]).buffer;
    expect(sameApplicationKey(buffer, 'AQID')).toBe(true);
    expect(sameApplicationKey(buffer, 'AQIE')).toBe(false);
    expect(sameApplicationKey(null, 'AQID')).toBe(false);
  });

  it('builds the request body from PushSubscription.toJSON(), or nothing without both keys', () => {
    const ok = subscriptionToInput({
      toJSON: () => ({
        endpoint: 'https://push.example/e',
        expirationTime: null,
        keys: { p256dh: 'pp', auth: 'aa' },
      }),
    });
    expect(ok).toEqual({
      endpoint: 'https://push.example/e',
      expirationTime: null,
      keys: { p256dh: 'pp', auth: 'aa' },
    });
    expect(
      subscriptionToInput({
        toJSON: () => ({ endpoint: 'https://push.example/e', keys: { p256dh: 'pp' } }),
      }),
    ).toBeNull();
    expect(subscriptionToInput({ toJSON: () => ({}) })).toBeNull();
  });

  it('follows only a path on this site when the service worker asks the page to open a link', () => {
    const origin = 'https://crm.example';
    expect(safeInternalPath('https://crm.example/inbox?c=1#x', origin)).toBe('/inbox?c=1#x');
    expect(safeInternalPath('/team-chat?c=2', origin)).toBe('/team-chat?c=2');
    for (const bad of [
      'https://evil.example/x',
      '//evil.example',
      'javascript:alert(1)',
      '',
      null,
      5,
    ]) {
      expect(safeInternalPath(bad, origin), String(bad)).toBeNull();
    }
  });

  it('words the result of a test notification', () => {
    expect(testOutcome({ sent: 2, failed: 0 })).toBe('sent');
    expect(testOutcome({ sent: 1, failed: 1 })).toBe('sent');
    expect(testOutcome({ sent: 0, failed: 2 })).toBe('none_reachable');
    expect(testOutcome({ sent: 0, failed: 0 })).toBe('no_device');
  });
});
