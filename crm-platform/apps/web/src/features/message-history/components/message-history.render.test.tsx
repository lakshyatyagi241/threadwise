// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import { ToastProvider } from '@crm/ui';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  MessageHistoryDetail,
  MessageHistoryInsights,
  MessageHistoryRow,
  MessageHistorySummary,
} from '@crm/contracts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const U = '0b6f6c2e-7a3d-4a0e-9c1e-2f6f6d9a1b11';

const row = (over: Partial<MessageHistoryRow>): MessageHistoryRow => ({
  id: `m:${U}`,
  entityKind: 'message',
  source: 'inbox',
  direction: 'in',
  status: 'received',
  type: 'text',
  at: '2026-10-13T10:05:00.000Z',
  contact: { id: U, name: 'Asha Mine' },
  recipient: { value: '•••••••5678', masked: true },
  channel: { id: U, kind: 'whatsapp_cloud', name: 'Main' },
  preview: 'Hello I need help with my order number 1…',
  mediaName: null,
  template: null,
  failure: null,
  cost: null,
  entity: null,
  conversationId: U,
  ...over,
});

const ROWS: MessageHistoryRow[] = [
  row({}),
  row({
    id: `m:${U.replace('0b6f', '1b6f')}`,
    direction: 'out',
    status: 'failed',
    failure: { code: '131049', reason: '#131049 not delivered' },
  }),
  row({
    id: `b:${U}`,
    entityKind: 'broadcast',
    source: 'broadcast',
    type: 'broadcast',
    direction: 'out',
    status: 'read',
    preview: null,
    conversationId: null,
    entity: { kind: 'broadcast', id: U, name: 'Spring offer' },
  }),
];

const SUMMARY: MessageHistorySummary = {
  window: { from: '2026-09-13T00:00:00.000Z', to: '2026-10-13T00:00:00.000Z' },
  total: 1234,
  sent: 800,
  received: 400,
  failed: 34,
  queued: 3,
  delivered: 700,
  read: 500,
  sentPct: 65,
  receivedPct: 32,
  failPct: 4.3,
  deliveryRate: 91.2,
  deltaPct: -12,
  avgFirstResponseSeconds: 200,
  dirCounts: { all: 1234, out: 834, in: 400, fail: 34 },
  cost: [{ currency: 'USD', minor: 1250, messages: 10 }],
};

const INSIGHTS: MessageHistoryInsights = {
  bucket: 'daily',
  tz: 'UTC',
  volume: [
    { at: '2026-10-12T00:00:00.000Z', sent: 4, received: 2, failed: 1 },
    { at: '2026-10-13T00:00:00.000Z', sent: 6, received: 3, failed: 0 },
  ],
  typeMix: { text: 9, autoReply: 1, campaign: 2, broadcast: 3, scheduled: 0, media: 1 },
  topConversations: [
    { conversationId: U, name: 'Asha Mine', messages: 7, lastAt: '2026-10-13T10:05:00.000Z' },
  ],
};

const DETAIL: MessageHistoryDetail = {
  ...ROWS[1]!,
  body: 'The whole text of the failed message, longer than forty characters.',
  providerMessageId: 'wamid.X',
  sender: { kind: 'agent', name: 'Admin Person' },
  language: null,
  timeline: [
    {
      event: 'failed',
      at: '2026-10-13T10:05:09.000Z',
      source: 'provider',
      providerMessageId: 'wamid.X',
      errorCode: '131049',
      errorMessage: '#131049 not delivered',
      attempt: null,
      byUserId: null,
      applied: true,
      replayed: null,
      detail: {},
    },
  ],
  fromArchive: true,
  logExpired: false,
};

const state = vi.hoisted(() => ({
  search: '',
  perms: new Set<string>(),
  feed: { rows: [] as unknown[], pending: false, error: false },
  replace: vi.fn(),
  exportRequests: 0,
  detail: null as unknown,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: state.replace }),
  usePathname: () => '/message-history',
  useSearchParams: () => new URLSearchParams(state.search),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: (p: string) => state.perms.has(p),
  useSession: () => ({ org: { timezone: 'UTC' } }),
}));
vi.mock('@/features/channel-whatsapp-cloud', () => ({
  FailureNote: ({
    failure,
    fallback,
  }: {
    failure: { reason: string | null } | null;
    fallback: string;
  }) => <span data-testid="failure-note">{failure?.reason ?? fallback}</span>,
}));
vi.mock('@/features/team-inbox-conversations', () => ({
  MessageLogTimeline: ({ events }: { events: unknown[] }) => (
    <ol data-testid="timeline">{events.length}</ol>
  ),
}));
vi.mock('../api/history', () => ({
  downloadHistoryExport: vi.fn(),
  useChannelOptions: () => ({ data: { data: [{ id: U, name: 'Main' }] } }),
  useHistoryFeed: () => ({
    data: { pages: [{ data: state.feed.rows }] },
    isPending: state.feed.pending,
    isError: state.feed.error,
    error: new Error('x'),
    hasNextPage: true,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  }),
  useHistorySummary: () => ({ data: SUMMARY, isError: false, refetch: vi.fn() }),
  useHistoryInsights: () => ({ data: INSIGHTS, isError: false, refetch: vi.fn() }),
  useHistoryDetail: () => ({
    data: state.detail,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useHistoryExports: () => ({
    isPending: false,
    data: {
      data: [
        {
          id: U,
          kind: 'messages',
          status: 'ready',
          from: '2026-10-01',
          to: '2026-10-13',
          messageStatus: null,
          rowCount: 42,
          fileBytes: 100,
          error: null,
          requestedAt: '2026-10-13T10:00:00.000Z',
          completedAt: '2026-10-13T10:01:00.000Z',
          expiresAt: '2026-10-20T10:01:00.000Z',
          emailedTo: 'a@b.test',
        },
      ],
    },
  }),
  useRequestHistoryExport: () => ({
    isPending: false,
    mutateAsync: async () => {
      state.exportRequests += 1;
      return { emailedTo: 'a@b.test' };
    },
  }),
}));

import { MessageHistoryScreen } from './message-history-screen';

const messages = (locale: string) =>
  JSON.parse(
    readFileSync(join(__dirname, `../../../../messages/${locale}/message-history.json`), 'utf8'),
  ) as Record<string, unknown>;

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
  };
  state.search = '';
  state.perms = new Set(['inbox.logs.export', 'record.contacts.read']);
  state.feed = { rows: ROWS, pending: false, error: false };
  state.exportRequests = 0;
  state.detail = null;
  state.replace.mockClear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function show(locale: string) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale={locale} messages={messages(locale)} timeZone="UTC">
        <ToastProvider dismissLabel="x">
          <MessageHistoryScreen />
        </ToastProvider>
      </NextIntlClientProvider>,
    );
  });
}

const text = () => host.textContent ?? '';

describe('Message History (en)', () => {
  it('shows the cards, the table with masked numbers, the retention note and the filters', () => {
    show('en');
    expect(text()).toContain('Message history');
    expect(host.querySelector('[data-testid="kpi-total"]')?.textContent).toContain('1,234');
    expect(host.querySelector('[data-testid="kpi-total"]')?.textContent).toContain(
      '-12% vs last period',
    );
    expect(host.querySelector('[data-testid="kpi-failed"]')?.textContent).toContain('4.3%');
    expect(host.querySelector('[data-testid="kpi-response"]')?.textContent).toContain('3m 20s');
    expect(host.querySelector('[data-testid="kpi-rate"]')?.textContent).toContain('91.2%');
    expect(host.querySelector('[data-testid="kpi-cost"]')?.textContent).toContain('$12.50');
    const rows = host.querySelectorAll('[data-testid="history-row"]');
    expect(rows).toHaveLength(3);
    expect(rows[0]!.textContent).toContain('•••••••5678');
    expect(rows[0]!.textContent).toContain('Inbound');
    expect(rows[1]!.textContent).toContain('Failed');
    expect(rows[2]!.textContent).toContain('Broadcast · Spring offer');
    expect(host.querySelector('[data-testid="retention-note"]')?.textContent).toContain('90 days');
    expect(host.querySelector('[data-testid="retention-note"]')?.textContent).toContain('365 days');
    expect(text()).toContain('Load more');
  });

  it('marks customer-written text so the help assistant leaves it out', () => {
    show('en');
    const marked = [...host.querySelectorAll('[data-agent-ignore]')].map((e) => e.textContent);
    expect(marked).toContain('Hello I need help with my order number 1…');
    expect(marked).toContain('Asha Mine');
  });

  it('each row links to its source: the conversation or the broadcast', () => {
    show('en');
    const links = [...host.querySelectorAll('[data-testid="history-row"] a')].map((a) =>
      a.getAttribute('href'),
    );
    expect(links).toEqual([`/inbox?c=${U}`, `/inbox?c=${U}`, `/broadcasts/${U}`]);
  });

  it('opening a row writes it to the address', () => {
    show('en');
    act(() => {
      (host.querySelectorAll('[data-testid="history-row"]')[1] as HTMLElement).click();
    });
    expect(state.replace).toHaveBeenCalledTimes(1);
    expect(state.replace.mock.calls[0]![0]).toContain('open=m%3A1b6f6c2e');
  });

  it('opens the drawer from the address: the whole text, the failure and the delivery steps', () => {
    state.search = `open=m:${U.replace('0b6f', '1b6f')}`;
    state.detail = DETAIL;
    show('en');
    const drawer = host.querySelector('[data-testid="history-drawer"]')!;
    expect(drawer.querySelector('[data-testid="drawer-body"]')?.textContent).toContain(
      'longer than forty characters',
    );
    expect(
      drawer.querySelector('[data-testid="drawer-body"]')?.hasAttribute('data-agent-ignore'),
    ).toBe(true);
    expect(drawer.querySelector('[data-testid="failure-note"]')?.textContent).toContain('#131049');
    expect(drawer.querySelector('[data-testid="timeline"]')?.textContent).toBe('1');
    expect(drawer.textContent).toContain('events older than 90 days');
  });

  it('offers the export only to a person who may export, and lists the exports with a download', () => {
    show('en');
    expect(text()).toContain('Export CSV');
    expect(host.querySelector('[data-testid="history-exports"]')?.textContent).toContain(
      '42 messages',
    );
    expect(host.querySelector('[data-testid="history-exports"]')?.textContent).toContain(
      'Download',
    );
    act(() => root.unmount());
    root = createRoot(host);
    state.perms = new Set();
    show('en');
    expect(text()).not.toContain('Export CSV');
    expect(host.querySelector('[data-testid="history-exports"]')).toBeNull();
  });

  it('says which period is empty, and says so differently when a filter is the reason', () => {
    state.feed = { rows: [], pending: false, error: false };
    show('en');
    expect(text()).toContain('No messages in the last 30 days');
    act(() => root.unmount());
    root = createRoot(host);
    state.search = 'q=zzz';
    show('en');
    expect(text()).toContain('No messages match these filters');
  });

  it('shows the loading and the error states', () => {
    state.feed = { rows: [], pending: true, error: false };
    show('en');
    expect(text()).toContain('Loading messages');
    act(() => root.unmount());
    root = createRoot(host);
    state.feed = { rows: [], pending: false, error: true };
    show('en');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Something went wrong');
  });
});

describe('Message History (ar)', () => {
  it('renders the same screen in Arabic with no English left in the chrome', () => {
    show('ar');
    const ar = messages('ar') as {
      'message-history': { title: string; kpi: { total: string; failed: string } };
    };
    expect(text()).toContain(ar['message-history'].title);
    expect(host.querySelector('[data-testid="kpi-total"]')?.textContent).toContain(
      ar['message-history'].kpi.total,
    );
    expect(host.querySelector('[data-testid="kpi-failed"]')?.textContent).toContain(
      ar['message-history'].kpi.failed,
    );
    expect(host.querySelectorAll('[data-testid="history-row"]')).toHaveLength(3);
    expect(text()).not.toContain('Message history');
    expect(text()).not.toContain('Load more');
    expect(text()).not.toMatch(/message-history\./);
  });

  it('uses logical properties, never left/right, so the layout mirrors', () => {
    show('ar');
    const bad = [...host.querySelectorAll('*')].filter((e) =>
      /(^|\s)(ml|mr|pl|pr|left|right|text-left|text-right)-/.test(e.getAttribute('class') ?? ''),
    );
    expect(bad.map((e) => e.getAttribute('class'))).toEqual([]);
  });
});
