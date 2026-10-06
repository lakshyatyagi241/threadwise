import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GET as redirectDocs } from '@/app/docs/route';
import { GET as redirectDocsApi } from '@/app/docs/api/route';
import { buildReference } from '../lib/spec-model';
import type { DocsData } from '../lib/load-spec';
import { DocsPage } from './docs-page';

const load = (locale: string, file: string) =>
  JSON.parse(
    readFileSync(join(process.cwd(), 'messages', locale, `${file}.json`), 'utf8'),
  ) as Record<string, unknown>;
const messagesOf = (locale: string) => ({
  ...load(locale, 'developer-rest-api-v1'),
  ...load(locale, 'developer-rest-api-v1-docs'),
});
const en = messagesOf('en');
const ar = messagesOf('ar');

const html = (el: ReactElement, messages = en, locale = 'en') =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={messages}>
      {el}
    </NextIntlClientProvider>,
  );

const spec = {
  info: { title: 'Acme API', version: 'v1' },
  tags: [
    { name: 'Message', description: 'Send messages.' },
    { name: 'Contact', description: 'The address book.' },
  ],
  paths: {
    '/api/v1/contacts': {
      get: {
        tags: ['Contact'],
        summary: 'List contacts',
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer' }, description: 'Page size' },
        ],
        responses: {
          '200': { description: 'OK', content: { 'application/json': { example: { data: [] } } } },
          '401': { description: 'Unauthenticated' },
        },
      },
    },
    '/api/v1/messages': {
      post: {
        tags: ['Message'],
        summary: 'Send a message',
        requestBody: {
          content: {
            'application/json': {
              schema: { type: 'object', required: ['to'], properties: { to: { type: 'string' } } },
            },
          },
        },
        responses: { '202': { description: 'Accepted' } },
      },
    },
  },
};
const ORIGIN = 'https://api.example.com';
const ok: DocsData = { status: 'ok', reference: buildReference(spec, ORIGIN) };
const page = (data: DocsData) => (
  <DocsPage
    data={data}
    brand="Acme"
    baseUrl={`${ORIGIN}/api/v1`}
    specUrl={`${ORIGIN}/docs/api.json`}
  />
);

describe('DocsPage', () => {
  it('shows the top bar, the base URL, the introduction cards and the filter', () => {
    const out = html(page(ok));
    expect(out).toContain('Acme');
    expect(out).toContain('Get an API key');
    expect(out).toContain('href="/developers"');
    expect(out).toContain(`href="${ORIGIN}/docs/api.json"`);
    expect(out).toContain('target="_blank"');
    expect(out).toContain('https://api.example.com/api/v1</code>');
    expect(out).toContain('What you can do');
    expect(out.match(/<li class="rounded-xl/g)).toHaveLength(8);
    expect(out).toContain('Authorization: Bearer YOUR_API_KEY');
    expect(out).toContain('X-Api-Key');
    expect(out).toContain('placeholder="Filter endpoints…"');
    expect(out).toContain('aria-label="Filter endpoints"');
  });

  it('states the real rate limit and does not claim there is none', () => {
    const out = html(page(ok));
    expect(out).toContain('600 requests per minute');
    expect(out).toContain('per-minute limit of the workspace plan');
    expect(out).not.toMatch(/no hard (request )?limit/i);
  });

  it('is honest that webhook delivery is not built: a note, no invented event list', () => {
    const out = html(page(ok));
    expect(out).toContain('Webhook delivery is coming');
    expect(out).not.toContain('message_received');
    expect(out).not.toContain('Signature');
  });

  it('lists the groups in the document order with a card per endpoint, closed at first', () => {
    const out = html(page(ok));
    expect(out.indexOf('>Message<')).toBeLessThan(out.indexOf('>Contact<'));
    expect(out).toContain('Send messages.');
    expect(out).toContain('id="op-post-api-v1-messages"');
    expect(out).toContain('id="op-get-api-v1-contacts"');
    expect(out.match(/aria-expanded="false"/g)).toHaveLength(2);
    expect(out).toContain('aria-controls="op-get-api-v1-contacts-body"');
    expect(out).toContain('id="op-get-api-v1-contacts-body" hidden=""');
    expect(out).toContain('List contacts');
    expect(out).toContain('2 endpoints');
  });

  it('puts the generated cURL, the parameters table and the sample responses in each card, copy buttons included', () => {
    const out = html(page(ok));
    expect(out).toContain('curl -X GET &#x27;https://api.example.com/api/v1/contacts&#x27;');
    expect(out).toContain('Page size');
    expect(out).toContain('query · integer');
    expect(out).toContain('required');
    expect(out).toContain('Body parameters');
    expect(out).toContain('The specification gives no example for this response.');
    expect(out).toContain('aria-label="Copy the request"');
    expect(out).toContain('&quot;data&quot;: []');
  });

  it('shows a clear, retryable error when the API cannot be reached, and keeps the introduction', () => {
    const out = html(page({ status: 'unavailable' }));
    expect(out).toContain('role="alert"');
    expect(out).toContain('The endpoint reference could not be loaded');
    expect(out).toContain('href="/developers/docs"');
    expect(out).toContain('Try again');
    expect(out).toContain('What you can do');
    expect(out).not.toContain('data-endpoint');
  });

  it('shows an empty state when the document lists no endpoint', () => {
    const out = html(page({ status: 'empty', reference: buildReference({ paths: {} }, ORIGIN) }));
    expect(out).toContain('No endpoints are published yet');
    expect(out).not.toContain('role="alert"');
  });

  it('renders in Arabic from the Arabic messages', () => {
    const out = html(page(ok), ar, 'ar');
    expect(out).toContain('احصل على مفتاح API');
    expect(out).toContain('تسليم الويب هوك قادم قريبًا');
    expect(out).toContain('600');
    expect(out).not.toContain('Get an API key');
  });

  it('uses logical properties and theme tokens only (no left/right utilities, no fixed brand colours)', () => {
    const out = html(page(ok));
    expect(out).not.toMatch(/class="[^"]*\b(?:ml|mr|pl|pr|left|right)-\d/);
    expect(out).not.toMatch(/#[0-9a-fA-F]{6}\b/);
  });
});

describe('the old reference addresses', () => {
  it('/docs and /docs/api answer 302 to /developers/docs', () => {
    for (const GET of [redirectDocs, redirectDocsApi]) {
      const res = GET();
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/developers/docs');
    }
  });
});

describe('messages', () => {
  const keys = (o: unknown, p = ''): string[] =>
    typeof o === 'object' && o !== null
      ? Object.entries(o).flatMap(([k, v]) => keys(v, `${p}${k}.`))
      : [p.slice(0, -1)];
  it('English and Arabic have the same keys', () => {
    expect(keys(load('ar', 'developer-rest-api-v1-docs')).sort()).toEqual(
      keys(load('en', 'developer-rest-api-v1-docs')).sort(),
    );
  });
});
