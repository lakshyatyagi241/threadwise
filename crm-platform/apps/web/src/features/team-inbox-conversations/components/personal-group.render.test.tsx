import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { id, message, outbound } from '../lib/fixtures';
import type { PendingSend } from '../lib/thread';
import { Composer } from './composer';
import { MentionList } from './mention-picker';
import { MessageBubble, PendingBubble } from './message-bubble';

const messages = JSON.parse(
  readFileSync(join(process.cwd(), 'messages', 'en', 'team-inbox-conversations.json'), 'utf8'),
) as Record<string, unknown>;

const html = (el: ReactElement) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      {el}
    </NextIntlClientProvider>,
  );

const noop = () => undefined;
const DISABLED_TEXTAREA = /<textarea[^>]*\sdisabled=""/;

describe('the composer of a group on a personal number', () => {
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
        groupMentions={{ search: () => Promise.resolve([]) }}
        {...over}
      />,
    );

  it('is a normal composer: typing, attaching and sending work, and no member list is open until an @ is typed', () => {
    const out = composer();
    expect(out).not.toMatch(DISABLED_TEXTAREA);
    expect(out).toContain('inbox-file-input');
    expect(out).toContain('Enter sends');
    expect(out).not.toContain('inbox-group-send-unavailable');
    expect(out).not.toContain('inbox-mention-list');
  });

  it('is switched off, with the box disabled, when the thread is read-only (the screen passes replyDisabled)', () => {
    const out = composer({ replyDisabled: true });
    expect(out).toMatch(DISABLED_TEXTAREA);
    expect(out).toContain('Replies are turned off for this conversation');
    expect(out).toMatch(/<button[^>]*data-testid="inbox-send"[^>]*\sdisabled=""/);
  });
});

describe('the member list of the @mention picker', () => {
  const draw = (items: Parameters<typeof MentionList>[0]['items'], loading = false) =>
    html(<MentionList items={items} loading={loading} active={0} onPick={noop} />);

  it('lists the members by name with their number, the first one active', () => {
    const out = draw([
      { jid: '1@s.whatsapp.net', name: 'Asha Verma', phone: '+919900000001' },
      { jid: '2@s.whatsapp.net', name: null, phone: '+919900000002' },
    ]);
    expect(out).toContain('role="listbox"');
    expect(out).toContain('Group members');
    expect(out).toContain('Asha Verma');
    expect(out).toContain('+919900000001');
    expect(out).toContain('+919900000002');
    expect(out).toMatch(/aria-selected="true"/);
    expect((out.match(/data-testid="inbox-mention-option"/g) ?? []).length).toBe(2);
  });

  it('says it is looking, and says nobody matches', () => {
    expect(draw([], true)).toContain('Looking for members');
    expect(draw([], false)).toContain('No member matches');
  });

  it('draws a member name that looks like markup as text', () => {
    const out = draw([
      {
        jid: '3@s.whatsapp.net',
        name: '<img src=x onerror=alert(1)>',
        phone: '+919900000003',
      },
    ]);
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});

describe('messages of a personal-number group', () => {
  const bubble = (m = message(1)) =>
    html(
      <ul>
        <MessageBubble message={m} quoted={null} onRetry={() => Promise.resolve()} />
      </ul>,
    );

  it('names the member: the name with the number, the number alone, or "Group member"', () => {
    const withName = bubble(
      message(1, { group: { participant: '919900000001', senderName: 'Asha' } }),
    );
    expect(withName).toContain('Asha');
    expect(withName).toContain('919900000001');
    const numberOnly = bubble(
      message(2, { group: { participant: '919900000002', senderName: null } }),
    );
    expect(numberOnly).toContain('919900000002');
    const anonymous = bubble(
      message(3, { group: { participant: null, senderName: null, senderLid: '271828@lid' } }),
    );
    expect(anonymous).toContain('Group member');
    expect(anonymous).not.toContain('271828');
  });

  it('shows the name of a mentioned member in place of the number in the body', () => {
    const out = bubble(
      outbound(4, {
        body: 'hi @919900000001, see this',
        mentions: [{ jid: '919900000001@s.whatsapp.net', name: 'Asha Verma' }],
      }),
    );
    expect(out).toContain('hi @Asha Verma, see this');
    expect(out).not.toContain('@919900000001');
  });

  it('never draws a member name or subject-like text as markup', () => {
    const out = bubble(
      message(5, {
        body: 'hello',
        group: { participant: null, senderName: '<script>alert(1)</script>' },
      }),
    );
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('shows the names of the mentioned members on a message still being sent', () => {
    const pending: PendingSend = {
      clientMessageId: id(50),
      kind: 'text',
      body: 'ping @919900000001',
      mentions: [{ jid: '919900000001@s.whatsapp.net', name: 'Asha' }],
      media: null,
      status: 'sending',
      error: null,
      createdAt: '2026-10-02T10:00:00.000Z',
    };
    const out = html(
      <ul>
        <PendingBubble pending={pending} progress={undefined} onRetry={noop} onDismiss={noop} />
      </ul>,
    );
    expect(out).toContain('ping @Asha');
  });
});
