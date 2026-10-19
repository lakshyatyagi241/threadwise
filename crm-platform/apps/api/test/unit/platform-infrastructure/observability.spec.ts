import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { maskSecretUrl } from '../../../src/common/logging/mask-secret-url';
import {
  LOG_REDACT_PATHS,
  NO_EXTRA_DATA,
  SECRET_HEADERS,
  createFatalHandler,
  initSentry,
  redactHeaders,
  scrubSentryEvent,
  scrubSentrySpan,
} from '../../../src/modules/platform-infrastructure';

describe('log redaction', () => {
  it('has a pino path for every secret header, plus response cookies', () => {
    for (const h of SECRET_HEADERS) expect(LOG_REDACT_PATHS).toContain(`req.headers["${h}"]`);
    expect(LOG_REDACT_PATHS).toContain('res.headers["set-cookie"]');
  });

  it('redactHeaders replaces secret headers whatever their case and keeps the rest', () => {
    expect(
      redactHeaders({
        Authorization: 'Bearer abc',
        'X-Node-Token': 'n',
        'content-type': 'application/json',
        'X-Hub-Signature-256': 'sha256=ff',
      }),
    ).toEqual({
      Authorization: '[redacted]',
      'X-Node-Token': '[redacted]',
      'content-type': 'application/json',
      'X-Hub-Signature-256': '[redacted]',
    });
  });

  it('redactHeaders leaves undefined alone', () => {
    expect(redactHeaders(undefined)).toBeUndefined();
  });

  /**
   * Drift guard: a header the API starts reading tomorrow whose name says it carries a credential must be added to the list,
   * or this fails. Scans every source file for header names read through @Headers(), req.header() or headers[].
   */
  it('covers every header the API reads whose name says it is a credential or signature', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (full.endsWith('.ts')) files.push(full);
      }
    };
    walk(join(__dirname, '../../../src'));
    const read = new Set<string>();
    for (const f of files) {
      for (const m of readFileSync(f, 'utf8').matchAll(
        /(?:@Headers\(|\.header\(|\.get\(|headers\[)\s*['"]([A-Za-z0-9-]+)['"]/g,
      )) {
        read.add(m[1]!.toLowerCase());
      }
    }
    const looksSecret = /secret|token|signature|hmac|api-key|authorization|cookie/;
    const missing = [...read]
      .filter((h) => looksSecret.test(h))
      // `set-cookie` is a response header, redacted through its own `res.headers` path
      .filter((h) => h !== 'set-cookie')
      .filter((h) => !(SECRET_HEADERS as readonly string[]).includes(h));
    expect(missing).toEqual([]);
  });
});

describe('secret path segments', () => {
  it.each([
    ['/v2/telegram/inbound/123456:ABC-def_ghi', '/v2/telegram/inbound/[secret]'],
    ['/v2/line/inbound/lw_tok-123', '/v2/line/inbound/[secret]'],
    ['/v2/viber/inbound/vb_tok-123?x=1', '/v2/viber/inbound/[secret]?x=1'],
    ['/v2/wechat/inbound/wc_tok-123', '/v2/wechat/inbound/[secret]'],
    ['/v2/shopify/webhook/s3cr3t', '/v2/shopify/webhook/[secret]'],
    ['/v2/woocommerce/webhook/s3cr3t?x=1', '/v2/woocommerce/webhook/[secret]?x=1'],
    ['/v2/public/lead-hooks/tok_abc123', '/v2/public/lead-hooks/[secret]'],
    ['/public/lead-hooks/tok_abc123?a=b', '/public/lead-hooks/[secret]?a=b'],
  ])('%s is masked', (url, masked) => {
    expect(maskSecretUrl(url)).toBe(masked);
  });

  it('leaves ordinary addresses alone', () => {
    for (const url of [
      '/v2/contacts/5',
      '/v2/shopify/compliance',
      '/v2/facebook/webhook',
      '/health',
    ]) {
      expect(maskSecretUrl(url)).toBe(url);
    }
    expect(maskSecretUrl(undefined)).toBeUndefined();
  });
});

describe('scrubSentryEvent', () => {
  it('drops the body, cookies and query string, redacts credential headers, masks the path', () => {
    const event = scrubSentryEvent({
      request: {
        url: 'https://desk.example/v2/shopify/webhook/s3cr3t?token=abc',
        headers: { authorization: 'Bearer x', 'user-agent': 'curl', 'x-webhook-secret': 'w' },
        cookies: { sid: '1' },
        data: { password: 'hunter2' },
        query_string: 'token=abc',
      },
      breadcrumbs: [
        { data: { url: 'https://desk.example/v2/public/lead-hooks/tok?x=1' } },
        { data: {} },
        {},
      ],
    });
    expect(event.request).toEqual({
      url: 'https://desk.example/v2/shopify/webhook/[secret]',
      headers: {
        authorization: '[redacted]',
        'user-agent': 'curl',
        'x-webhook-secret': '[redacted]',
      },
    });
    expect(event.breadcrumbs?.[0]?.data?.url).toBe(
      'https://desk.example/v2/public/lead-hooks/[secret]',
    );
  });

  it('masks a secret in the name of the request being handled (the field Sentry fills from the route)', () => {
    expect(scrubSentryEvent({ transaction: 'GET /v2/telegram/inbound/123:ABC' }).transaction).toBe(
      'GET /v2/telegram/inbound/[secret]',
    );
  });

  it('copes with an event that has no request', () => {
    expect(scrubSentryEvent({})).toEqual({});
  });
});

describe('scrubSentrySpan', () => {
  it('masks the secret in the name and in every address attribute, and drops the query', () => {
    const span = scrubSentrySpan({
      name: 'GET /v2/shopify/webhook/s3cr3t',
      attributes: {
        'url.full': 'http://x/v2/shopify/webhook/s3cr3t?token=abc',
        'url.path': '/v2/shopify/webhook/s3cr3t',
        'url.query': 'token=abc',
        'url.fragment': 'frag',
        'http.url': 'http://x/v2/shopify/webhook/s3cr3t?token=abc',
        'http.target': '/v2/shopify/webhook/s3cr3t?token=abc',
        'http.query': 'token=abc',
        'http.request.method': 'GET',
        'http.response.status_code': 500,
      },
    });
    expect(span.name).toBe('GET /v2/shopify/webhook/[secret]');
    expect(span.attributes).toEqual({
      'url.full': 'http://x/v2/shopify/webhook/[secret]',
      'url.path': '/v2/shopify/webhook/[secret]',
      'http.url': 'http://x/v2/shopify/webhook/[secret]',
      'http.target': '/v2/shopify/webhook/[secret]',
      'http.request.method': 'GET',
      'http.response.status_code': 500,
    });
  });

  it('masks a secret in an attribute it has no rule for, and in the { value } form of one', () => {
    const span = scrubSentrySpan({
      attributes: {
        'some.future.address': 'https://x/v2/telegram/inbound/123:ABC',
        'url.full': { value: 'https://x/v2/public/lead-hooks/tok?a=b', unit: undefined },
      },
    });
    expect(span.attributes).toEqual({
      'some.future.address': 'https://x/v2/telegram/inbound/[secret]',
      'url.full': { value: 'https://x/v2/public/lead-hooks/[secret]', unit: undefined },
    });
  });

  it('redacts a secret header carried as an attribute and keeps the others', () => {
    const span = scrubSentrySpan({
      attributes: {
        'http.request.header.x-hub-signature-256': ['sha256=ff'],
        'http.request.header.X-Webhook-Secret': ['w'],
        'http.request.header.user-agent': ['curl'],
        'http.response.header.content-type': ['application/json'],
      },
    });
    expect(span.attributes).toEqual({
      'http.request.header.x-hub-signature-256': ['[redacted]'],
      'http.request.header.X-Webhook-Secret': ['[redacted]'],
      'http.request.header.user-agent': ['curl'],
      'http.response.header.content-type': ['application/json'],
    });
  });

  it('copes with a span that has no attributes', () => {
    expect(scrubSentrySpan({})).toEqual({});
  });
});

describe('initSentry', () => {
  it('does nothing without a DSN', () => {
    expect(initSentry('api', {})).toBe(false);
    expect(initSentry('api', { SENTRY_DSN: '   ' })).toBe(false);
  });

  /**
   * Sentry 11 collects everything it can unless each category is switched off (the old `sendDefaultPii: false` is gone). These
   * are the categories that can carry a credential or customer data and that `scrubSentryEvent` cannot look inside.
   */
  it('switches off every data category that can carry a secret', () => {
    expect(NO_EXTRA_DATA).toEqual({
      userInfo: false,
      cookies: false,
      httpHeaders: { request: true, response: false },
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    });
  });
});

describe('createFatalHandler', () => {
  afterEach(() => vi.restoreAllMocks());

  it('writes one structured line, then exits 1', async () => {
    const lines: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });
    const exit = vi.fn();
    const handle = createFatalHandler('worker', 'uncaught exception', exit);
    handle(new Error('boom'));
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      level: 60,
      service: 'worker',
      msg: 'uncaught exception: process is exiting',
      err: { type: 'Error', message: 'boom' },
    });
  });

  it('turns a non-Error rejection into a readable one', async () => {
    const lines: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });
    const exit = vi.fn();
    createFatalHandler('api', 'unhandled rejection', exit)('plain string');
    await vi.waitFor(() => expect(exit).toHaveBeenCalled());
    expect(JSON.parse(lines[0]!).err.message).toBe('plain string');
  });

  it('acts once: a second failure while dying neither logs nor exits again', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exit = vi.fn();
    const handle = createFatalHandler('api', 'uncaught exception', exit);
    handle(new Error('first'));
    handle(new Error('second'));
    await vi.waitFor(() => expect(exit).toHaveBeenCalled());
    expect(exit).toHaveBeenCalledTimes(1);
  });
});
