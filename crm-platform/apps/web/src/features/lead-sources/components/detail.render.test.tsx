import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@crm/ui';
import {
  makeSession,
  renderAccount,
} from '@/features/auth-registration-security/account/render-test-utils';
import { leadKeys } from '../api';
import { ID, event, source } from '../test-fixtures';
import type { LeadEventDetailResponse } from '@crm/contracts';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  usePathname: () => '/lead-sources',
  useSearchParams: () => new URLSearchParams(),
}));

import { EventDrawer } from './event-drawer';
import { SourceDetailPage } from './source-detail-page';
import { FirstLeadWatch, TestLeadPanel } from './test-lead-panel';
import type { RetryState } from './use-retry';

/**
 * Static renders of the source page and its parts with the real English and Arabic messages. They prove that the events show their
 * status, reason and guidance, that the stored payload is not loaded or shown until an event is opened, that permissions decide
 * which controls exist, and that a secret is never on the page. No browser: nothing here says how it looks or behaves when clicked.
 */

const LOCALES = ['en', 'ar'] as const;
const READ = { 'leads.sources.read': 'all' } as const;
const MANAGE = { ...READ, 'leads.sources.manage': 'all' } as const;
const as = (permissions: Record<string, 'all'>) => ({ session: makeSession({ permissions }) });

const page = (data: ReturnType<typeof event>[]) => ({
  pages: [{ data, page: { nextCursor: null, hasMore: false, limit: 25 } }],
  pageParams: [undefined],
});

const events = [
  event({
    id: ID(101),
    externalId: 'lead-101',
    status: 'created',
    contactId: ID(201),
    dealId: ID(301),
  }),
  event({
    id: ID(102),
    externalId: 'lead-102',
    status: 'needs_review',
    reason: 'no_contact_point',
    contactId: null,
    attempts: 2,
  }),
  event({
    id: ID(103),
    externalId: 'lead-103',
    status: 'failed',
    reason: 'internal_error',
    error: 'connection reset',
    contactId: null,
    hasPayload: false,
  }),
  event({
    id: ID(104),
    externalId: 'lead-104',
    status: 'updated',
    duplicateCount: 2,
    contactId: ID(204),
  }),
  event({
    id: ID(105),
    externalId: 'lead-105',
    status: 'created',
    isTest: true,
    contactId: ID(205),
  }),
  event({
    id: ID(106),
    externalId: 'lead-106',
    status: 'needs_review',
    reason: 'plan_limit_reached',
    contactId: null,
  }),
];

const withSource = (s = source({ needsAttention: 3 })) =>
  [
    [leadKeys.one(s.id), s],
    [leadKeys.events(s.id, 'all', 'all'), page(events)],
  ] as const;

const detail = (opts: Parameters<typeof renderAccount>[1], id = ID(1)) =>
  renderAccount(
    <ToastProvider>
      <SourceDetailPage id={id} />
    </ToastProvider>,
    opts,
  );

describe('source page: header and events', () => {
  for (const locale of LOCALES) {
    it(`shows the source, its status chip, needs-attention count and its leads in ${locale}`, () => {
      const html = detail({ locale, ...as(MANAGE), seed: [...withSource()] });
      expect(html).toContain('Zapier: Facebook lead ads');
      expect(html).toContain('data-testid="header-attention"');
      expect(html.match(/data-testid="event-row"/g)).toHaveLength(6);
    });
  }

  it('shows each lead with a status chip, a test badge, the reason in words and what to do', () => {
    const html = detail({ ...as(MANAGE), seed: [...withSource()] });
    for (const status of ['created', 'needs_review', 'failed', 'updated']) {
      expect(html).toContain(`data-status="${status}"`);
    }
    expect(html).toContain('Contact created');
    expect(html).toContain('Needs review');
    expect(html).toContain('Failed');
    expect(html).toContain('Contact updated');
    // test lead badge, once
    expect(html.match(/>Test</g)).toHaveLength(1);
    // reasons in words
    expect(html).toContain('No email or phone');
    expect(html).toContain('Processing error');
    expect(html).toContain('Contact limit reached');
    // the error text of a failed lead and its attempts and repeats
    expect(html).toContain('connection reset');
    expect(html).toContain('2 attempts');
    expect(html).toContain('Delivered again 2 times');
    // guidance
    expect(html).toContain('neither a usable email nor a phone number');
    expect(html).toContain('Upgrade your plan, then retry');
  });

  it('links a lead to its contact and deal only when it has them', () => {
    const html = detail({ ...as(MANAGE), seed: [...withSource()] });
    expect(html).toContain(`href="/contacts/${ID(201)}"`);
    expect(html).toContain(`href="/contacts/${ID(204)}"`);
    expect(html).toContain(`href="/deals/${ID(301)}"`);
    // the leads that wait have no contact: no link for them
    expect(html.match(/href="\/contacts\//g)).toHaveLength(3);
  });

  it('puts a banner above the list for the leads that wait, with the concrete advice', () => {
    const html = detail({ ...as(MANAGE), seed: [...withSource()] });
    expect(html).toContain('data-testid="needs-attention"');
    expect(html).toContain('3 leads need attention');
    expect(html).toContain('href="/account/plans"');
  });

  it('has no banner when nothing waits', () => {
    const s = source({ needsAttention: 0 });
    const html = detail({ ...as(MANAGE), seed: [...withSource(s)] });
    expect(html).not.toContain('data-testid="needs-attention"');
    expect(html).not.toContain('data-testid="header-attention"');
  });

  it('retry is offered only for a waiting lead whose payload is still stored', () => {
    const html = detail({ ...as(MANAGE), seed: [...withSource()] });
    // 102 and 106 wait with a payload; 103 failed but its payload was purged; the rest are done
    expect(html.match(/>Retry</g)).toHaveLength(2);
  });

  it('says there are no leads yet and what to do', () => {
    const s = source();
    const html = detail({
      ...as(MANAGE),
      seed: [
        [leadKeys.one(s.id), s],
        [leadKeys.events(s.id, 'all', 'all'), page([])],
      ],
    });
    expect(html).toContain('No leads yet');
    expect(html).toContain('Send a test lead or paste the URL into your tool.');
  });

  it('opens no payload with the list: the stored payload and its audit note are not on the page', () => {
    const html = detail({ ...as(MANAGE), seed: [...withSource()] });
    expect(html).not.toContain('data-testid="event-payload"');
    expect(html).not.toContain('Opening the payload is recorded in the audit log.');
    expect(html).not.toContain('Stored payload');
    // each lead has a button to open it
    expect(html.match(/>Open</g)).toHaveLength(6);
  });
});

describe('source page: connection and settings', () => {
  it('shows the token hint only, never a token, and the state of the shared secret without its value', () => {
    const html = detail({ ...as(MANAGE), seed: [...withSource()] });
    expect(html).toContain('The URL token ends in x9Qk');
    expect(html).toContain('A shared secret is set');
    expect(html).toContain('Senders must send it in the X-Webhook-Secret header.');
    expect(html).toContain('Replace');
    expect(html).toContain('Remove');
    // the secret box appears only while replacing; there is no password input with a value
    expect(html).not.toMatch(/type="password"/);
    expect(html).not.toContain('lead-hooks');
  });

  it('offers pause, rotate and delete with confirmations to a person who can manage', () => {
    const html = detail({ ...as(MANAGE), seed: [...withSource()] });
    expect(html).toContain('>Pause<');
    expect(html).toContain('>Rotate token<');
    expect(html).toContain('>Delete<');
    expect(html).toContain('The current URL stops working at once');
    expect(html).toContain('Its URL stops working and the leads it stored are deleted with it');
    expect(html).toContain('Contacts it already created stay');
    expect(html).toContain('>Save changes<');
  });

  it('offers none of the changing controls without the manage permission, and says which key is needed', () => {
    const html = detail({ ...as(READ), seed: [...withSource()] });
    expect(html).toContain('Zapier: Facebook lead ads');
    expect(html).toContain('leads.sources.manage');
    for (const label of [
      '>Pause<',
      '>Rotate token<',
      '>Delete<',
      '>Resume<',
      '>Save changes<',
      '>Retry<',
      '>Open<',
    ]) {
      expect(html, label).not.toContain(label);
    }
    expect(html).not.toContain('Send test lead');
    expect(html).not.toContain('Use the last lead we received');
    // the inputs are read only
    expect(html).toContain('id="ls-name"');
    expect(html).toMatch(/id="ls-name"[^>]*disabled=""|disabled=""[^>]*id="ls-name"/);
  });

  it('a paused source says its URL answers 404 and offers Resume instead of Pause', () => {
    const s = source({ status: 'paused', needsAttention: 0 });
    const html = detail({ ...as(MANAGE), seed: [...withSource(s)] });
    expect(html).toContain('>Resume<');
    expect(html).not.toContain('>Pause<');
    expect(html).toContain('its URL answers 404');
    // and a test lead cannot be sent
    expect(html).toContain('This source is paused. Resume it to send a test lead.');
  });

  for (const locale of LOCALES) {
    it(`a connector source says it is connected through the Marketplace and offers no token in ${locale}`, () => {
      const s = source({ kind: 'connector', tokenHint: null, hasSecret: false, needsAttention: 0 });
      const html = detail({ locale, ...as(MANAGE), seed: [...withSource(s)] });
      expect(html).toContain('data-testid="connector-note"');
      expect(html).toContain('href="/marketplace/installed"');
      expect(html).not.toContain('>Rotate token<');
      expect(html).not.toContain('id="ls-external-id"');
      expect(html).not.toContain('ls-secret-label');
      if (locale === 'en') {
        expect(html).toContain('Connected through the Marketplace');
      }
    });
  }

  it('loads, and says so, while the source is on its way', () => {
    const html = detail({ ...as(MANAGE) });
    expect(html).toContain('role="status"');
    expect(html).toContain('Loading the source');
  });

  it('names the missing permission when the role cannot read lead sources', () => {
    const html = detail({ ...as({}), seed: [...withSource()] });
    expect(html).toContain('leads.sources.read');
    expect(html).not.toContain('Zapier: Facebook lead ads');
  });
});

describe('the event drawer', () => {
  const retry = (over: Partial<RetryState> = {}): RetryState => ({
    pending: false,
    error: null,
    result: null,
    run: () => Promise.resolve(),
    reset: () => undefined,
    ...over,
  });
  const waitingEvent = events[1]!;
  const detailOf = (e: ReturnType<typeof event>, payload: Record<string, unknown> | null) =>
    ({ ...e, payload }) satisfies LeadEventDetailResponse;
  interface OpenOptions {
    seed: NonNullable<Parameters<typeof renderAccount>[1]>['seed'];
    locale?: 'en' | 'ar';
    manage?: boolean;
    retry?: RetryState;
  }
  const open = (e: ReturnType<typeof event>, o: OpenOptions) =>
    renderAccount(
      <EventDrawer
        sourceId={ID(1)}
        event={e}
        retentionDays={30}
        canManage={o.manage ?? true}
        retry={o.retry ?? retry()}
        onClose={() => undefined}
      />,
      { ...as(MANAGE), locale: o.locale, seed: o.seed },
    );

  for (const locale of LOCALES) {
    it(`says that opening the payload is audited and shows it as formatted read-only text in ${locale}`, () => {
      const html = open(waitingEvent, {
        locale,
        seed: [
          [
            leadKeys.event(ID(1), waitingEvent.id),
            detailOf(waitingEvent, { name: 'Asha', lead: { phone: '' } }),
          ],
        ],
      });
      expect(html).toContain('data-testid="event-payload"');
      expect(html).toContain('&quot;name&quot;: &quot;Asha&quot;');
      expect(html).toMatch(/<pre[^>]*data-testid="event-payload"/);
      if (locale === 'en')
        expect(html).toContain('Opening the payload is recorded in the audit log.');
    });
  }

  it('never turns payload content into markup', () => {
    const evil = { name: '<script>alert(1)</script>', note: '<img src=x onerror=alert(1)>' };
    const html = open(waitingEvent, {
      seed: [[leadKeys.event(ID(1), waitingEvent.id), detailOf(waitingEvent, evil)]],
    });
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;');
  });

  it('says the payload was purged when it is gone, and gives no retry', () => {
    const purged = event({
      id: ID(103),
      status: 'failed',
      reason: 'internal_error',
      hasPayload: false,
    });
    const html = open(purged, {
      seed: [[leadKeys.event(ID(1), purged.id), detailOf(purged, null)]],
    });
    expect(html).toContain('data-testid="payload-purged"');
    expect(html).toContain('The raw payload was purged after 30 days');
    expect(html).not.toContain('Retry this lead');
  });

  it('fetches lazily: before the payload arrives it shows a loading state, not a payload', () => {
    const html = open(waitingEvent, { seed: [] });
    expect(html).toContain('Opening the payload');
    expect(html).not.toContain('data-testid="event-payload"');
  });

  it('offers a retry for a waiting lead and shows its result afterwards', () => {
    const base = open(waitingEvent, {
      seed: [[leadKeys.event(ID(1), waitingEvent.id), detailOf(waitingEvent, { a: 1 })]],
    });
    expect(base).toContain('Retry this lead');
    expect(base).not.toContain('data-testid="retry-result"');
    const done = open(waitingEvent, {
      seed: [[leadKeys.event(ID(1), waitingEvent.id), detailOf(waitingEvent, { a: 1 })]],
      retry: retry({ result: { ...waitingEvent, status: 'created' } }),
    });
    expect(done).toContain('data-testid="retry-result"');
    expect(done).toContain('Retried. The lead is now');
    expect(done).toContain('data-status="created"');
    // the result of another event's retry is not shown here
    const other = open(waitingEvent, {
      seed: [[leadKeys.event(ID(1), waitingEvent.id), detailOf(waitingEvent, { a: 1 })]],
      retry: retry({ result: { ...waitingEvent, id: ID(999), status: 'created' } }),
    });
    expect(other).not.toContain('data-testid="retry-result"');
  });

  it('explains a retry refusal with the matching message, never the server text', async () => {
    const { ApiError } = await import('@/lib/api/errors');
    const html = renderAccount(
      <EventDrawer
        sourceId={ID(1)}
        event={waitingEvent}
        retentionDays={30}
        canManage
        retry={retry({
          error: new ApiError(409, 'LEAD_PAYLOAD_PURGED', 'raw server text', 'req-7'),
        })}
        onClose={() => undefined}
      />,
      {
        ...as(MANAGE),
        seed: [[leadKeys.event(ID(1), waitingEvent.id), detailOf(waitingEvent, { a: 1 })]],
      },
    );
    expect(html).toContain('deleted after its retention period');
    expect(html).not.toContain('Reference: req-7');
    expect(html).not.toContain('raw server text');
  });

  it('is not rendered at all without the manage permission or without an open event', () => {
    expect(open(waitingEvent, { seed: [], manage: false })).toBe('');
    const closed = renderAccount(
      <EventDrawer
        sourceId={ID(1)}
        event={null}
        retentionDays={30}
        canManage
        retry={retry()}
        onClose={() => undefined}
      />,
      { ...as(MANAGE) },
    );
    expect(closed).toBe('');
  });

  it('links to the contact and the deal the lead became', () => {
    const e = event({ id: ID(110), contactId: ID(210), dealId: ID(310) });
    const html = open(e, { seed: [[leadKeys.event(ID(1), e.id), detailOf(e, { a: 1 })]] });
    expect(html).toContain(`href="/contacts/${ID(210)}"`);
    expect(html).toContain(`href="/deals/${ID(310)}"`);
  });
});

describe('send a test lead and wait for the first lead', () => {
  it('offers a test lead, flagged as a test, to a person who can manage', () => {
    const html = renderAccount(<TestLeadPanel source={source()} canManage />, { ...as(MANAGE) });
    expect(html).toContain('Send test lead');
    expect(html).toContain('marked as a test');
    expect(html).toContain('nobody is notified');
    expect(html).toContain('Post my own payload');
  });

  it('is disabled with a reason on a paused source, and absent without the permission', () => {
    const paused = renderAccount(
      <TestLeadPanel source={source({ status: 'paused' })} canManage />,
      {
        ...as(MANAGE),
      },
    );
    expect(paused).toMatch(/<button[^>]*disabled=""[^>]*>Send test lead/);
    expect(paused).toContain('This source is paused');
    const readOnly = renderAccount(<TestLeadPanel source={source()} canManage={false} />, {
      ...as(READ),
    });
    expect(readOnly).not.toContain('>Send test lead<');
    expect(readOnly).toContain('leads.sources.manage');
  });

  it('shows that it is waiting for the first lead', () => {
    const html = renderAccount(<FirstLeadWatch sourceId={ID(1)} />, { ...as(MANAGE) });
    expect(html).toContain('Waiting for the first lead');
    expect(html).toContain('aria-live="polite"');
  });
});
