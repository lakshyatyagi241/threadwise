import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GoogleAccountResponse } from '@crm/contracts';
import { ToastProvider } from '@crm/ui';

const state = vi.hoisted(() => ({
  account: { data: undefined as unknown, isPending: false, isError: false, error: null as unknown },
  calendars: { data: undefined as unknown },
  perms: new Set<string>(['google.account.read', 'google.account.manage']),
  search: '',
}));

vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: (p: string) => state.perms.has(p),
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(state.search),
}));
vi.mock('../api/google-account', () => ({
  KEYS: { account: ['google-account'], calendars: ['google-account', 'calendars'] },
  googleAccountApi: { connect: vi.fn(), disconnect: vi.fn() },
  useGoogleAccount: () => ({ ...state.account, refetch: () => undefined }),
  useGoogleCalendars: () => state.calendars,
}));

import { GoogleAccountScreen } from './google-account-screen';

const en = JSON.parse(
  readFileSync(join(process.cwd(), 'messages', 'en', 'google-account.json'), 'utf8'),
) as Record<string, unknown>;

const html = (el: ReactElement) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider dismissLabel="Dismiss">{el}</ToastProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );

const account = (
  over: Partial<GoogleAccountResponse> = {},
  granted: string[] = [],
): GoogleAccountResponse => ({
  status: 'disconnected',
  account: null,
  connectedAt: null,
  capabilities: (['calendar', 'sheets', 'docs', 'forms', 'drive_listing'] as const).map((key) => ({
    key,
    granted: granted.includes(key),
    restricted: key === 'docs' || key === 'drive_listing',
  })),
  calendarId: null,
  calendarName: null,
  lastError: null,
  lastUsedAt: null,
  ...over,
});

const show = (a: GoogleAccountResponse) => {
  state.account = { data: a, isPending: false, isError: false, error: null };
  return html(<GoogleAccountScreen />);
};

beforeEach(() => {
  state.perms = new Set(['google.account.read', 'google.account.manage']);
  state.account = { data: undefined, isPending: false, isError: false, error: null };
  state.calendars = { data: undefined };
  state.search = '';
});

describe('the Google account screen', () => {
  it('tells a role without the read permission so, and shows nothing of the account', () => {
    state.perms = new Set();
    const out = html(<GoogleAccountScreen />);
    expect(out).toContain('You cannot open this page');
    expect(out).not.toContain('Connect Google account');
  });

  it('offers Connect with the safe permissions ticked and the restricted ones marked', () => {
    const out = show(account());
    expect(out).toContain('Not connected');
    expect(out).toContain('Connect Google account');
    expect(out).toContain('Restricted by Google');
    expect(out).toContain('ga-cap-calendar');
    expect(out).toContain('ga-cap-docs');
    // Calendar, Sheets and Forms start ticked; the two restricted ones do not.
    expect(out).toMatch(/id="ga-cap-sheets"[^>]*checked/);
    expect(out).not.toMatch(/id="ga-cap-docs"[^>]*checked/);
  });

  it('shows a connected account with what is allowed, and offers Add permissions and Disconnect', () => {
    const out = show(
      account(
        {
          status: 'connected',
          account: 'ana@example.com',
          connectedAt: '2026-10-01T10:00:00.000Z',
          calendarId: 'team@example.com',
          calendarName: 'Team calendar',
        },
        ['calendar', 'sheets'],
      ),
    );
    expect(out).toContain('ana@example.com');
    expect(out).toContain('Team calendar');
    expect(out).toContain('Change calendar');
    expect(out).toContain('Add permissions');
    expect(out).toContain('Disconnect');
    expect(out).toContain('2 of 5');
    expect(out).toContain('Allowed');
  });

  it('says what to do when Google stopped accepting the grant', () => {
    const out = show(
      account({ status: 'needs_reconnect', account: 'ana@example.com' }, ['sheets']),
    );
    expect(out).toContain('Google stopped accepting this connection');
    expect(out).toContain('ana@example.com');
    expect(out).toContain('Reconnect Google');
  });

  it('says the platform has no Google client, and offers nothing to press', () => {
    const out = show(account({ status: 'unavailable' }));
    expect(out).toContain('Google is not set up for this platform');
    expect(out).not.toContain('Connect Google account');
    expect(out).not.toContain('ga-cap-sheets');
  });

  it('shows the last problem Google reported by its code, in our words', () => {
    const out = show(
      account(
        {
          status: 'connected',
          account: 'ana@example.com',
          lastError: {
            code: 'GOOGLE_API_NOT_ENABLED',
            at: '2026-10-14T10:00:00.000Z',
            capability: 'sheets',
          },
        },
        ['sheets'],
      ),
    );
    expect(out).toContain('has not enabled an API');
  });

  it('is read-only for someone who may view but not manage', () => {
    state.perms = new Set(['google.account.read']);
    const out = show(account({ status: 'connected', account: 'ana@example.com' }, ['sheets']));
    expect(out).not.toContain('Add permissions');
    expect(out).not.toMatch(/>Disconnect</);
    expect(out).toContain('Not allowed');
  });

  it('shows the result Google sent the browser back with', () => {
    state.search = 'calendar=missing_scope';
    const out = show(account({ status: 'connected', account: 'a@b.co' }, ['sheets']));
    expect(out).toContain('did not give every permission');
  });
});
