import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPinger,
  createTitleBadge,
  desktopEnabled,
  desktopPermission,
  requestDesktopPermission,
  showDesktopAlert,
  soundEnabled,
} from './alerts';
import { PING_MIN_GAP_MS } from './model';

afterEach(() => {
  vi.unstubAllGlobals();
});

class FakeAudio {
  currentTime = 0;
  destination = {};
  oscillators: Array<{ hz: number }> = [];
  resume = vi.fn(async () => undefined);
  createOscillator() {
    const osc = {
      type: '',
      frequency: { value: 0 },
      connect: (n: unknown) => n,
      start: () => this.oscillators.push({ hz: osc.frequency.value }),
      stop: () => undefined,
    };
    return osc;
  }
  createGain() {
    const param = {
      setValueAtTime: () => undefined,
      exponentialRampToValueAtTime: () => undefined,
    };
    return { gain: param, connect: (n: unknown) => n };
  }
}

function fakeTarget() {
  const handlers = new Map<string, () => void>();
  return {
    handlers,
    addEventListener: (type: string, h: () => void) => handlers.set(type, h),
    removeEventListener: (type: string) => handlers.delete(type),
  } as unknown as Document & { handlers: Map<string, () => void> };
}

describe('the ping', () => {
  it('stays silent until a gesture unlocks audio, then plays the two tones (880 then 1175 Hz)', () => {
    const audio = new FakeAudio();
    vi.stubGlobal('window', {
      AudioContext: function () {
        return audio;
      },
    });
    const pinger = createPinger(() => 0);
    const target = fakeTarget();
    pinger.armOnGesture(target);

    expect(pinger.ping()).toBe(false);
    expect(audio.oscillators).toEqual([]);

    target.handlers.get('pointerdown')!();
    expect(pinger.unlocked).toBe(true);
    expect(pinger.ping()).toBe(true);
    expect(audio.oscillators.map((o) => o.hz)).toEqual([880, 1175]);
  });

  it('plays at most once per 3 seconds', () => {
    const audio = new FakeAudio();
    vi.stubGlobal('window', {
      AudioContext: function () {
        return audio;
      },
    });
    let now = 10_000;
    const pinger = createPinger(() => now);
    const target = fakeTarget();
    pinger.armOnGesture(target);
    target.handlers.get('keydown')!();
    expect(pinger.ping()).toBe(true);
    now += PING_MIN_GAP_MS - 1;
    expect(pinger.ping()).toBe(false);
    now += 1;
    expect(pinger.ping()).toBe(true);
  });

  it('never throws when audio is unavailable or blocked', () => {
    vi.stubGlobal('window', {
      AudioContext: function () {
        throw new Error('blocked');
      },
    });
    const pinger = createPinger();
    const target = fakeTarget();
    pinger.armOnGesture(target);
    target.handlers.get('pointerdown')!();
    expect(() => pinger.ping()).not.toThrow();
    expect(pinger.ping()).toBe(false);
  });
});

describe('the two switches', () => {
  const storage = (items: Record<string, string>) => ({
    localStorage: { getItem: (k: string) => items[k] ?? null },
  });

  it('sound is on unless turned off; blocked storage means on', () => {
    vi.stubGlobal('window', storage({}));
    expect(soundEnabled()).toBe(true);
    vi.stubGlobal('window', storage({ 'crm.notify.sound': 'off' }));
    expect(soundEnabled()).toBe(false);
    vi.stubGlobal('window', {
      get localStorage(): never {
        throw new Error('blocked');
      },
    });
    expect(soundEnabled()).toBe(true);
  });

  it('desktop alerts need the browser permission and the switch', () => {
    vi.stubGlobal('Notification', { permission: 'granted' });
    vi.stubGlobal('window', storage({}));
    expect(desktopEnabled()).toBe(true);
    vi.stubGlobal('window', storage({ 'crm.notify.desktop': 'off' }));
    expect(desktopEnabled()).toBe(false);
    vi.stubGlobal('Notification', { permission: 'default' });
    vi.stubGlobal('window', storage({}));
    expect(desktopEnabled()).toBe(false);
  });

  it('reports no support where there is no Notification', () => {
    expect(desktopPermission()).toBe('unsupported');
  });

  it('asks the browser only when requestDesktopPermission is called, and shows nothing without permission', async () => {
    const requestPermission = vi.fn(async () => 'granted');
    const ctor = vi.fn();
    vi.stubGlobal(
      'Notification',
      Object.assign(ctor, { permission: 'default', requestPermission }),
    );
    expect(requestPermission).not.toHaveBeenCalled();
    showDesktopAlert({ title: 'Ada', body: 'New message', tag: 't', onClick: () => undefined });
    expect(ctor).not.toHaveBeenCalled();
    expect(await requestDesktopPermission()).toBe('granted');
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });

  it('shows the alert with its tag when permitted', () => {
    const ctor = vi.fn(function (this: Record<string, unknown>) {
      this.close = () => undefined;
    });
    vi.stubGlobal('Notification', Object.assign(ctor, { permission: 'granted' }));
    showDesktopAlert({
      title: 'Ada',
      body: 'New message',
      tag: 'new_message:c1',
      onClick: () => undefined,
    });
    expect(ctor).toHaveBeenCalledWith('Ada', { body: 'New message', tag: 'new_message:c1' });
  });
});

describe('the tab title badge', () => {
  const fakeDoc = (title: string) =>
    ({ title, head: {}, documentElement: {} }) as unknown as Document;

  it('puts the count in front, follows changes, and removes itself on dispose', () => {
    const doc = fakeDoc('Inbox');
    const badge = createTitleBadge(doc);
    badge.set(3);
    expect(doc.title).toBe('(3) Inbox');
    badge.set(120);
    expect(doc.title).toBe('(99+) Inbox');
    badge.set(0);
    expect(doc.title).toBe('Inbox');
    badge.set(2);
    badge.dispose();
    expect(doc.title).toBe('Inbox');
  });

  it('re-applies after the page rewrites the title (navigation)', () => {
    let callback: () => void = () => undefined;
    vi.stubGlobal(
      'MutationObserver',
      class {
        constructor(cb: () => void) {
          callback = cb;
        }
        observe() {
          /* the test calls the callback itself */
        }
        disconnect() {
          /* nothing to release */
        }
      },
    );
    const doc = fakeDoc('Inbox');
    const badge = createTitleBadge(doc);
    badge.set(4);
    doc.title = 'Contacts'; // Next replaced it
    callback();
    expect(doc.title).toBe('(4) Contacts');
    callback(); // the watcher fires again for our own change: nothing more to do
    expect(doc.title).toBe('(4) Contacts');
  });
});
