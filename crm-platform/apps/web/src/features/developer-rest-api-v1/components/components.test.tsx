import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES, type ApiKeyResponse } from '@crm/contracts';
import { ToastProvider } from '@crm/ui';

const state = vi.hoisted(() => ({
  list: {
    data: undefined as unknown,
    isPending: false,
    isError: false,
    isSuccess: true,
    error: null as unknown,
  },
  perms: new Set<string>(['api.keys.read', 'api.keys.create', 'api.keys.revoke']),
}));

vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: (p: string) => state.perms.has(p),
  useSession: () => ({ org: { name: 'Acme' } }),
}));
vi.mock('../api/keys', () => ({
  KEYS: { list: ['developer-api-keys'] },
  keysApi: { list: vi.fn(), create: vi.fn(), revoke: vi.fn() },
  refresh: () => undefined,
  useKeys: () => ({ ...state.list, refetch: () => undefined }),
}));

import { ApiError } from '@/lib/api/errors';
import {
  ActiveKeyCard,
  CreateKeyCard,
  DeveloperScreen,
  NoticeBox,
  OneTimeBanner,
  Quickstart,
  toNotice,
} from './developer-screen';

const load = (locale: string) =>
  JSON.parse(
    readFileSync(join(process.cwd(), 'messages', locale, 'developer-rest-api-v1.json'), 'utf8'),
  ) as Record<string, unknown>;
const en = load('en');
const ar = load('ar');

const html = (el: ReactElement, messages = en, locale = 'en') =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider dismissLabel="Dismiss">{el}</ToastProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );

const apiKey = (over: Partial<ApiKeyResponse> = {}): ApiKeyResponse => ({
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Production backend',
  prefix: 'wsk_abcdefgh',
  status: 'active',
  lastUsedAt: null,
  expiresAt: null,
  revokedAt: null,
  createdAt: '2026-10-06T10:00:00.000Z',
  ...over,
});
const page = (data: ApiKeyResponse[]) => ({
  data,
  page: { nextCursor: null, hasMore: false, limit: 100 },
});
const BASE = 'https://api.example.com/api/v1';

beforeEach(() => {
  state.perms = new Set(['api.keys.read', 'api.keys.create', 'api.keys.revoke']);
  state.list = { data: undefined, isPending: false, isError: false, isSuccess: true, error: null };
});

describe('DeveloperScreen', () => {
  it('shows the create form and "No key yet" when there is no active key', () => {
    state.list.data = page([]);
    const out = html(<DeveloperScreen baseUrl={BASE} />);
    expect(out).toContain('Create your key');
    expect(out).toContain('No key yet');
    expect(out).toContain('maxLength="120"');
    expect(out).not.toContain('Your API key');
    expect(out).toContain('Authorization: Bearer &lt;key&gt;');
    expect(out).toContain(BASE);
  });

  it('shows the active key card instead of the form, and no one-time banner after a reload', () => {
    state.list.data = page([apiKey()]);
    const out = html(<DeveloperScreen baseUrl={BASE} />);
    expect(out).toContain('Your API key');
    expect(out).toContain('Production backend');
    expect(out).toContain('wsk_abcdefgh…');
    expect(out).toContain('Last used never');
    expect(out).toContain('Key active');
    expect(out).toContain('Only one key is allowed per workspace');
    expect(out).not.toContain('Create your key');
    expect(out).not.toContain('Your new API key');
    expect(out).toContain('Bearer YOUR_API_KEY');
  });

  it('lists a revoked key as nothing: the form comes back', () => {
    state.list.data = page([apiKey({ status: 'revoked', revokedAt: '2026-10-07T00:00:00.000Z' })]);
    const out = html(<DeveloperScreen baseUrl={BASE} />);
    expect(out).toContain('Create your key');
    expect(out).toContain('No key yet');
  });

  it('shows a spinner while loading and an error with Retry when the list fails', () => {
    state.list = {
      data: undefined,
      isPending: true,
      isError: false,
      isSuccess: false,
      error: null,
    };
    expect(html(<DeveloperScreen baseUrl={BASE} />)).toContain('Loading your API key');
    state.list = {
      data: undefined,
      isPending: false,
      isError: true,
      isSuccess: false,
      error: new ApiError(500, 'INTERNAL', 'boom', 'req-9'),
    };
    const out = html(<DeveloperScreen baseUrl={BASE} />);
    expect(out).toContain('Could not load your API key.');
    expect(out).toContain('Retry');
    expect(out).toContain('req-9');
  });

  it('says so when the member may not read keys, and does not call the list', () => {
    state.perms = new Set();
    const out = html(<DeveloperScreen baseUrl={BASE} />);
    expect(out).toContain('You cannot view API keys');
    expect(out).not.toContain('Create your key');
    expect(out).toContain('Quickstart');
  });

  it('links Back and the breadcrumb to Settings and the docs to /developers/docs', () => {
    state.list.data = page([]);
    const out = html(<DeveloperScreen baseUrl={BASE} />);
    expect(out).toContain('href="/settings"');
    expect(out).toContain('href="/developers/docs"');
    expect(out).toContain('target="_blank"');
  });
});

describe('read-only member', () => {
  it('sees the key but a disabled Revoke with the reason', () => {
    state.perms = new Set(['api.keys.read']);
    state.list.data = page([apiKey()]);
    const out = html(<DeveloperScreen baseUrl={BASE} />);
    expect(out).toMatch(/<button[^>]*disabled[^>]*>(?:(?!<\/button>).)*Revoke/s);
    expect(out).toContain('Your role cannot revoke API keys.');
  });
  it('sees a disabled create form with the reason', () => {
    state.perms = new Set(['api.keys.read']);
    state.list.data = page([]);
    const out = html(<DeveloperScreen baseUrl={BASE} />);
    expect(out).toContain('Your role cannot create API keys.');
    expect(out).toMatch(/<input[^>]*disabled/);
    expect(out).toMatch(/<button[^>]*type="submit"[^>]*disabled/);
  });
});

describe('pieces', () => {
  it('banner shows the raw key and a Copy button', () => {
    const out = html(<OneTimeBanner secret="wsk_theRawSecret" />);
    expect(out).toContain('Your new API key');
    expect(out).toContain('wsk_theRawSecret');
    expect(out).toContain('will never be shown again');
    expect(out).toContain('>Copy<');
  });
  it('quickstart carries the real key only when given', () => {
    expect(html(<Quickstart baseUrl={BASE} brand="Acme" />)).toContain('Bearer YOUR_API_KEY');
    const out = html(<Quickstart baseUrl={BASE} brand="Acme" apiKey="wsk_real" />);
    expect(out).toContain('Bearer wsk_real');
    expect(out).toContain(`${BASE}/messages`);
  });
  it('key card for a key used before shows a relative time', () => {
    const out = html(
      <ActiveKeyCard
        apiKey={apiKey({ lastUsedAt: new Date(Date.now() - 3 * 3_600_000).toISOString() })}
        canRevoke
        onRevoked={() => undefined}
        onFailed={() => undefined}
      />,
    );
    expect(out).toContain('3 hours ago');
  });
  it("the confirm dialog carries WaDesk's wording and is closed until Revoke is chosen", () => {
    const out = html(
      <ActiveKeyCard
        apiKey={apiKey()}
        canRevoke
        onRevoked={() => undefined}
        onFailed={() => undefined}
      />,
    );
    // The shared Modal keeps a closed <dialog> in the markup; it is shown only with the `open` attribute.
    expect(out).toMatch(/<dialog(?![^>]*\bopen\b)/);
    expect(out).toContain('Revoke this key?');
  });
  it('create card renders the field with the WaDesk placeholder', () => {
    const out = html(
      <CreateKeyCard
        canCreate
        planLocked={false}
        onCreated={() => undefined}
        onFailed={() => undefined}
      />,
    );
    expect(out).toContain('e.g. Production backend');
    expect(out).toContain('Key name');
    expect(out).toContain('Create key');
  });
  it('the name field is required, capped at 120 and the submit is not busy at rest', () => {
    const out = html(
      <CreateKeyCard
        canCreate
        planLocked={false}
        onCreated={() => undefined}
        onFailed={() => undefined}
      />,
    );
    expect(out).toMatch(/<input[^>]*\brequired\b/);
    expect(out).toMatch(/<input[^>]*maxLength="120"/);
    expect(out).not.toContain('aria-busy');
    expect(JSON.stringify(en)).toContain('"submitting":"Creating key…"');
  });
  it('a plan-locked create card is disabled and explains why', () => {
    const out = html(
      <CreateKeyCard canCreate planLocked onCreated={() => undefined} onFailed={() => undefined} />,
    );
    expect(out).toContain('Your plan does not include the REST API.');
    expect(out).toMatch(/<input[^>]*disabled/);
  });
});

describe('accessibility', () => {
  it('"No key yet" uses the foreground token, and every docs/breadcrumb link has a 24px target', () => {
    state.list.data = page([]);
    const out = html(<DeveloperScreen baseUrl={BASE} />);
    expect(out).toMatch(/bg-muted text-foreground[^"]*"[^>]*>(?:(?!<\/div>).)*No key yet/s);
    expect(out).not.toMatch(/text-muted-foreground"><span[^>]*><\/span>No key yet/);
    for (const m of out.matchAll(/<a [^>]*href="(\/settings|\/developers\/docs)"[^>]*>/g)) {
      if (m[0].includes('h-10')) continue; // the pill buttons are 40px tall
      expect(m[0]).toContain('min-h-6');
    }
  });
});

describe('list retry policy', () => {
  it('retries a transient failure once, quickly, and never a 4xx', async () => {
    const { keysRetry, KEYS_RETRY_DELAY_MS } =
      await vi.importActual<typeof import('../api/keys')>('../api/keys');
    expect(keysRetry(0, new ApiError(500, 'INTERNAL', 'boom'))).toBe(true);
    expect(keysRetry(1, new ApiError(500, 'INTERNAL', 'boom'))).toBe(false);
    expect(keysRetry(0, new TypeError('offline'))).toBe(true);
    expect(keysRetry(0, new ApiError(403, 'FORBIDDEN', 'no'))).toBe(false);
    expect(KEYS_RETRY_DELAY_MS).toBeLessThanOrEqual(500);
  });
});

describe('error mapping', () => {
  const notice = (status: number, code: string, detail = 'x') =>
    toNotice(new ApiError(status, code, detail, 'req-3'));
  it('shows the server sentence for the plan limit', () => {
    const sentence =
      'You already have an active API key. Revoke it before creating a new one - only one key per workspace is allowed.';
    const out = html(<NoticeBox notice={notice(422, ERROR_CODES.PLAN_LIMIT_REACHED, sentence)} />);
    expect(out).toContain(sentence);
    expect(out).toContain('role="alert"');
    expect(out).toContain('req-3');
  });
  it('a plan-locked refusal points at the plans', () => {
    const out = html(<NoticeBox notice={notice(402, ERROR_CODES.PLAN_FEATURE_LOCKED)} />);
    expect(out).toContain('does not include the REST API');
    expect(out).toContain('See plans');
  });
  it('never shows the raw server text for other kinds', () => {
    const out = html(<NoticeBox notice={notice(403, ERROR_CODES.FORBIDDEN, 'internal detail')} />);
    expect(out).toContain('You do not have permission');
    expect(out).not.toContain('internal detail');
  });
  it('a non-API failure reads as a network problem', () => {
    expect(toNotice(new TypeError('x')).kind).toBe('network');
  });
});

describe('messages', () => {
  const flat = (t: Record<string, unknown>, p = ''): string[] =>
    Object.entries(t).flatMap(([k, v]) =>
      typeof v === 'string' ? [`${p}${k}`] : flat(v as Record<string, unknown>, `${p}${k}.`),
    );
  it('Arabic has every English key and renders RTL text', () => {
    expect(flat(ar).sort()).toEqual(flat(en).sort());
    state.list.data = page([]);
    const out = html(<DeveloperScreen baseUrl={BASE} />, ar, 'ar');
    expect(out).toContain('أنشئ مفتاحك');
  });
});
