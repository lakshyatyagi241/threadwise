import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadRecaptcha, recaptchaSrc, resetRecaptchaLoader } from './use-recaptcha';

interface FakeScript {
  src: string;
  async?: boolean;
  defer?: boolean;
  onload?: () => void;
  onerror?: () => void;
  remove: () => void;
}

const g = globalThis as unknown as { window?: unknown; document?: unknown };

describe('recaptchaSrc', () => {
  it('asks v2 for explicit rendering and puts the site key in the v3 address', () => {
    expect(recaptchaSrc({ version: 'v2', siteKey: 'k' })).toBe(
      'https://www.google.com/recaptcha/api.js?render=explicit',
    );
    expect(recaptchaSrc({ version: 'v3', siteKey: 'a b' })).toBe(
      'https://www.google.com/recaptcha/api.js?render=a%20b',
    );
  });
});

describe('loadRecaptcha', () => {
  let scripts: FakeScript[];
  let win: { grecaptcha?: { ready: (cb: () => void) => void } };

  beforeEach(() => {
    resetRecaptchaLoader();
    scripts = [];
    win = {};
    g.window = win;
    g.document = {
      createElement: () => {
        const s: FakeScript = { src: '', remove: () => undefined };
        scripts.push(s);
        return s;
      },
      head: { appendChild: () => undefined },
    };
  });
  afterEach(() => {
    delete g.window;
    delete g.document;
  });

  it('adds the script once, and resolves when the library reports ready', async () => {
    const first = loadRecaptcha({ version: 'v2', siteKey: 'k' });
    const second = loadRecaptcha({ version: 'v2', siteKey: 'k' });
    expect(scripts).toHaveLength(1);
    expect(scripts[0]!.src).toContain('render=explicit');
    win.grecaptcha = { ready: (cb) => cb() };
    scripts[0]!.onload?.();
    await expect(first).resolves.toBe(win.grecaptcha);
    await expect(second).resolves.toBe(win.grecaptcha);
  });

  it('rejects when the script cannot load, and tries again on the next call', async () => {
    const failed = loadRecaptcha({ version: 'v3', siteKey: 'k' });
    scripts[0]!.onerror?.();
    await expect(failed).rejects.toThrow('failed to load');
    // Let the rejection handler that forgets the cache run, then retry.
    await Promise.resolve();
    void loadRecaptcha({ version: 'v3', siteKey: 'k' }).catch(() => undefined);
    expect(scripts).toHaveLength(2);
  });
});
