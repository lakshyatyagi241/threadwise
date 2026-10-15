import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  formDefinitionSchema,
  formRateLimitsSchema,
  type FormDefinitionInput,
} from '@crm/contracts';
import { AppError } from '../../../src/common/errors/app-error';
import { buildCsv, csvCell } from '../../../src/common/csv';
import { resolveConsent } from '../../../src/modules/forms-builder/form-consent';
import { buildEmbedScript, jsString } from '../../../src/modules/forms-builder/embed-script';
import { hashIp, newPublicKey, randomToken } from '../../../src/modules/forms-builder/form-key';
import { checkOrigin, frameAncestorsFor } from '../../../src/modules/forms-builder/form-origin';
import { freeTexts } from '../../../src/modules/forms-builder/form-rules';
import { scoreSubmission, SPAM_THRESHOLD } from '../../../src/modules/forms-builder/form-spam';
import {
  FORM_DEFAULT_LIMITS,
  FORM_PUBLIC_IP_LIMIT,
  FormThrottle,
} from '../../../src/modules/forms-builder/form-throttle';
import {
  companyDomainSpellings,
  normaliseCompanyDomain,
} from '../../../src/modules/crm/companies/company-rules';

describe('spam scoring (spec 9.1 step 1)', () => {
  const base = { texts: [] as string[], honeypotEnabled: true };

  it('a filled honeypot is a bot: silent drop, nothing stored', () => {
    const v = scoreSubmission({ ...base, honeypotValue: 'http://x' });
    expect(v).toMatchObject({ honeypot: true, spam: true });
    expect(scoreSubmission({ ...base, honeypotValue: '   ' }).honeypot).toBe(false);
    expect(scoreSubmission({ ...base, honeypotEnabled: false, honeypotValue: 'x' }).honeypot).toBe(
      false,
    );
  });

  it('a very fast submit is scored, not refused on its own', () => {
    const v = scoreSubmission({ ...base, elapsedMs: 300 });
    expect(v.reasons).toContain('too_fast');
    expect(v.spam).toBe(false);
    expect(scoreSubmission({ ...base, elapsedMs: 5000 }).reasons).toEqual([]);
    expect(scoreSubmission(base).reasons).toEqual([]);
  });

  it('links and the stock phrases of comment spam push a submission over the line', () => {
    const pitch =
      'Hello, we offer SEO services and cheap backlinks, visit https://spam.example now http://b.example';
    const v = scoreSubmission({ ...base, texts: [pitch] });
    expect(v.spam).toBe(true);
    expect(v.reasons).toEqual(expect.arrayContaining(['links', 'keywords']));
    expect(v.score).toBeGreaterThanOrEqual(SPAM_THRESHOLD);
  });

  it('markup in a text answer is scored, and an ordinary message is clean', () => {
    expect(
      scoreSubmission({ ...base, texts: ['check <a href="http://x.example">this</a> out please'] })
        .reasons,
    ).toContain('markup');
    const ok = scoreSubmission({
      ...base,
      texts: ['Hi, I would like a quote for 20 chairs delivered to Pune next month.'],
      elapsedMs: 18_000,
    });
    expect(ok).toMatchObject({ score: 0, spam: false });
  });

  it('only free text is read: a website field, an email or a choice never counts as a pitch', () => {
    const d = formDefinitionSchema.parse({
      title: 'T',
      steps: [
        {
          id: 'step',
          blocks: [
            {
              id: 'site',
              type: 'field',
              kind: 'short_text',
              label: 'Site',
              bind: { object: 'company', property: 'domain' },
            },
            { id: 'about', type: 'field', kind: 'short_text', label: 'About' },
            { id: 'msg', type: 'field', kind: 'long_text', label: 'Msg' },
            { id: 'mail', type: 'field', kind: 'email', label: 'Mail' },
          ],
        },
      ],
    } as FormDefinitionInput);
    const link = 'https://www.example.com/a-fairly-long-address';
    const texts = freeTexts(d, {
      site: link,
      about: link,
      msg: link,
      mail: 'someone-with-a-long-address@example.com',
    });
    expect(texts).toEqual([link, link]);
    expect(freeTexts(d, { site: 'short', msg: 'tiny' })).toEqual([]);
    expect(scoreSubmission({ ...base, texts: freeTexts(d, { site: link }) }).score).toBe(0);
  });
});

describe('the embed allow-list (spec 7.3)', () => {
  const allowed = ['https://shop.example.com', 'https://*.partner.io'];
  const own = ['http://localhost:3001'];

  it('no Origin is not refused: an allow-list stops browsers only', () => {
    expect(checkOrigin(undefined, allowed)).toBe('skip');
    expect(checkOrigin(undefined, [])).toBe('skip');
  });

  it('exact origins and one wildcard level, scheme and port included', () => {
    expect(checkOrigin('https://shop.example.com', allowed)).toBe('allowed');
    expect(checkOrigin('https://SHOP.example.com', allowed)).toBe('allowed');
    expect(checkOrigin('https://x.shop.example.com', allowed)).toBe('denied');
    expect(checkOrigin('https://shop.example.com:8443', allowed)).toBe('denied');
    expect(checkOrigin('http://shop.example.com', allowed)).toBe('denied');
    expect(checkOrigin('https://a.partner.io', allowed)).toBe('allowed');
    expect(checkOrigin('https://a.b.partner.io', allowed)).toBe('allowed');
    expect(checkOrigin('https://partner.io', allowed)).toBe('denied');
    expect(checkOrigin('https://evilpartner.io', allowed)).toBe('denied');
    expect(checkOrigin('https://partner.io.evil.com', allowed)).toBe('denied');
  });

  it('an empty list is the hosted page only: every browser origin but our own is refused', () => {
    expect(checkOrigin('https://anywhere.example', [])).toBe('denied');
    expect(checkOrigin('http://localhost:3001', [], own)).toBe('allowed');
    expect(checkOrigin('null', allowed)).toBe('denied');
    expect(checkOrigin('https://*', allowed)).toBe('denied');
  });

  it('the hosted page can never be framed; an embed only by the allow-list', () => {
    expect(frameAncestorsFor(allowed, false)).toBe("'none'");
    expect(frameAncestorsFor([], true)).toBe("'none'");
    expect(frameAncestorsFor(allowed, true)).toBe('https://shop.example.com https://*.partner.io');
  });
});

describe('CSV export (spec 14: formula injection)', () => {
  it('prefixes every cell a spreadsheet would run as a formula', () => {
    for (const v of ['=HYPERLINK("http://x")', '+1+1', '-2+3', '@SUM(1)', '\tcmd', '\rcmd']) {
      expect(csvCell(v).replace(/^"/, '').startsWith("'"), v).toBe(true);
    }
    expect(csvCell('Ada')).toBe('Ada');
    expect(csvCell('a=b')).toBe('a=b');
  });

  it('quotes commas, quotes and line breaks and joins lists', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('l1\nl2')).toBe('"l1\nl2"');
    expect(csvCell(['a', 'b'])).toBe('a; b');
    expect(csvCell(null)).toBe('');
    expect(csvCell(7)).toBe('7');
  });

  it('builds a CRLF document, header first', () => {
    expect(buildCsv(['a', 'b'], [[1, '=x']])).toBe("a,b\r\n1,'=x\r\n");
  });
});

describe('consent (spec 9.5, D10)', () => {
  const def = (consent: Record<string, unknown>) =>
    formDefinitionSchema.parse({
      title: 'T',
      steps: [{ id: 's', blocks: [] }],
      consent,
    } as FormDefinitionInput);
  const now = new Date('2026-10-05T10:00:00Z');

  it('a form without a consent line stores nothing and subscribes nobody', () => {
    expect(resolveConsent(def({}), { given: true, textVersion: 1 }, now)).toEqual({
      stored: null,
      missing: false,
      marketingOptIn: false,
    });
  });

  it('a required box that is not ticked is missing; a ticked marketing box subscribes; an unticked one never does', () => {
    const d = def({ enabled: true, required: true, marketing: true, text: 'I agree' });
    expect(resolveConsent(d, { given: false, textVersion: 1 }, now)).toMatchObject({
      missing: true,
      marketingOptIn: false,
    });
    expect(resolveConsent(d, undefined, now)).toMatchObject({
      missing: true,
      marketingOptIn: false,
    });
    const ticked = resolveConsent(d, { given: true, textVersion: 1 }, now);
    expect(ticked).toMatchObject({ missing: false, marketingOptIn: true });
    expect(ticked.stored).toEqual({
      given: true,
      text: 'I agree',
      version: 1,
      shownVersion: 1,
      at: now.toISOString(),
    });
  });

  it('an optional box that is ticked records consent but subscribes only when marked marketing', () => {
    const d = def({ enabled: true, required: false, marketing: false });
    expect(resolveConsent(d, { given: true, textVersion: 1 }, now)).toMatchObject({
      marketingOptIn: false,
    });
    expect(resolveConsent(d, { given: false, textVersion: 1 }, now)).toMatchObject({
      missing: false,
    });
  });

  it('keeps the version a stale page said it showed next to the live one', () => {
    const d = def({ enabled: true, version: 3 });
    expect(resolveConsent(d, { given: true, textVersion: 2 }, now).stored).toMatchObject({
      version: 3,
      shownVersion: 2,
    });
  });
});

describe('keys and hashes', () => {
  it('a public key is 22 letters and digits and not repeated', () => {
    const keys = new Set(Array.from({ length: 200 }, () => newPublicKey()));
    expect(keys.size).toBe(200);
    for (const k of keys) expect(k).toMatch(/^[A-Za-z0-9]{22}$/);
    expect(randomToken(40)).toHaveLength(40);
  });

  it('an address hash is stable within a day, differs across days and secrets, and says nothing of the address', () => {
    const d1 = new Date('2026-10-05T01:00:00Z');
    const d1b = new Date('2026-10-05T23:00:00Z');
    const d2 = new Date('2026-10-06T01:00:00Z');
    const a = hashIp('203.0.113.7', 's1', d1);
    expect(a).toBe(hashIp('203.0.113.7', 's1', d1b));
    expect(a).not.toBe(hashIp('203.0.113.7', 's1', d2));
    expect(a).not.toBe(hashIp('203.0.113.7', 's2', d1));
    expect(a).not.toBe(hashIp('203.0.113.8', 's1', d1));
    expect(a).not.toContain('203');
    expect(hashIp(undefined, 's1')).toBeNull();
  });
});

describe('embed loader (spec 7.3)', () => {
  const key = 'aB3dE5gH7jK9mN1pQ3sT5v';
  const script = buildEmbedScript(key, 'https://app.example.com/');

  it('puts values in as JSON literals and cannot be broken out of', () => {
    expect(jsString('</script><script>alert(1)')).not.toContain('</script>');
    expect(jsString('a b')).toContain('\\u2028');
    expect(buildEmbedScript('x"; alert(1); "', 'https://a.example')).not.toContain('alert(1); "');
  });

  it('acts on a message only from the form origin and its own frame, never accepts one from the parent, follows https redirects only', () => {
    expect(script).toContain('e.origin !== ORIGIN || e.source !== frame.contentWindow');
    expect(script).toContain("m.source !== 'forms'");
    expect(script).toMatch(/\^https:/);
    expect(script).not.toContain("addEventListener('message', function (e) { frame");
    expect(script).not.toContain('postMessage');
  });

  it('runs: injects one iframe at the web origin, resizes it from a trusted message, ignores a forged one', () => {
    const listeners: Array<(e: unknown) => void> = [];
    const frame: Record<string, unknown> = {
      style: {},
      setAttribute: () => undefined,
      contentWindow: { id: 'win' },
    };
    const node = {
      attrs: new Map<string, string>([['data-forms-key', key]]),
      getAttribute(n: string) {
        return this.attrs.get(n) ?? null;
      },
      setAttribute(n: string, v: string) {
        this.attrs.set(n, v);
      },
      appendChild: () => undefined,
      dispatchEvent: () => undefined,
    };
    const doc = {
      currentScript: null,
      querySelectorAll: () => [node],
      createElement: () => frame,
    };
    const win = {
      addEventListener: (_t: string, fn: (e: unknown) => void) => listeners.push(fn),
      location: { href: '' },
    };
    vm.runInNewContext(script, {
      document: doc,
      window: win,
      encodeURIComponent,
      CustomEvent: class {},
      isFinite,
      Math,
      Array,
    });
    expect(frame.src).toBe(`https://app.example.com/f/${key}?embed=1`);
    expect(listeners).toHaveLength(1);
    const msg = { source: 'forms', type: 'resize', key, height: 640 };
    listeners[0]!({ origin: 'https://evil.example', source: frame.contentWindow, data: msg });
    expect((frame.style as { height?: string }).height).toBeUndefined();
    listeners[0]!({ origin: 'https://app.example.com', source: { id: 'other' }, data: msg });
    expect((frame.style as { height?: string }).height).toBeUndefined();
    listeners[0]!({ origin: 'https://app.example.com', source: frame.contentWindow, data: msg });
    expect((frame.style as { height?: string }).height).toBe('640px');
    listeners[0]!({
      origin: 'https://app.example.com',
      source: frame.contentWindow,
      data: { source: 'forms', type: 'redirect', key, url: 'javascript:alert(1)' },
    });
    expect(win.location.href).toBe('');
    listeners[0]!({
      origin: 'https://app.example.com',
      source: frame.contentWindow,
      data: { source: 'forms', type: 'redirect', key, url: 'https://example.com/thanks' },
    });
    expect(win.location.href).toBe('https://example.com/thanks');
  });
});

describe('embed loader: popup mode', () => {
  const key = 'aB3dE5gH7jK9mN1pQ3sT5v';
  const script = buildEmbedScript(key, 'https://app.example.com');

  /** A page just big enough for the loader: records what it appends, which timers it sets and which listeners it adds. */
  function page(attrs: Record<string, string>, stored: Record<string, string> = {}) {
    const store = { ...stored };
    const timers: Array<{ fn: () => void; ms: number }> = [];
    const winListeners: Record<string, Array<(e?: unknown) => void>> = {};
    const docListeners: Record<string, Array<(e?: unknown) => void>> = {};
    const appended: Array<Record<string, any>> = []; // eslint-disable-line @typescript-eslint/no-explicit-any
    const element = (): Record<string, any> => ({
      // eslint-disable-line @typescript-eslint/no-explicit-any
      style: {},
      attrs: {} as Record<string, string>,
      children: [] as unknown[],
      setAttribute(n: string, v: string) {
        this.attrs[n] = v;
      },
      appendChild(c: unknown) {
        this.children.push(c);
      },
      addEventListener: () => undefined,
      focus: () => undefined,
    });
    const node = {
      attrs: { 'data-forms-key': key, 'data-forms-mode': 'popup', ...attrs } as Record<
        string,
        string
      >,
      getAttribute(n: string) {
        return this.attrs[n] ?? null;
      },
      setAttribute(n: string, v: string) {
        this.attrs[n] = v;
      },
      dispatchEvent: () => undefined,
    };
    const win = {
      pageYOffset: 0,
      innerHeight: 800,
      location: { href: '' },
      localStorage: {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => {
          store[k] = v;
        },
      },
      setTimeout: (fn: () => void, ms: number) => timers.push({ fn, ms }),
      clearTimeout: () => undefined,
      addEventListener: (t: string, fn: (e?: unknown) => void) => {
        (winListeners[t] ??= []).push(fn);
      },
      removeEventListener: (t: string, fn: unknown) => {
        winListeners[t] = (winListeners[t] ?? []).filter((f) => f !== fn);
      },
    } as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const doc = {
      currentScript: null,
      activeElement: null,
      head: element(),
      body: { appendChild: (c: Record<string, any>) => appended.push(c) }, // eslint-disable-line @typescript-eslint/no-explicit-any
      documentElement: { scrollHeight: 2800, style: {} as Record<string, string> },
      querySelectorAll: () => [node],
      getElementById: () => null,
      createElement: element,
      addEventListener: (t: string, fn: (e?: unknown) => void) => {
        (docListeners[t] ??= []).push(fn);
      },
      removeEventListener: () => undefined,
    };
    vm.runInNewContext(script, {
      document: doc,
      window: win,
      encodeURIComponent,
      CustomEvent: class {},
      isFinite,
      parseFloat,
      Number,
      Date,
      Math,
      Array,
    });
    const scrollTo = (y: number) => {
      win.pageYOffset = y;
      for (const fn of [...(winListeners.scroll ?? [])]) fn();
    };
    return { appended, timers, win, doc, store, scrollTo, winListeners, docListeners };
  }

  it('does nothing until the trigger fires, then draws one dialog with the form frame', () => {
    const p = page({ 'data-forms-trigger': 'delay', 'data-forms-delay': '3' });
    expect(p.appended).toHaveLength(0);
    expect(p.timers).toHaveLength(1);
    expect(p.timers[0]!.ms).toBe(3000);
    p.timers[0]!.fn();
    expect(p.appended).toHaveLength(1);
    const panel = p.appended[0]!.children[0];
    expect(panel.attrs.role).toBe('dialog');
    const frame = panel.children[1];
    expect(frame.src).toBe(`https://app.example.com/f/${key}?embed=1`);
    expect(p.doc.documentElement.style.overflow).toBe('hidden');
  });

  it('holds the options to the same limits the Share tab writes', () => {
    expect(page({ 'data-forms-trigger': 'delay', 'data-forms-delay': '99999' }).timers[0]!.ms).toBe(
      600_000,
    );
    expect(page({ 'data-forms-trigger': 'delay', 'data-forms-delay': 'soon' }).timers[0]!.ms).toBe(
      5000,
    );
    expect(page({ 'data-forms-trigger': 'bogus' }).timers).toHaveLength(1);
  });

  it('scroll down opens past the chosen depth, once', () => {
    const p = page({ 'data-forms-trigger': 'scroll_down', 'data-forms-scroll': '50' });
    p.scrollTo(300); // 15% of 2000px of room
    expect(p.appended).toHaveLength(0);
    p.scrollTo(1100);
    expect(p.appended).toHaveLength(1);
    p.scrollTo(1500);
    expect(p.appended).toHaveLength(1);
  });

  it('scroll up opens only after the visitor went down and came back up 80px or more', () => {
    const p = page({ 'data-forms-trigger': 'scroll_up' });
    p.scrollTo(100);
    p.scrollTo(20); // never went far enough down
    expect(p.appended).toHaveLength(0);
    p.scrollTo(600);
    p.scrollTo(560); // only 40px back
    expect(p.appended).toHaveLength(0);
    p.scrollTo(500);
    expect(p.appended).toHaveLength(1);
  });

  it('a click trigger opens nothing by itself but exposes FormsPopup[key].open and the data-forms-open button', () => {
    const p = page({ 'data-forms-trigger': 'click' });
    expect(p.timers).toHaveLength(0);
    expect(p.winListeners.scroll ?? []).toHaveLength(0);
    p.win.FormsPopup[key].open();
    expect(p.appended).toHaveLength(1);
  });

  it('a visitor who already saw it, or sent the form, is left alone for automatic triggers', () => {
    const later = String(Date.now() + 86_400_000);
    expect(
      page({ 'data-forms-trigger': 'delay' }, { [`forms:popup:${key}`]: later }).timers,
    ).toHaveLength(0);
    expect(
      page({ 'data-forms-trigger': 'delay' }, { [`forms:popup:${key}`]: 'done' }).timers,
    ).toHaveLength(0);
    expect(
      page({ 'data-forms-trigger': 'delay' }, { [`forms:popup:${key}`]: '1' }).timers,
    ).toHaveLength(1);
  });

  it('puts no popup code on an inline embed', () => {
    const listeners: unknown[] = [];
    vm.runInNewContext(script, {
      document: {
        currentScript: null,
        querySelectorAll: () => [
          {
            getAttribute: (n: string) => (n === 'data-forms-key' ? key : null),
            setAttribute: () => undefined,
            appendChild: () => undefined,
          },
        ],
        createElement: () => ({ style: {}, setAttribute: () => undefined, contentWindow: {} }),
      },
      window: {
        addEventListener: (_: string, fn: unknown) => listeners.push(fn),
        location: { href: '' },
      },
      encodeURIComponent,
      CustomEvent: class {},
      isFinite,
      Math,
      Array,
    });
    expect(listeners).toHaveLength(1);
  });
});

/** A Redis stand-in for the commands the throttle uses: a fixed window per key. */
function fakeRedis(opts: { failing?: boolean } = {}) {
  const counts = new Map<string, number>();
  return {
    counts,
    multi() {
      let key = '';
      const chain = {
        incr(k: string) {
          key = k;
          return chain;
        },
        expire() {
          return chain;
        },
        ttl() {
          return chain;
        },
        async exec() {
          if (opts.failing) throw new Error('redis down');
          const n = (counts.get(key) ?? 0) + 1;
          counts.set(key, n);
          return [
            [null, n],
            [null, 1],
            [null, 33],
          ];
        },
      };
      return chain;
    },
  };
}

describe('FormThrottle (spec 9.1, 14)', () => {
  const limits = formRateLimitsSchema.parse({
    perIpPerMinute: 2,
    perFormPerMinute: 3,
    perContactPerHour: 1,
  });

  it('defaults match the spec: 20 a minute per address, 120 per form, 5 an hour per contact', () => {
    expect(FORM_DEFAULT_LIMITS).toEqual({
      perIpPerMinute: 20,
      perFormPerMinute: 120,
      perContactPerHour: 5,
    });
    expect(formRateLimitsSchema.parse({})).toEqual(FORM_DEFAULT_LIMITS);
  });

  it('refuses the call over the address budget with 429 RATE_LIMITED and retryAfterSeconds', async () => {
    const t = new FormThrottle(fakeRedis() as never);
    await t.checkSubmit(1, '10.0.0.1', limits);
    await t.checkSubmit(1, '10.0.0.1', limits);
    const err = await t.checkSubmit(1, '10.0.0.1', limits).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).getStatus()).toBe(429);
    expect((err as AppError).details).toContainEqual({ path: 'retryAfterSeconds', message: '33' });
  });

  it('counts per form: another address, same form still hits the form budget; another form does not', async () => {
    const t = new FormThrottle(fakeRedis() as never);
    await t.checkSubmit(1, 'a', limits);
    await t.checkSubmit(1, 'b', limits);
    await t.checkSubmit(1, 'c', limits);
    await expect(t.checkSubmit(1, 'd', limits)).rejects.toBeInstanceOf(AppError);
    await expect(t.checkSubmit(2, 'd', limits)).resolves.toBeUndefined();
  });

  it('counts the same contact point once per hour, whatever the casing, and never keeps it in a cache key', async () => {
    const redis = fakeRedis();
    const t = new FormThrottle(redis as never);
    await t.checkContact(1, 'ada@example.com', limits);
    await expect(t.checkContact(1, 'ada@example.com', limits)).rejects.toBeInstanceOf(AppError);
    await expect(t.checkContact(1, 'grace@example.com', limits)).resolves.toBeUndefined();
    await expect(t.checkContact(1, null, limits)).resolves.toBeUndefined();
    expect([...redis.counts.keys()].some((k) => k.includes('ada@example.com'))).toBe(false);
  });

  it('the address budget before a lookup is 120 a minute', async () => {
    const t = new FormThrottle(fakeRedis() as never);
    for (let i = 0; i < FORM_PUBLIC_IP_LIMIT; i += 1) await t.checkIp('9.9.9.9');
    await expect(t.checkIp('9.9.9.9')).rejects.toBeInstanceOf(AppError);
    await expect(t.checkIp('8.8.8.8')).resolves.toBeUndefined();
  });

  it('fails open when Redis is down', async () => {
    const t = new FormThrottle(fakeRedis({ failing: true }) as never);
    await expect(t.checkIp('1.1.1.1')).resolves.toBeUndefined();
    await expect(t.checkSubmit(1, '1.1.1.1', limits)).resolves.toBeUndefined();
    await expect(t.checkContact(1, 'a@b.co', limits)).resolves.toBeUndefined();
  });
});

describe('company website match (spec 9.3)', () => {
  it('reads a host out of however a website was typed', () => {
    expect(normaliseCompanyDomain('https://www.Acme.com/about?x=1')).toBe('acme.com');
    expect(normaliseCompanyDomain('ACME.co.uk')).toBe('acme.co.uk');
    expect(normaliseCompanyDomain('http://acme.com:8080/')).toBe('acme.com');
    expect(normaliseCompanyDomain('user@acme.com')).toBe('acme.com');
    for (const bad of ['', 'acme', 'not a host', '-bad-.com', 'a..com', null, undefined]) {
      expect(normaliseCompanyDomain(bad as string | null | undefined), String(bad)).toBeNull();
    }
  });

  it('lists the spellings a stored website can have, lower case, so the lookup stays on its index', () => {
    const s = companyDomainSpellings('acme.com');
    expect(s).toEqual(
      expect.arrayContaining([
        'acme.com',
        'acme.com/',
        'www.acme.com',
        'https://acme.com',
        'https://www.acme.com/',
        'http://acme.com',
      ]),
    );
    expect(s.every((x) => x === x.toLowerCase())).toBe(true);
  });
});
