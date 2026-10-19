import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ConferencingCapabilities,
  ConferencingConnection,
  ContactMeetingResponse,
} from '@crm/contracts';
import { ToastProvider } from '@crm/ui';

const state = vi.hoisted(() => ({
  caps: { data: undefined as unknown },
  conns: {
    data: undefined as unknown,
    isPending: false,
    isError: false,
    error: null as unknown,
  },
  perms: new Set<string>(['record.contacts.update']),
  search: '',
}));

vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: (p: string) => state.perms.has(p),
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(state.search),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) => (
    <a href={href} {...rest}>
      {children as never}
    </a>
  ),
}));
vi.mock('../api/conferencing', () => ({
  KEYS: { capabilities: ['c'], connections: ['k'] },
  conferencingApi: { start: vi.fn(), confirm: vi.fn(), disconnect: vi.fn(), retry: vi.fn() },
  useConferencingCapabilities: () => state.caps,
  useConferencingConnections: () => ({ ...state.conns, refetch: () => undefined }),
  useRetryConferencing: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { MeetingConferencingFields } from './meeting-conferencing-fields';
import { MeetingVideoStatus } from './meeting-video-status';
import { VideoMeetingsScreen } from './video-meetings-screen';

const en = JSON.parse(
  readFileSync(join(process.cwd(), 'messages', 'en', 'meeting-conferencing.json'), 'utf8'),
) as Record<string, unknown>;

const html = (el: ReactElement) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider dismissLabel="Dismiss">{el}</ToastProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );

const caps = (over: Partial<ConferencingCapabilities> = {}): ConferencingCapabilities => ({
  video: [],
  calendar: null,
  canInstall: false,
  connectable: [],
  installable: false,
  ...over,
});

const fields = (value?: Parameters<typeof MeetingConferencingFields>[0]['value'], hasStart = true) =>
  html(<MeetingConferencingFields value={value} onChange={() => undefined} hasStart={hasStart} />);

beforeEach(() => {
  state.caps = { data: undefined };
  state.conns = { data: undefined, isPending: false, isError: false, error: null };
  state.perms = new Set(['record.contacts.update']);
  state.search = '';
});

describe('the video and calendar fields of the meeting form', () => {
  it('draw nothing while the options load, or when they could not be loaded', () => {
    expect(fields()).toBe('');
  });

  it('draw nothing before an integration is installed and connected', () => {
    state.caps = { data: caps() };
    expect(fields()).toBe('');
  });

  it('draw one quiet link to the Marketplace for a person who may install, and none for one who may not', () => {
    state.caps = { data: caps({ canInstall: true, installable: true }) };
    const out = fields();
    expect(out).toContain('Connect video conferencing');
    expect(out).toContain('href="/marketplace/integrations"');
    expect(out).not.toContain('Add Zoom link');
    state.caps = { data: caps({ canInstall: false, installable: true }) };
    expect(fields()).toBe('');
  });

  it('send a person whose workspace installed Zoom to their own connection page', () => {
    state.caps = { data: caps({ connectable: ['zoom'] }) };
    expect(fields()).toContain('href="/settings/video-meetings"');
  });

  it('offer exactly the connected options, as buttons, with the chosen one pressed', () => {
    state.caps = {
      data: caps({
        video: [
          { provider: 'zoom', via: 'app' },
          { provider: 'meet', via: 'calendar' },
        ],
      }),
    };
    const none = fields();
    expect(none).toContain('Add Zoom link');
    expect(none).toContain('Add Google Meet link');
    expect(none).not.toContain('Add Teams link');
    const chosen = fields({ videoProvider: 'zoom' });
    expect(chosen).toContain('aria-pressed="true"');
    expect(chosen).toContain('Zoom link');
    expect(chosen).toContain('Remove the video link');
  });

  it('show the connected calendar by name, and the invitation only once the calendar is ticked', () => {
    state.caps = {
      data: caps({ calendar: { provider: 'google', account: 'ana@gmail.example', calendarName: 'Sales' } }),
    };
    const off = fields();
    expect(off).toContain('Add to my calendar (ana@gmail.example, Sales)');
    expect(off).not.toContain('Send a calendar invitation to the contact');
    const on = fields({ addToCalendar: true });
    expect(on).toContain('Send a calendar invitation to the contact');
  });

  it('keep the calendar ticked and locked for a Meet link, and say why', () => {
    state.caps = {
      data: caps({
        video: [{ provider: 'meet', via: 'calendar' }],
        calendar: { provider: 'google', account: 'ana@gmail.example', calendarName: null },
      }),
    };
    const out = fields({ videoProvider: 'meet' });
    expect(out).toContain('part of a calendar event');
    expect(out).toMatch(/type="checkbox"[^>]*checked=""[^>]*disabled=""|type="checkbox"[^>]*disabled=""[^>]*checked=""/);
  });

  it('lock everything and say so while the meeting has no start time', () => {
    state.caps = { data: caps({ video: [{ provider: 'zoom', via: 'app' }] }) };
    const out = fields(undefined, false);
    expect(out).toContain('Set a start time to add a video link');
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*>Add Zoom link/);
  });
});

const meeting = (conf: ContactMeetingResponse['conferencing'], over: Partial<ContactMeetingResponse> = {}): ContactMeetingResponse => ({
  id: '11111111-1111-4111-8111-111111111111',
  contactId: '22222222-2222-4222-8222-222222222222',
  title: 'Intro call',
  startsAt: '2027-02-01T10:00:00.000Z',
  endsAt: null,
  location: null,
  createdBy: null,
  rowVersion: 1,
  createdAt: '2027-01-01T00:00:00.000Z',
  updatedAt: '2027-01-01T00:00:00.000Z',
  conferencing: conf,
  ...over,
});
const status = (m: ContactMeetingResponse) =>
  html(<MeetingVideoStatus meeting={m} contactId={m.contactId} listKey={['x']} />);
const base = {
  videoProvider: 'zoom' as const,
  videoStatus: 'ready' as const,
  videoError: null,
  calendarProvider: null,
  calendarStatus: null,
  calendarError: null,
  invited: false,
};

describe('the status line of a meeting', () => {
  it('draws nothing for a meeting that asked for nothing', () => {
    expect(status(meeting(null))).toBe('');
  });

  it('shows the provider and a Join button that opens the call in a new tab', () => {
    const out = status(meeting(base, { joinUrl: 'https://zoom.us/j/123' }));
    expect(out).toContain('>Zoom<');
    expect(out).toContain('href="https://zoom.us/j/123"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('>Join<');
  });

  it('never links an address that is not http or https', () => {
    const out = status(meeting(base, { joinUrl: 'javascript:alert(1)' }));
    expect(out).not.toContain('javascript:');
    expect(out).not.toContain('>Join<');
  });

  it('says what went wrong in words and offers Try again to a person who may edit', () => {
    const failed = { ...base, videoStatus: 'failed' as const, videoError: 'needs_reconnect' as const };
    const out = status(meeting(failed));
    expect(out).toContain('Your Zoom connection needs to be renewed');
    expect(out).toContain('Try again');
    state.perms = new Set();
    expect(status(meeting(failed))).not.toContain('Try again');
  });

  it('shows the calendar entry and whether the contact was invited', () => {
    const synced = { ...base, videoProvider: null, videoStatus: null, calendarProvider: 'google' as const, calendarStatus: 'synced' as const };
    expect(status(meeting(synced))).toContain('On your calendar');
    expect(status(meeting({ ...synced, invited: true }))).toContain('sent the contact an invitation');
    const failedCal = { ...synced, calendarStatus: 'failed' as const, calendarError: 'calendar_not_connected' as const };
    expect(status(meeting(failedCal))).toContain('no calendar is connected');
  });
});

const card = (over: Partial<ConferencingConnection>): ConferencingConnection => ({
  provider: 'zoom',
  status: 'disconnected',
  account: null,
  connectedAt: null,
  lastErrorCode: null,
  ...over,
});
const screen = (cards: ConferencingConnection[], canInstall = false) => {
  state.conns = { data: { data: cards, canInstall }, isPending: false, isError: false, error: null };
  return html(<VideoMeetingsScreen />);
};

describe('the Video meetings page', () => {
  it('tells a role without the key so and shows no cards', () => {
    state.perms = new Set();
    const out = html(<VideoMeetingsScreen />);
    expect(out).toContain('You cannot use this page');
  });

  it('offers Install to a person who may install, and says to ask an admin otherwise', () => {
    const cards = [card({ status: 'not_installed' }), card({ provider: 'teams', status: 'not_installed' })];
    const can = screen(cards, true);
    expect(can).toContain('Install in the Marketplace');
    expect(can).toContain('href="/marketplace/integrations"');
    const cannot = screen(cards, false);
    expect(cannot).not.toContain('Install in the Marketplace');
    expect(cannot).toContain('Ask a workspace admin to install it');
  });

  it('shows Connect when not connected, the account when connected, and Reconnect when it needs renewing', () => {
    const out = screen([
      card({ status: 'disconnected' }),
      card({ provider: 'teams', status: 'connected', account: 'ana@contoso.example', connectedAt: '2027-01-02T00:00:00.000Z' }),
    ]);
    expect(out).toContain('>Connect<');
    expect(out).toContain('Account: ana@contoso.example');
    expect(out).toContain('>Disconnect<');
    const renew = screen([card({ status: 'needs_reconnect', account: 'ana@example.com' }), card({ provider: 'teams', status: 'unavailable' })]);
    expect(renew).toContain('>Reconnect<');
    expect(renew).toContain('has not been set up for this platform yet');
  });

  it('shows the outcome the provider left in the address', () => {
    state.search = 'video=denied&provider=zoom';
    expect(screen([card({}), card({ provider: 'teams' })])).toContain('Zoom was not connected because the sign-in was cancelled');
  });
});
