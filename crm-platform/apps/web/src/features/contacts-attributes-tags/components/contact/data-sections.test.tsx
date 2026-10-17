import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  CallLogRow,
  ContactDealsResponse,
  ConversationSummary,
  FieldHistoryEntry,
  SessionResponse,
} from '@crm/contracts';
import { SessionProvider } from '@/features/auth-registration-security/shared/session-context';
import { ApiError } from '@/lib/api/errors';
import { DEALS_KEY } from '../../api/deals';
import { contactConversationsKey, fetchContactConversations } from '../../api/conversations';
import { FIELD_HISTORY_KEY } from '../../api/field-history';
import { contactCallsKey, contactOpenTasksKey } from '../../api/stats';
import type { ContactRow } from '../../api/schemas';
import { ConversationsSection } from './conversations-section';
import { DealsSection } from './deals-section';
import { FieldHistoryButton, FieldHistoryPanel } from './field-history';
import { StatsSection } from './stats-section';

/** Deals, conversations, field history and communication stats of a contact, rendered from a pre-seeded cache (no network). */

const MESSAGE_FILES = [
  'contacts-attributes-tags.json',
  'contacts-attributes-tags.contact-data.json',
];
type Tree = { [key: string]: string | Tree };
const merge = (a: Tree, b: Tree): Tree => {
  const out: Tree = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const cur = out[k];
    out[k] =
      typeof v === 'object' && typeof cur === 'object'
        ? merge(cur as Tree, v as Tree)
        : (v as Tree);
  }
  return out;
};
const messages = MESSAGE_FILES.map(
  (f) => JSON.parse(readFileSync(join(process.cwd(), 'messages', 'en', f), 'utf8')) as Tree,
).reduce(merge, {});

const ME = '11111111-1111-4111-8111-111111111111';
const CONTACT_ID = '294dca7c-5806-4548-9035-dcca9befc7b1';
const OTHER_ID = '99999999-9999-4999-8999-999999999999';

const session = (permissions: string[]) =>
  ({
    user: { id: ME, email: 'asha@x.test', fullName: 'Asha Rao', displayName: null },
    org: { timezone: null },
    permissions: Object.fromEntries(permissions.map((p) => [p, 'all'])),
  }) as unknown as SessionResponse;

const contact = (over: Partial<ContactRow> = {}) =>
  ({
    id: CONTACT_ID,
    displayId: null,
    name: 'Aarav Sharma',
    firstName: 'Aarav',
    lastName: null,
    email: 'aarav@example.com',
    phone: '+91 98765 43210',
    companyId: null,
    ownerId: null,
    lifecycleState: 'active',
    lifecycleStage: 'lead',
    status: null,
    leadScore: 72,
    lastActivityAt: '2026-03-06T09:30:00.000Z',
    source: null,
    customFields: {},
    isUnsubscribed: false,
    rowVersion: 4,
    createdAt: '2026-03-05T12:00:00.000Z',
    updatedAt: '2026-03-05T12:00:00.000Z',
    ...over,
  }) as unknown as ContactRow;

function render(el: ReactElement, opts: { permissions: string[]; qc?: QueryClient }) {
  const qc = opts.qc ?? new QueryClient();
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <SessionProvider session={session(opts.permissions)}>
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          {el}
        </NextIntlClientProvider>
      </SessionProvider>
    </QueryClientProvider>,
  );
}

/** Puts a query into the failed state, as if its request had been refused. */
function fail(qc: QueryClient, queryKey: readonly unknown[], error: unknown) {
  qc.getQueryCache()
    .build(qc, { queryKey })
    .setState({
      status: 'error',
      error: error as Error,
      errorUpdateCount: 1,
      errorUpdatedAt: Date.now(),
      fetchStatus: 'idle',
    });
}

// --- deals ---------------------------------------------------------------------------------------------------------------

const DEAL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DEAL_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PIPE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const STAGE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const deal = (over: Record<string, unknown>) => ({
  id: DEAL_A,
  title: 'Annual plan',
  pipeline: { id: PIPE, name: 'Sales' },
  stage: { id: STAGE, name: 'Proposal', color: '#6366f1', probability: 50, kind: 'open' },
  status: 'open',
  value: '1500.00',
  currency: 'USD',
  owner: { id: ME, name: 'Asha Rao' },
  contact: null,
  company: null,
  expectedCloseDate: '2026-04-30',
  source: 'manual',
  lostReason: null,
  lostReasonId: null,
  notes: null,
  wonAt: null,
  lostAt: null,
  rowVersion: 1,
  createdAt: '2026-03-01T10:00:00.000Z',
  updatedAt: '2026-03-01T10:00:00.000Z',
  ...over,
});

const DEALS = {
  deals: [
    deal({}),
    deal({
      id: DEAL_B,
      title: 'Starter pack',
      status: 'won',
      value: '200',
      currency: 'EUR',
      owner: null,
      expectedCloseDate: null,
      stage: { id: STAGE, name: 'Closed won', color: '#16a34a', probability: 100, kind: 'won' },
    }),
  ],
  rollup: {
    openCount: 1,
    openValue: [{ currency: 'USD', amount: '1500.00' }],
    wonCount: 1,
    wonValue: [{ currency: 'EUR', amount: '200.00' }],
  },
} as unknown as ContactDealsResponse;

describe('DealsSection', () => {
  it('shows the rollup per currency and the deals with their stage, status, value, close date and owner', () => {
    const qc = new QueryClient();
    qc.setQueryData(DEALS_KEY(CONTACT_ID), DEALS);
    const out = render(<DealsSection contact={contact()} variant="page" />, {
      permissions: ['record.deals.read'],
      qc,
    });
    expect(out).toContain('1 open deal');
    expect(out).toContain('1 won deal');
    // Each currency on its own, never added together.
    expect(out).toContain('$1,500.00');
    expect(out).toContain('€200.00');
    expect(out).toContain(`href="/deals/${DEAL_A}"`);
    expect(out).toContain(`href="/deals/${DEAL_B}"`);
    expect(out).toContain('Annual plan');
    expect(out).toContain('Proposal');
    expect(out).toContain('Closed won');
    expect(out).toContain('background-color:#6366f1');
    expect(out).toContain('>Open<');
    expect(out).toContain('>Won<');
    expect(out).toContain('Pipeline Sales');
    expect(out).toContain('Expected close Apr 30, 2026');
    expect(out).toContain('Owner Asha Rao');
  });

  it('says there are no deals when the list is empty', () => {
    const qc = new QueryClient();
    qc.setQueryData(DEALS_KEY(CONTACT_ID), {
      deals: [],
      rollup: { openCount: 0, openValue: [], wonCount: 0, wonValue: [] },
    });
    const out = render(<DealsSection contact={contact()} variant="drawer" />, {
      permissions: ['record.deals.read'],
      qc,
    });
    expect(out).toContain('No deals for this contact yet.');
    expect(out).toContain('0 open deals');
    expect(out).toContain('No value');
  });

  it('is a quiet "not available" line, not an error, when the plan has no sales pipeline (422 PLAN_FEATURE_LOCKED)', () => {
    const qc = new QueryClient();
    fail(qc, DEALS_KEY(CONTACT_ID), new ApiError(422, 'PLAN_FEATURE_LOCKED', 'locked'));
    const out = render(<DealsSection contact={contact()} variant="page" />, {
      permissions: ['record.deals.read'],
      qc,
    });
    expect(out).toContain('Deals are not available on your plan');
    expect(out).not.toContain('role="alert"');
    expect(out).not.toContain('Try again');
  });

  it('is the same line for a 403, and for a role without record.deals.read (which also asks for nothing)', () => {
    const qc = new QueryClient();
    fail(qc, DEALS_KEY(CONTACT_ID), new ApiError(403, 'FORBIDDEN', 'no'));
    expect(
      render(<DealsSection contact={contact()} variant="page" />, {
        permissions: ['record.deals.read'],
        qc,
      }),
    ).toContain('Deals are not available on your plan');
    expect(
      render(<DealsSection contact={contact()} variant="page" />, { permissions: [] }),
    ).toContain('Deals are not available on your plan');
  });

  it('shows a real failure as an error with a retry', () => {
    const qc = new QueryClient();
    fail(qc, DEALS_KEY(CONTACT_ID), new ApiError(500, 'INTERNAL', 'boom'));
    const out = render(<DealsSection contact={contact()} variant="page" />, {
      permissions: ['record.deals.read'],
      qc,
    });
    expect(out).toContain('Try again');
  });
});

// --- conversations -------------------------------------------------------------------------------------------------------

const conversation = (over: Record<string, unknown>) =>
  ({
    id: 'e0000000-0000-4000-8000-000000000001',
    channel: { id: 'f0000000-0000-4000-8000-000000000001', kind: 'whatsapp', name: 'Support line' },
    peerKey: '919876543210',
    peerName: 'Aarav',
    title: 'Aarav Sharma',
    preview: 'Can you send the invoice?',
    status: 'open',
    priority: 'normal',
    archived: false,
    pinned: false,
    muted: false,
    unreadCount: 3,
    needsContact: false,
    contact: { id: CONTACT_ID, name: 'Aarav Sharma' },
    assignment: { user: { id: ME, name: 'Asha Rao' }, team: null, aiAgent: null },
    snoozedUntil: null,
    labels: [],
    slaStatus: null,
    lastMessageAt: '2026-03-06T09:30:00.000Z',
    lastInboundAt: '2026-03-06T09:30:00.000Z',
    lastOutboundAt: '2026-03-06T09:00:00.000Z',
    lastSeq: 9,
    windowExpiresAt: null,
    createdAt: '2026-03-01T10:00:00.000Z',
    updatedAt: '2026-03-06T09:30:00.000Z',
    rowVersion: 2,
    ...over,
  }) as unknown as ConversationSummary;

const MINE = conversation({});
const SOMEONE_ELSE = conversation({
  id: 'e0000000-0000-4000-8000-000000000002',
  title: 'Priya Verma',
  peerName: 'Priya',
  preview: 'A fuzzy match on the same digits',
  contact: { id: OTHER_ID, name: 'Priya Verma' },
});
const UNLINKED = conversation({
  id: 'e0000000-0000-4000-8000-000000000003',
  title: 'Unlinked thread',
  contact: null,
});

afterEach(() => vi.unstubAllGlobals());

/** Runs the real search against a stubbed API that also returns somebody else’s thread, and returns what the hook would cache. */
async function searchedConversations() {
  const fetchMock = vi.fn(async () =>
    Response.json({
      data: [MINE, SOMEONE_ELSE, UNLINKED],
      page: { nextCursor: null, hasMore: false, limit: 100 },
      meta: { counts: { all: 3, mine: 1, unassigned: 0, unread: 1, archived: 0 } },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  const c = contact();
  const rows = await fetchContactConversations(c);
  const url = (fetchMock.mock.calls[0] as unknown as [string])[0];
  return { c, rows, url };
}

describe('ConversationsSection', () => {
  it('searches the inbox by the phone digits across every status and keeps only this contact’s threads', async () => {
    const { c, rows, url } = await searchedConversations();
    expect(url).toContain('/api/v2/inbox/conversations');
    expect(url).toContain('q=919876543210');
    expect(url).toContain('status=all');
    expect(rows.map((r) => r.id)).toEqual([MINE.id]);

    const qc = new QueryClient();
    qc.setQueryData(contactConversationsKey(c), rows);
    const out = render(<ConversationsSection contact={c} variant="page" />, {
      permissions: ['inbox.conversation.read'],
      qc,
    });
    expect(out).toContain('Aarav Sharma');
    expect(out).toContain('Support line');
    expect(out).toContain('whatsapp');
    expect(out).toContain('Can you send the invoice?');
    expect(out).toContain('3 unread messages');
    expect(out).toContain('>Open<');
    expect(out).toContain('Assigned to Asha Rao');
    expect(out).toContain('06 Mar 2026, 09:30 AM');
    expect(out).toContain(`href="/inbox?c=${MINE.id}"`);
    // Somebody else’s thread that the fuzzy search returned, and a thread with no contact, are not shown.
    expect(out).not.toContain('Priya Verma');
    expect(out).not.toContain('A fuzzy match');
    expect(out).not.toContain('Unlinked thread');
  });

  it('says none were found when nothing matches the contact', () => {
    const c = contact();
    const qc = new QueryClient();
    qc.setQueryData(contactConversationsKey(c), []);
    const out = render(<ConversationsSection contact={c} variant="drawer" />, {
      permissions: ['inbox.conversation.read'],
      qc,
    });
    expect(out).toContain('No conversations found for this contact.');
  });

  it('says the same for a contact with neither phone, e-mail nor name, without searching', () => {
    const out = render(
      <ConversationsSection
        contact={contact({ phone: null, email: null, name: null })}
        variant="page"
      />,
      { permissions: ['inbox.conversation.read'] },
    );
    expect(out).toContain('No conversations found for this contact.');
  });

  it('shows no list for a role without inbox.conversation.read', () => {
    const c = contact();
    const qc = new QueryClient();
    qc.setQueryData(contactConversationsKey(c), [MINE]);
    const out = render(<ConversationsSection contact={c} variant="page" />, {
      permissions: [],
      qc,
    });
    expect(out).toContain('No conversations found for this contact.');
    expect(out).not.toContain('Can you send the invoice?');
  });
});

// --- field history -------------------------------------------------------------------------------------------------------

const history = (over: Partial<FieldHistoryEntry>): FieldHistoryEntry => ({
  fieldKey: 'name',
  oldValue: 'Aarav',
  newValue: 'Aarav Sharma',
  actorType: 'user',
  changedByUserId: ME,
  changedAt: '2026-03-06T09:30:00.000Z',
  ...over,
});

function seedHistory(qc: QueryClient, entries: FieldHistoryEntry[], hasMore = false) {
  qc.setQueryData([...FIELD_HISTORY_KEY(CONTACT_ID), { limit: 50 }], {
    pages: [{ data: entries, page: { nextCursor: hasMore ? 'next' : null, hasMore, limit: 50 } }],
    pageParams: [undefined],
  });
}

describe('FieldHistoryPanel', () => {
  it('lists each change with the field label, old and new value, when and by whom', () => {
    const qc = new QueryClient();
    seedHistory(
      qc,
      [
        history({}),
        history({
          fieldKey: 'ownerId',
          oldValue: null,
          newValue: 'Ravi Nair',
          actorType: 'system',
          changedByUserId: null,
        }),
        history({
          fieldKey: 'customFields.lead_source',
          oldValue: { a: 1 },
          newValue: 'Webinar',
          actorType: 'api',
        }),
      ],
      true,
    );
    const out = render(<FieldHistoryPanel contactId={CONTACT_ID} />, {
      permissions: ['record.contacts.read'],
      qc,
    });
    expect(out).toContain('Contact Field History');
    expect(out).toContain('>Name<');
    expect(out).toContain('>Owner<');
    expect(out).toContain('>Lead Source<');
    expect(out).toContain('Aarav Sharma');
    expect(out).toContain('Ravi Nair');
    expect(out).toContain('{&quot;a&quot;:1}');
    // An empty old value is a dash with a spoken "empty".
    expect(out).toContain('—');
    expect(out).toContain('>empty<');
    expect(out).toContain('06 Mar 2026, 09:30 AM');
    expect(out).toContain('By a user');
    expect(out).toContain('By the system');
    expect(out).toContain('By the API');
    expect(out).toContain('Load more');
  });

  it('has no Load more on the last page, and says so when nothing was ever changed', () => {
    const qc = new QueryClient();
    seedHistory(qc, [history({})]);
    expect(
      render(<FieldHistoryPanel contactId={CONTACT_ID} showTitle={false} />, {
        permissions: ['record.contacts.read'],
        qc,
      }),
    ).not.toContain('Load more');

    const empty = new QueryClient();
    seedHistory(empty, []);
    expect(
      render(<FieldHistoryPanel contactId={CONTACT_ID} />, {
        permissions: ['record.contacts.read'],
        qc: empty,
      }),
    ).toContain('No field changes have been recorded for this contact yet.');
  });

  it('puts the history behind a "Contact Field History" button that is closed until it is pressed', () => {
    const out = render(<FieldHistoryButton contactId={CONTACT_ID} />, {
      permissions: ['record.contacts.read'],
    });
    expect(out).toContain('Contact Field History');
    expect(out).toContain('<button');
    expect(out).not.toContain('Loading the history');
  });
});

// --- communication stats -------------------------------------------------------------------------------------------------

const call = (over: Partial<CallLogRow>): CallLogRow => ({
  id: 'a1000000-0000-4000-8000-000000000001',
  direction: 'inbound',
  status: 'completed',
  customerPhone: '919876543210',
  ourPhone: '911234567890',
  contactId: CONTACT_ID,
  contactName: 'Aarav Sharma',
  numberId: null,
  numberLabel: null,
  handlerType: 'operator',
  handlerId: ME,
  handlerName: 'Asha Rao',
  startedAt: '2026-03-01T10:00:00.000Z',
  durationSec: 125,
  endReason: null,
  hasRecording: false,
  ...over,
});

function seedStats(qc: QueryClient) {
  const c = contact();
  qc.setQueryData(contactConversationsKey(c), [
    conversation({ unreadCount: 3 }),
    conversation({
      id: 'e0000000-0000-4000-8000-000000000009',
      unreadCount: 1,
      lastInboundAt: '2026-03-04T08:00:00.000Z',
      lastOutboundAt: '2026-03-07T18:45:00.000Z',
    }),
  ]);
  qc.setQueryData(contactCallsKey(c), {
    rows: [
      call({}),
      call({ id: 'a1000000-0000-4000-8000-000000000002', direction: 'outbound', durationSec: 60 }),
      call({
        id: 'a1000000-0000-4000-8000-000000000003',
        status: 'no-answer',
        durationSec: 0,
      }),
    ],
    partial: false,
  });
  qc.setQueryData(contactOpenTasksKey(CONTACT_ID), { count: 4, more: false });
  return c;
}

const ALL = ['inbox.conversation.read', 'call.logs.read', 'record.tasks.read'];

describe('StatsSection', () => {
  it('shows every tile whose source is allowed and loaded', () => {
    const qc = new QueryClient();
    const c = seedStats(qc);
    const out = render(<StatsSection contact={c} variant="page" />, { permissions: ALL, qc });
    expect(out).toContain('Communication stats');
    // conversations: 2 threads, 4 unread, latest inbound and outbound
    expect(out).toMatch(/Conversations<\/div><div[^>]*>2</);
    expect(out).toMatch(/Unread messages<\/div><div[^>]*>4</);
    expect(out).toContain('06 Mar 2026, 09:30 AM');
    expect(out).toContain('07 Mar 2026, 06:45 PM');
    // calls: 3 in all, 2 answered, 1 missed, 185 seconds = 3 minutes
    expect(out).toMatch(/>Calls<\/div><div[^>]*>3</);
    expect(out).toMatch(/Answered calls<\/div><div[^>]*>2</);
    expect(out).toMatch(/Missed calls<\/div><div[^>]*>1</);
    expect(out).toMatch(/Call minutes<\/div><div[^>]*>3</);
    expect(out).toMatch(/Open tasks<\/div><div[^>]*>4</);
    // from the contact itself
    expect(out).toMatch(/Lead score<\/div><div[^>]*>72</);
    expect(out).toContain('Last activity');
    expect(out).toContain('06 Mar 2026, 09:30 AM');
    expect(out).toContain('05 Mar 2026, 12:00 PM');
    expect(out).toContain('Message figures cover the conversations found for this contact');
    expect(out).not.toContain('More calls matched than could be read');
  });

  it('leaves out the tiles of a source the role may not read', () => {
    const qc = new QueryClient();
    const c = seedStats(qc);

    const inboxOnly = render(<StatsSection contact={c} variant="drawer" />, {
      permissions: ['inbox.conversation.read'],
      qc,
    });
    expect(inboxOnly).toContain('Unread messages');
    expect(inboxOnly).not.toContain('Answered calls');
    expect(inboxOnly).not.toContain('Open tasks');

    const none = render(<StatsSection contact={c} variant="drawer" />, { permissions: [], qc });
    expect(none).not.toContain('Unread messages');
    expect(none).not.toContain('Last message received');
    expect(none).not.toContain('Answered calls');
    expect(none).not.toContain('Open tasks');
    // What belongs to the contact is always there.
    expect(none).toContain('Lead score');
    expect(none).toContain('Last activity');
    expect(none).toContain('Created');
  });

  it('hides the call tiles when the plan refuses the call log, and warns when the call figures may be short', () => {
    const qc = new QueryClient();
    const c = seedStats(qc);
    qc.removeQueries({ queryKey: contactCallsKey(c) });
    fail(qc, contactCallsKey(c), new ApiError(402, 'PAYMENT_REQUIRED', 'plan'));
    const refused = render(<StatsSection contact={c} variant="page" />, { permissions: ALL, qc });
    expect(refused).not.toContain('Answered calls');
    expect(refused).toContain('Unread messages');

    const partial = new QueryClient();
    seedStats(partial);
    partial.setQueryData(contactCallsKey(c), { rows: [call({})], partial: true });
    expect(
      render(<StatsSection contact={c} variant="page" />, { permissions: ALL, qc: partial }),
    ).toContain('More calls matched than could be read');
  });

  it('shows "None yet" for a contact that has never had a message, and a 100+ task count as at least', () => {
    const qc = new QueryClient();
    const c = contact({ lastActivityAt: null, leadScore: null });
    qc.setQueryData(contactConversationsKey(c), []);
    qc.setQueryData(contactOpenTasksKey(CONTACT_ID), { count: 100, more: true });
    const out = render(<StatsSection contact={c} variant="page" />, {
      permissions: ['inbox.conversation.read', 'record.tasks.read'],
      qc,
    });
    expect(out).toMatch(/Conversations<\/div><div[^>]*>0</);
    expect(out).toContain('None yet');
    expect(out).toMatch(/Open tasks<\/div><div[^>]*>100\+</);
    expect(out).not.toContain('Lead score');
  });
});

describe('logical CSS only', () => {
  it('uses no physical left/right utilities', () => {
    const NO_PHYSICAL = /\b(?:ml|mr|pl|pr)-\d|\b(?:left|right)-\d|text-(?:left|right)\b/;
    const qc = new QueryClient();
    qc.setQueryData(DEALS_KEY(CONTACT_ID), DEALS);
    const c = seedStats(qc);
    seedHistory(qc, [history({})], true);
    const perms = [...ALL, 'record.deals.read', 'record.contacts.read'];
    for (const el of [
      <DealsSection key="d" contact={c} variant="page" />,
      <ConversationsSection key="c" contact={c} variant="page" />,
      <StatsSection key="s" contact={c} variant="drawer" />,
      <FieldHistoryPanel key="h" contactId={CONTACT_ID} />,
    ]) {
      expect(render(el, { permissions: perms, qc })).not.toMatch(NO_PHYSICAL);
    }
  });
});
