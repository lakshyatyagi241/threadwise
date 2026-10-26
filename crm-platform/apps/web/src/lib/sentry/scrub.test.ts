import { describe, expect, it } from 'vitest';
import { createThrottle, scrubEvent, scrubLog, scrubText, scrubUrl, throttleKey } from './scrub';

describe('scrubUrl', () => {
  it.each([
    ['/q/AbC123secretTOKEN', '/q/[secret]'],
    ['/i/inv_9f8e7d', '/i/[secret]'],
    ['/b/manage/mgr_token_42', '/b/manage/[secret]'],
    ['/reset-password/rst_abcdef', '/reset-password/[secret]'],
    ['https://desk.example/q/AbC123?x=1#frag', 'https://desk.example/q/[secret]'],
  ])('%s -> %s', (input, expected) => {
    expect(scrubUrl(input)).toBe(expected);
  });

  it('drops the query string and fragment from any address', () => {
    expect(scrubUrl('/login?next=%2Fq%2Fsecret&token=abc')).toBe('/login');
    expect(scrubUrl('https://desk.example/verify-email?code=123456')).toBe(
      'https://desk.example/verify-email',
    );
  });

  it('leaves ordinary pages alone', () => {
    for (const p of ['/', '/contacts/42', '/book/acme/demo', '/s/my-shop', '/admin/settings']) {
      expect(scrubUrl(p)).toBe(p);
    }
  });
});

describe('scrubEvent', () => {
  it('removes body, cookies and query string, redacts credential headers, masks the address', () => {
    const event = scrubEvent({
      request: {
        url: 'https://desk.example/q/SECRETTOKEN?utm=1',
        headers: {
          Authorization: 'Bearer x',
          cookie: 'sid=1',
          'user-agent': 'ua',
          'X-Workspace-Token': 't',
        },
        cookies: { sid: '1' },
        data: { password: 'hunter2' },
        query_string: 'utm=1',
      },
    });
    expect(event.request).toEqual({
      url: 'https://desk.example/q/[secret]',
      headers: {
        Authorization: '[redacted]',
        cookie: '[redacted]',
        'user-agent': 'ua',
        'X-Workspace-Token': '[redacted]',
      },
    });
  });

  it('masks a secret in a page-style transaction name', () => {
    expect(scrubEvent({ transaction: '/q/SECRETTOKEN' }).transaction).toBe('/q/[secret]');
  });

  it('masks addresses in breadcrumbs and trace data', () => {
    const e = scrubEvent({
      breadcrumbs: [
        { data: { url: '/i/inv_secret?x=1' } },
        { data: { from: '/reset-password/rst_x', to: '/login?next=/q/s' } },
        { data: {} },
        {},
      ],
      contexts: {
        trace: {
          data: {
            'http.url': 'https://d/q/TOKEN?a=b',
            'http.query': 'a=b',
            'url.path': '/q/TOKEN',
            op: 'http',
          },
        },
      },
    });
    expect(e.breadcrumbs?.[0]?.data?.url).toBe('/i/[secret]');
    expect(e.breadcrumbs?.[1]?.data).toEqual({ from: '/reset-password/[secret]', to: '/login' });
    expect(e.contexts?.trace?.data).toEqual({
      'http.url': 'https://d/q/[secret]',
      'url.path': '/q/[secret]',
      op: 'http',
    });
  });

  it("scrubs the address our proxy puts in x-crm-path, the referer, and Next's request_path", () => {
    const e = scrubEvent({
      request: {
        headers: {
          'x-crm-path': '/q/boom?token=QUERYSECRET',
          Referer: 'https://d/reset-password/rst_x?a=1',
          accept: '*/*',
        },
      },
      contexts: { nextjs: { request_path: '/q/boom?token=QUERYSECRET' } },
    });
    expect(e.request?.headers).toEqual({
      'x-crm-path': '/q/[secret]',
      Referer: 'https://d/reset-password/[secret]',
      accept: '*/*',
    });
    expect(e.contexts?.nextjs?.request_path).toBe('/q/[secret]');
  });

  it('copes with an event that has none of these', () => {
    expect(scrubEvent({})).toEqual({});
  });
});

describe('createThrottle (an API outage fails every open tab the same way)', () => {
  it('lets the first `limit` of one key through per window, refuses the rest, then starts fresh', () => {
    let t = 0;
    const allow = createThrottle(2, 1000, () => t);
    expect([1, 2, 3, 4].map(() => allow('fetch failed'))).toEqual([true, true, false, false]);
    expect(allow('another error')).toBe(true);
    t = 1000;
    expect(allow('fetch failed')).toBe(true);
  });

  it('stays bounded when every key is different', () => {
    let t = 0;
    const allow = createThrottle(1, 1000, () => t, 3);
    for (const k of ['a', 'b', 'c', 'd', 'e']) expect(allow(k)).toBe(true);
    t = 5000;
    expect(allow('a')).toBe(true);
  });

  it('keys an event by exception type and the start of its text', () => {
    expect(
      throttleKey({ exception: { values: [{ type: 'TypeError', value: 'fetch failed' }] } }),
    ).toBe('TypeError:fetch failed');
    expect(throttleKey({})).toBe(':');
  });
});

describe('text scrub (console messages and error text)', () => {
  it('masks a bearer-link token and a credential parameter inside a sentence', () => {
    expect(scrubText('load /q/AbC123tok failed; retry /b/manage/m_42?token=zz&page=2')).toBe(
      'load /q/[secret] failed; retry /b/manage/[secret]?token=[secret]&page=2',
    );
    expect(scrubText('nothing to hide here')).toBe('nothing to hide here');
  });

  it('cleans the message, exception text, breadcrumb text and log line of an event', () => {
    const event = scrubEvent({
      message: 'open /i/inv_9f8e7d',
      exception: { values: [{ value: 'GET /reset-password/abc failed' }, {}] },
      breadcrumbs: [{ message: 'visited /q/tok1' }, {}],
    });
    expect(event.message).toBe('open /i/[secret]');
    expect(event.exception?.values?.[0]?.value).toBe('GET /reset-password/[secret] failed');
    expect(event.breadcrumbs?.[0]?.message).toBe('visited /q/[secret]');
    expect(
      scrubLog({ message: 'bad /q/tok2', attributes: { url: '/i/x1', n: 2, o: { a: 1 } } }),
    ).toEqual({
      message: 'bad /q/[secret]',
      attributes: { url: '/i/[secret]', n: 2, o: { a: 1 } },
    });
  });
});
