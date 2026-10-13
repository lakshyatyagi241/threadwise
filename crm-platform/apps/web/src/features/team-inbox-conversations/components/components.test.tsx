import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { MessageResponse } from '@crm/contracts';
import { detail, id, message, note, outbound, summary } from '../lib/fixtures';
import { DEFAULT_FILTERS, EMPTY_COUNTS, EMPTY_LIST, listReducer } from '../lib/list';
import { Composer } from './composer';
import { ConversationList } from './conversation-list';
import { ConversationRow, lastWasOutbound } from './conversation-row';
import { MessageBubble, NoteBubble, PendingBubble } from './message-bubble';
import { Ticks } from './parts';
import { LocationCard } from './media';

const messages = JSON.parse(
  readFileSync(join(process.cwd(), 'messages', 'en', 'team-inbox-conversations.json'), 'utf8'),
) as Record<string, unknown>;

const messagesAr = JSON.parse(
  readFileSync(join(process.cwd(), 'messages', 'ar', 'team-inbox-conversations.json'), 'utf8'),
) as Record<string, unknown>;

const html = (el: ReactElement) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        {el}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );

/** The attribute, not the `disabled:` utility classes every textarea carries. */
const DISABLED_TEXTAREA = /<textarea[^>]*\sdisabled=""/;

const NOW = Date.parse('2026-10-02T12:00:00.000Z');
const noop = () => undefined;
const asyncNoop = () => Promise.resolve();

describe('ConversationRow', () => {
  const row = (over = {}) =>
    html(
      <ul>
        <ConversationRow
          row={summary(over)}
          active={false}
          nowMs={NOW}
          showChannel={false}
          onOpen={noop}
        />
      </ul>,
    );

  it('shows the name, the preview and the unread badge', () => {
    const out = row({ unreadCount: 3, preview: 'Can I get a refund?' });
    expect(out).toContain('Asha Verma');
    expect(out).toContain('Can I get a refund?');
    expect(out).toContain('data-testid="inbox-unread-badge"');
    expect(out).toContain('3 unread messages');
  });

  it('says who spoke last and marks an unassigned conversation', () => {
    const out = row({
      lastOutboundAt: '2026-10-02T11:00:00.000Z',
      lastInboundAt: '2026-10-02T10:00:00.000Z',
    });
    expect(out).toContain('You:');
    expect(out).toContain('Unassigned');
    expect(
      lastWasOutbound({
        lastInboundAt: '2026-10-02T11:00:00.000Z',
        lastOutboundAt: '2026-10-02T10:00:00.000Z',
      }),
    ).toBe(false);
  });

  it('shows the window chip only when it matters', () => {
    expect(row({ windowExpiresAt: '2026-10-02T13:30:00.000Z' })).toContain('1h 30m left');
    expect(row({ windowExpiresAt: '2026-10-02T11:00:00.000Z' })).toContain('Window closed');
    expect(row({ windowExpiresAt: '2026-10-03T11:00:00.000Z' })).not.toContain('left');
  });

  it('marks the open conversation for assistive technology', () => {
    const out = html(
      <ul>
        <ConversationRow row={summary()} active nowMs={NOW} showChannel={false} onOpen={noop} />
      </ul>,
    );
    expect(out).toContain('aria-current="true"');
  });
});

describe('Ticks', () => {
  it('has a distinct label for each state', () => {
    const label = (s: Parameters<typeof Ticks>[0]['status']) => html(<Ticks status={s} />);
    expect(label('queued')).toContain('Sending');
    expect(label('sent')).toContain('aria-label="Sent"');
    expect(label('delivered')).toContain('aria-label="Delivered"');
    expect(label('read')).toContain('#53bdeb');
    expect(label('failed')).toContain('Not sent');
    expect(label('received')).toBe('');
  });
});

describe('MessageBubble', () => {
  const bubble = (m = message(1)) =>
    html(
      <ul>
        <MessageBubble message={m} quoted={null} onRetry={asyncNoop} />
      </ul>,
    );

  it('renders text, direction and ticks', () => {
    const out = bubble(outbound(2, { body: 'On my way', status: 'read' }));
    expect(out).toContain('On my way');
    expect(out).toContain('data-direction="out"');
    expect(out).toContain('aria-label="Read"');
  });

  it("names the member who wrote in a WhatsApp group, with their number", () => {
    const out = bubble(
      message(3, { group: { participant: '919900000001', senderName: 'Asha' } }),
    );
    expect(out).toContain('data-testid="inbox-group-author"');
    expect(out).toContain('Asha');
    expect(out).toContain('919900000001');
  });

  it('falls back to the number, then to "Group member", when WhatsApp gave no name', () => {
    expect(
      bubble(message(3, { group: { participant: '919900000002', senderName: null } })),
    ).toContain('919900000002');
    expect(bubble(message(3, { group: { participant: null, senderName: null } }))).toContain(
      'Group member',
    );
  });

  it('shows the delivery tally of a message sent to a group, and nothing before Meta reports', () => {
    const out = bubble(
      outbound(4, { status: 'delivered', groupDelivery: { deliveredTo: 4, billable: 3, free: 1 } }),
    );
    expect(out).toContain('data-testid="inbox-group-tally"');
    expect(out).toContain('Delivered to 4 members: 3 billed, 1 free');
    expect(
      bubble(outbound(4, { groupDelivery: { deliveredTo: 0, billable: 0, free: 0 } })),
    ).not.toContain('inbox-group-tally');
    expect(bubble(outbound(4))).not.toContain('inbox-group-tally');
  });

  it('shows the failure reason with a Retry button for a failed message', () => {
    const out = bubble(
      outbound(2, {
        status: 'failed',
        failure: { code: 'SIM_REJECTED', reason: 'Rejected by the provider' },
      }),
    );
    expect(out).toContain('Rejected by the provider');
    expect(out).toContain('data-testid="inbox-retry"');
  });

  it('renders an image, a document, audio and a location', () => {
    const media = (kind: 'image' | 'document' | 'audio', mime: string, name: string) =>
      bubble(
        message(3, {
          kind,
          body: null,
          media: { url: `/api/v2/media/tok-${kind}`, mime, sizeBytes: 2048, name },
        }),
      );
    expect(media('image', 'image/png', 'photo.png')).toContain('<img');
    expect(media('image', 'image/png', 'photo.png')).toContain('/api/v2/media/tok-image');
    const doc = media('document', 'application/pdf', 'invoice.pdf');
    expect(doc).toContain('invoice.pdf');
    expect(doc).toContain('2.0 KB');
    expect(media('audio', 'audio/ogg', 'v.ogg')).toContain('<audio');
    const place = html(
      <LocationCard
        location={{ latitude: 19.076, longitude: 72.8777, name: 'Office', address: 'Mumbai' }}
      />,
    );
    expect(place).toContain('Office');
    expect(place).toContain('19.07600, 72.87770');
    expect(place).toContain('rel="noopener noreferrer"');
  });

  it('shows a message with nothing to show as unavailable, not as an empty bubble', () => {
    expect(bubble(message(4, { body: null }))).toContain('Message unavailable');
  });

  it('centres a system line', () => {
    expect(bubble(message(5, { kind: 'system', body: 'Conversation reopened' }))).toContain(
      'Conversation reopened',
    );
  });
});

describe('PendingBubble and notes', () => {
  it('shows a send in flight as sending, and a failed one with retry and dismiss', () => {
    const p = {
      clientMessageId: id(1),
      kind: 'text' as const,
      body: 'Hello',
      media: null,
      status: 'sending' as const,
      error: null,
      createdAt: '2026-10-02T10:00:00.000Z',
    };
    const sending = html(
      <ul>
        <PendingBubble pending={p} progress={undefined} onRetry={noop} onDismiss={noop} />
      </ul>,
    );
    expect(sending).toContain('Hello');
    expect(sending).toContain('Sending');
    const failed = html(
      <ul>
        <PendingBubble
          pending={{ ...p, status: 'failed', error: 'NETWORK' }}
          progress={undefined}
          onRetry={noop}
          onDismiss={noop}
        />
      </ul>,
    );
    expect(failed).toContain('could not be reached');
    expect(failed).toContain('data-testid="inbox-retry-pending"');
    const closed = html(
      <ul>
        <PendingBubble
          pending={{ ...p, status: 'failed', error: 'SERVICE_WINDOW_CLOSED' }}
          progress={undefined}
          onRetry={noop}
          onDismiss={noop}
        />
      </ul>,
    );
    expect(closed).toContain('24-hour reply window');
    expect(closed).not.toContain('inbox-retry-pending');
  });

  it('draws an internal note apart from messages, with a delete button only when allowed', () => {
    const n = note(1, '2026-10-02T10:00:00.000Z');
    const withDelete = html(
      <ul>
        <NoteBubble note={n} canDelete onDelete={noop} />
      </ul>,
    );
    expect(withDelete).toContain('Internal note');
    expect(withDelete).toContain('note 1');
    expect(withDelete).toContain('Delete this note');
    const without = html(
      <ul>
        <NoteBubble note={n} canDelete={false} onDelete={noop} />
      </ul>,
    );
    expect(without).not.toContain('Delete this note');
  });
});

describe('Composer', () => {
  const composer = (over: Partial<Parameters<typeof Composer>[0]> = {}) =>
    html(
      <Composer
        conversationId={id(1)}
        mode="reply"
        onMode={noop}
        replyDisabled={false}
        canReply
        canNote
        canAttach
        onSend={noop}
        onNote={() => Promise.resolve(true)}
        {...over}
      />,
    );

  it('explains the keys and offers attach and send', () => {
    const out = composer();
    expect(out).toContain('Enter sends. Shift+Enter adds a new line.');
    expect(out).toContain('data-testid="inbox-file-input"');
    expect(out).not.toMatch(DISABLED_TEXTAREA);
  });

  it('is disabled with an explanation when the window is closed, but internal notes still work', () => {
    const closed = composer({ replyDisabled: true });
    expect(closed).toMatch(DISABLED_TEXTAREA);
    expect(closed).toContain('Replies are turned off for this conversation');
    const note = composer({ replyDisabled: true, mode: 'note' });
    expect(note).not.toMatch(DISABLED_TEXTAREA);
    expect(note).not.toContain('inbox-file-input');
  });

  it('cannot reply without the right to', () => {
    expect(composer({ canReply: false })).toMatch(DISABLED_TEXTAREA);
  });

  it('offers a template even when the window is closed, but never on a note', () => {
    const open = composer({ canTemplate: true, onTemplate: noop });
    expect(open).toContain('data-testid="inbox-template-button"');
    expect(open).toContain('Send a template');
    const closed = composer({ replyDisabled: true, canTemplate: true, onTemplate: noop });
    expect(closed).toMatch(DISABLED_TEXTAREA);
    expect(closed).toContain('data-testid="inbox-template-button"');
    expect(composer({ mode: 'note', canTemplate: true, onTemplate: noop })).not.toContain(
      'inbox-template-button',
    );
  });

  it('hides the template button when the channel cannot send one or there is no handler', () => {
    expect(composer()).not.toContain('inbox-template-button');
    expect(composer({ canTemplate: false, onTemplate: noop })).not.toContain(
      'inbox-template-button',
    );
    expect(composer({ canTemplate: true })).not.toContain('inbox-template-button');
  });
});

describe('Composer on a WhatsApp group thread (WABA_GROUP_SEND_UNAVAILABLE)', () => {
  const group = (locale: 'en' | 'ar', over: Partial<Parameters<typeof Composer>[0]> = {}) =>
    renderToStaticMarkup(
      <NextIntlClientProvider
        locale={locale}
        messages={locale === 'en' ? messages : messagesAr}
        timeZone="UTC"
      >
        <Composer
          conversationId={id(1)}
          mode="reply"
          onMode={noop}
          replyDisabled={false}
          canReply
          canNote
          canAttach
          canTemplate
          onTemplate={noop}
          groupSendBlocked
          onSend={noop}
          onNote={() => Promise.resolve(true)}
          {...over}
        />
      </NextIntlClientProvider>,
    );

  it('switches the reply box off, with the explanation, and offers no attach, template or send', () => {
    const out = group('en');
    expect(out).toMatch(DISABLED_TEXTAREA);
    expect(out).toMatch(/<button[^>]*data-testid="inbox-send"[^>]*\sdisabled=""/);
    expect(out).not.toContain('inbox-file-input');
    expect(out).not.toContain('inbox-template-button');
    expect(out).toContain('data-testid="inbox-group-send-unavailable"');
    expect(out).toContain(
      'Sending to WhatsApp groups is not available yet. Reply from the WhatsApp Business app.',
    );
    expect(out).not.toContain('Enter sends');
  });

  it('says the same in Arabic', () => {
    const out = group('ar');
    expect(out).toMatch(DISABLED_TEXTAREA);
    expect(out).toContain('الإرسال إلى مجموعات واتساب غير متاح بعد');
    expect(out).not.toContain('inbox-file-input');
    expect(out).not.toContain('inbox-template-button');
  });

  it('leaves internal notes working on a group thread', () => {
    const out = group('en', { mode: 'note' });
    expect(out).not.toMatch(DISABLED_TEXTAREA);
    expect(out).not.toContain('inbox-group-send-unavailable');
  });

  it('a normal thread is unchanged: the same props without the flag keep attach, template and the key hint', () => {
    const out = group('en', { groupSendBlocked: false });
    expect(out).not.toMatch(DISABLED_TEXTAREA);
    expect(out).toContain('inbox-file-input');
    expect(out).toContain('inbox-template-button');
    expect(out).toContain('Enter sends');
  });
});

describe('ConversationList states', () => {
  const props = (over: Partial<Parameters<typeof ConversationList>[0]> = {}) => ({
    list: listReducer(EMPTY_LIST, {
      type: 'loaded',
      rows: [],
      cursor: null,
      hasMore: false,
      counts: EMPTY_COUNTS,
    }),
    filters: DEFAULT_FILTERS,
    onFilters: vi.fn(),
    channels: [],
    channelsLoaded: true,
    activeId: null,
    nowMs: NOW,
    onOpen: noop,
    onLoadMore: noop,
    onRefresh: noop,
    searchRef: { current: null },
    canManageChannels: true,
    simulatorAvailable: false,
    onOpenSimulator: noop,
    ...over,
  });
  const render = (p: ReturnType<typeof props>) => html(<ConversationList {...p} />);

  it('the status filter offers Open first, one Resolved (no separate Closed), Pending, Snoozed, Spam and every status', () => {
    const out = render(props());
    const options = [...out.matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)].map(
      (m) => [m[1], m[2]],
    );
    const status = options.filter(([v]) =>
      ['open', 'pending', 'snoozed', 'resolved', 'closed', 'spam', 'all'].includes(v!),
    );
    expect(status.map(([v]) => v)).toEqual([
      'open',
      'pending',
      'snoozed',
      'resolved',
      'spam',
      'all',
    ]);
    expect(status[0]).toEqual(['open', 'Open']);
    expect(out).not.toContain('Open and pending');
    expect(out).not.toContain('>Closed<');
  });

  it('tells a workspace with no channel to connect one, with a link', () => {
    const out = render(props());
    expect(out).toContain('Connect a channel to start');
    expect(out).toContain('href="/inbox/channels"');
  });

  it('hides the connect button from someone who cannot manage channels', () => {
    expect(render(props({ canManageChannels: false }))).not.toContain('/inbox/channels');
  });

  it('says there are no conversations yet once a channel exists', () => {
    const out = render(props({ channels: [{ id: id(900) } as never] }));
    expect(out).toContain('No conversations yet');
  });

  it('shows the four tabs with their counts and the unread badge', () => {
    const list = listReducer(EMPTY_LIST, {
      type: 'loaded',
      rows: [summary({ unreadCount: 2 })],
      cursor: null,
      hasMore: false,
      counts: { all: 12, mine: 3, unassigned: 4, unread: 5, archived: 0 },
    });
    const out = render(props({ list }));
    for (const tab of ['all', 'mine', 'unassigned', 'unread']) {
      expect(out).toContain(`data-testid="inbox-tab-${tab}"`);
    }
    expect(out).toContain('data-testid="inbox-tab-count-all"');
    expect(out).toContain('>12<');
    expect(out).toContain('>5<');
  });

  it('says nothing matches when filters are on, and offers to clear them', () => {
    const out = render(props({ filters: { ...DEFAULT_FILTERS, q: 'zzz' } }));
    expect(out).toContain('No conversations match');
    expect(out).toContain('Clear filters');
  });

  it('shows the simulator button only when it is available', () => {
    expect(render(props())).not.toContain('inbox-simulator-open');
    expect(render(props({ simulatorAvailable: true }))).toContain('inbox-simulator-open');
  });
});

describe('detail fixture', () => {
  it('is a valid detail for the window banner tests', () => {
    expect(detail().window.open).toBe(true);
  });
});

describe('MessageBubble: a template message', () => {
  const template = (preview?: NonNullable<MessageResponse['template']>['preview']) =>
    outbound(7, {
      kind: 'template',
      body: 'Hi Ana, order A12 shipped.',
      template: {
        templateId: id(9),
        name: 'order_shipped',
        language: 'en_US',
        variables: { '1': 'Ana', '2': 'A12' },
        ...(preview ? { preview } : {}),
      },
    });
  const draw = (m: MessageResponse) =>
    html(
      <ul>
        <MessageBubble message={m} quoted={null} onRetry={asyncNoop} />
      </ul>,
    );

  it('draws the header, the filled body, the footer and each button kind as a row', () => {
    const out = draw(
      template({
        header: { format: 'text', text: 'Order update' },
        footer: 'Reply STOP to opt out',
        buttons: [
          { type: 'quick_reply', text: 'Thanks' },
          { type: 'url', text: 'Track order' },
          { type: 'phone', text: 'Call us' },
          { type: 'copy_code', text: '' },
        ],
      }),
    );
    expect(out).toContain('Template message: order_shipped');
    expect(out).toMatch(/font-semibold[^>]*>Order update</);
    expect(out).toContain('Hi Ana, order A12 shipped.');
    expect(out).toContain('Reply STOP to opt out');
    expect(out).toContain('data-button-type="quick_reply"');
    expect(out).toContain('data-button-type="url"');
    expect(out).toContain('data-button-type="phone"');
    expect(out).toContain('data-button-type="copy_code"');
    expect(out).toContain('Track order');
    expect(out).toContain('Copy code');
    // A screen reader hears "Button: <text>" for each row, and the rows are not controls.
    expect(out.match(/Button: <\/span>/g)).toHaveLength(4);
    expect(out).not.toContain('<button');
    // Logical properties only, so the bubble mirrors in a right-to-left page.
    expect(out).not.toMatch(/\b(ml|mr|pl|pr|left|right)-\d/);
    // Order: header, body, footer, buttons.
    const at = (s: string) => out.indexOf(s);
    expect(at('Order update')).toBeLessThan(at('Hi Ana'));
    expect(at('Hi Ana')).toBeLessThan(at('Reply STOP'));
    expect(at('Reply STOP')).toBeLessThan(at('Thanks'));
  });

  it('marks a media header by its kind, with no file', () => {
    const out = draw(
      template({ header: { format: 'video', text: null }, footer: null, buttons: [] }),
    );
    expect(out).toContain('data-format="video"');
    expect(out).toContain('>Video<');
    expect(out).not.toContain('<img');
    expect(out).not.toContain('inbox-template-buttons');
  });

  it('falls back to the name and the stored body when the template is gone', () => {
    const out = draw(template());
    expect(out).toContain('Template message: order_shipped');
    expect(out).toContain('Hi Ana, order A12 shipped.');
    expect(out).not.toContain('inbox-template-buttons');
    expect(out).not.toContain('inbox-template-footer');
  });

  it('shows the values when no body text was stored', () => {
    const m = template();
    expect(draw({ ...m, body: null })).toContain('Ana · A12');
  });
});
