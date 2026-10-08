import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

/**
 * public/sw.js is plain JavaScript with no build step, so it is tested the way a browser would run it: loaded into a sandbox with a
 * fake service worker scope, then driven with push and click events.
 */
const SOURCE = readFileSync(join(process.cwd(), 'public', 'sw.js'), 'utf8');
const ORIGIN = 'https://crm.example';

interface FakeClient {
  url: string;
  focused?: boolean;
  visibilityState?: 'visible' | 'hidden';
  focus: ReturnType<typeof vi.fn>;
  navigate: ReturnType<typeof vi.fn>;
  postMessage: ReturnType<typeof vi.fn>;
}

function client(over: Partial<FakeClient> = {}): FakeClient {
  const c: FakeClient = {
    url: `${ORIGIN}/inbox`,
    focused: false,
    visibilityState: 'hidden',
    focus: vi.fn(async () => c),
    navigate: vi.fn(async () => c),
    postMessage: vi.fn(),
    ...over,
  };
  return c;
}

function load(clients: FakeClient[] = []) {
  const handlers = new Map<string, (event: unknown) => void>();
  const shown: Array<{ title: string; options: Record<string, unknown> }> = [];
  const opened: string[] = [];
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: (event: unknown) => void) => void handlers.set(type, fn),
    skipWaiting: vi.fn(),
    registration: {
      showNotification: vi.fn(async (title: string, options: Record<string, unknown>) => {
        shown.push({ title, options });
      }),
    },
    clients: {
      claim: vi.fn(async () => undefined),
      matchAll: vi.fn(async () => clients),
      openWindow: vi.fn(async (url: string) => {
        opened.push(url);
        return null;
      }),
    },
  };
  runInNewContext(SOURCE, { self, URL, Promise, JSON, String, Array });

  /** Fires an event and waits for what it passed to `waitUntil`. */
  const fire = async (type: string, event: Record<string, unknown>) => {
    let work: Promise<unknown> = Promise.resolve();
    handlers.get(type)!({ ...event, waitUntil: (p: Promise<unknown>) => (work = p) });
    await work;
  };
  const push = (payload: unknown, raw?: string) =>
    fire('push', {
      data: { json: () => (raw !== undefined ? JSON.parse(raw) : payload) },
    });
  const click = (data: unknown) => {
    const notification = { close: vi.fn(), data };
    return fire('notificationclick', { notification }).then(() => notification);
  };
  return { self, handlers, shown, opened, fire, push, click };
}

const PAYLOAD = {
  v: 1,
  title: 'Asha Rao',
  body: 'New message',
  tag: 'conversation:abc',
  url: '/inbox?c=abc',
  silent: false,
  notificationId: '11111111-1111-4111-8111-111111111111',
  test: false,
};

describe('the service worker: showing a push', () => {
  it('shows the notification with title, body, tag, icon and the link to open', async () => {
    const w = load([]);
    await w.push(PAYLOAD);
    expect(w.shown).toHaveLength(1);
    expect(w.shown[0]!.title).toBe('Asha Rao');
    expect(w.shown[0]!.options).toMatchObject({
      body: 'New message',
      tag: 'conversation:abc',
      renotify: true,
      icon: '/notification-icon.png',
      badge: '/notification-badge.png',
      dir: 'auto',
      data: { url: `${ORIGIN}/inbox?c=abc`, notificationId: PAYLOAD.notificationId },
    });
    expect(w.shown[0]!.options.silent).toBeUndefined();
  });

  it('asks for a quiet update (no renotify) when the payload says silent', async () => {
    const w = load([]);
    await w.push({ ...PAYLOAD, silent: true });
    expect(w.shown[0]!.options).toMatchObject({ silent: true, renotify: false });
  });

  it('shows nothing while a tab of the CRM is in front (the bell and toast already say it)', async () => {
    const w = load([client({ visibilityState: 'visible' })]);
    await w.push(PAYLOAD);
    expect(w.shown).toHaveLength(0);
  });

  it('still shows a test notification while the tab is in front, so the button visibly works', async () => {
    const w = load([client({ visibilityState: 'visible' })]);
    await w.push({ ...PAYLOAD, test: true, tag: 'test' });
    expect(w.shown).toHaveLength(1);
  });

  it('shows a generic notification, and never throws, for an empty or broken payload', async () => {
    const w = load([]);
    await w.push(null, '{}');
    await w.fire('push', { data: null });
    await w.fire('push', {
      data: {
        json: () => {
          throw new Error('not json');
        },
      },
    });
    expect(w.shown).toHaveLength(3);
    expect(w.shown.every((s) => s.title === 'New notification')).toBe(true);
    expect(w.shown[0]!.options.data).toMatchObject({ url: `${ORIGIN}/` });
  });

  it('cuts every field of an oversized payload and ignores values of the wrong type', async () => {
    const w = load([]);
    await w.push({ title: 'x'.repeat(500), body: 'y'.repeat(500), tag: 5, url: { evil: true } });
    expect((w.shown[0]!.title as string).length).toBe(100);
    expect((w.shown[0]!.options.body as string).length).toBe(100);
    expect(w.shown[0]!.options.tag).toBeUndefined();
    expect(w.shown[0]!.options.data).toMatchObject({ url: `${ORIGIN}/` });
  });

  it('turns a link to another origin, or a script URL, into the home page', async () => {
    const w = load([]);
    for (const url of [
      'https://evil.example/phish',
      '//evil.example',
      'javascript:alert(1)',
      'data:text/html,x',
    ]) {
      await w.push({ ...PAYLOAD, url });
    }
    expect(w.shown.map((s) => (s.options.data as { url: string }).url)).toEqual(
      Array(4).fill(`${ORIGIN}/`),
    );
  });
});

describe('the service worker: clicking a notification', () => {
  const data = (url: string) => ({ url });

  it('focuses an open tab and moves it to the link', async () => {
    const tab = client({ url: `${ORIGIN}/dashboard` });
    const w = load([tab]);
    const n = await w.click(data(`${ORIGIN}/inbox?c=abc`));
    expect(n.close).toHaveBeenCalled();
    expect(tab.focus).toHaveBeenCalled();
    expect(tab.navigate).toHaveBeenCalledWith(`${ORIGIN}/inbox?c=abc`);
    expect(w.opened).toEqual([]);
  });

  it('prefers the focused tab, then a visible one', async () => {
    const quiet = client({ url: `${ORIGIN}/a` });
    const visible = client({ url: `${ORIGIN}/b`, visibilityState: 'visible' });
    const focused = client({ url: `${ORIGIN}/c`, focused: true });
    await load([quiet, visible, focused]).click(data(`${ORIGIN}/x`));
    expect(focused.focus).toHaveBeenCalled();
    expect(quiet.focus).not.toHaveBeenCalled();
    expect(visible.focus).not.toHaveBeenCalled();
    const w2 = load([quiet, visible]);
    await w2.click(data(`${ORIGIN}/x`));
    expect(visible.focus).toHaveBeenCalled();
  });

  it('asks a tab it cannot navigate to move itself', async () => {
    const tab = client({
      navigate: vi.fn(async () => Promise.reject(new Error('not controlled'))),
    });
    await load([tab]).click(data(`${ORIGIN}/inbox?c=abc`));
    expect(tab.postMessage).toHaveBeenCalledWith({
      type: 'crm-push-open',
      url: `${ORIGIN}/inbox?c=abc`,
    });
  });

  it('opens a new window when no tab of the CRM is open', async () => {
    const w = load([client({ url: 'https://other.example/page' })]);
    await w.click(data(`${ORIGIN}/inbox?c=abc`));
    expect(w.opened).toEqual([`${ORIGIN}/inbox?c=abc`]);
  });

  it('opens a new window when focusing fails', async () => {
    const tab = client({ focus: vi.fn(async () => Promise.reject(new Error('refused'))) });
    const w = load([tab]);
    await w.click(data(`${ORIGIN}/inbox`));
    expect(w.opened).toEqual([`${ORIGIN}/inbox`]);
  });

  it('never navigates to another origin, whatever the notification data says', async () => {
    const tab = client();
    const w = load([tab]);
    await w.click(data('https://evil.example/phish'));
    expect(tab.navigate).toHaveBeenCalledWith(`${ORIGIN}/`);
    const none = load([]);
    await none.click(undefined);
    await none.click({ url: 'javascript:alert(1)' });
    expect(none.opened).toEqual([`${ORIGIN}/`, `${ORIGIN}/`]);
  });
});

describe('the service worker: lifecycle', () => {
  it('takes over at once, caches nothing and has no fetch handler', async () => {
    const w = load([]);
    w.handlers.get('install')!({});
    expect(w.self.skipWaiting).toHaveBeenCalled();
    await w.fire('activate', {});
    expect(w.self.clients.claim).toHaveBeenCalled();
    expect(w.handlers.has('fetch')).toBe(false);
    expect([...w.handlers.keys()].sort()).toEqual(
      ['activate', 'install', 'notificationclick', 'push', 'pushsubscriptionchange'].sort(),
    );
  });

  it('asks every open tab to subscribe again when the browser drops the subscription', async () => {
    const a = client();
    const b = client();
    await load([a, b]).fire('pushsubscriptionchange', {});
    expect(a.postMessage).toHaveBeenCalledWith({ type: 'crm-push-resubscribe' });
    expect(b.postMessage).toHaveBeenCalledWith({ type: 'crm-push-resubscribe' });
  });
});
