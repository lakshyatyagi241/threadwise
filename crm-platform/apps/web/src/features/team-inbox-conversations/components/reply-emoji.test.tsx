import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { id, message, outbound } from '../lib/fixtures';
import { EMOJI_GROUPS } from '../lib/emoji';
import { Composer } from './composer';
import { EmojiPicker } from './emoji-picker';
import { MessageBubble } from './message-bubble';
import { QuotePreview } from './quote-preview';
import { QUICK_REACTIONS, ReactionBar } from './reaction-bar';

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
const asyncNoop = () => Promise.resolve();

describe('reply to a message', () => {
  it('offers a Reply button only when the screen allows replying', () => {
    const m = message(1);
    const withReply = html(
      <MessageBubble message={m} quoted={null} onReply={noop} onRetry={asyncNoop} />,
    );
    const without = html(<MessageBubble message={m} quoted={null} onRetry={asyncNoop} />);
    expect(withReply).toContain('data-testid="inbox-reply"');
    expect(without).not.toContain('data-testid="inbox-reply"');
  });

  it('shows who is quoted and what they said, and links to the original', () => {
    const original = message(1, { body: 'Is the blue one in stock?' });
    const answer = outbound(2, { replyToMessageId: original.id, body: 'Yes, two left' });
    const out = html(<MessageBubble message={answer} quoted={original} onRetry={asyncNoop} />);
    expect(out).toContain('data-testid="inbox-quote"');
    expect(out).toContain('Customer');
    expect(out).toContain('Is the blue one in stock?');
    expect(out).toContain('Go to the original message');
  });

  it('still says a message is a reply when the original is not loaded', () => {
    const answer = outbound(2, { replyToMessageId: id(5) });
    const out = html(<MessageBubble message={answer} quoted={null} onRetry={asyncNoop} />);
    expect(out).toContain('data-testid="inbox-quote"');
    expect(out).toContain('Original message');
    expect(out).not.toContain('Go to the original message');
  });

  it('names the kind of a quoted attachment that has no text', () => {
    const photo = message(1, {
      kind: 'image',
      body: null,
      media: { url: '', mime: 'image/jpeg', sizeBytes: 10, name: null },
    });
    expect(html(<QuotePreview message={photo} variant="bubble" />)).toContain('Photo');
    const voice = message(2, { kind: 'voice', body: null });
    expect(html(<QuotePreview message={voice} variant="bubble" />)).toContain('Voice message');
    const loc = message(3, { kind: 'location', body: null });
    expect(html(<QuotePreview message={loc} variant="bubble" />)).toContain('Location');
  });

  it('names an agent as the author of a quoted outbound message, "You" when nameless', () => {
    const named = outbound(1, { body: 'On it' });
    expect(html(<QuotePreview message={named} variant="bubble" />)).toContain('Nikhil');
    const bot = outbound(2, { body: 'Hi', sender: { kind: 'bot', userId: null, name: null } });
    expect(html(<QuotePreview message={bot} variant="bubble" />)).toContain('You');
  });

  it('shows what the next send answers above the composer, with a way to cancel', () => {
    const out = html(
      <Composer
        conversationId={id(1)}
        mode="reply"
        onMode={noop}
        replyDisabled={false}
        canReply
        canNote
        canAttach
        replyTo={message(1, { body: 'Where is my order?' })}
        onCancelReply={noop}
        onSend={noop}
        onNote={() => Promise.resolve(true)}
      />,
    );
    expect(out).toContain('data-testid="inbox-reply-bar"');
    expect(out).toContain('Replying to Customer');
    expect(out).toContain('Where is my order?');
    expect(out).toContain('data-testid="inbox-reply-cancel"');
  });

  it('shows no reply bar on the internal note tab', () => {
    const out = html(
      <Composer
        conversationId={id(1)}
        mode="note"
        onMode={noop}
        replyDisabled={false}
        canReply
        canNote
        canAttach
        replyTo={message(1)}
        onSend={noop}
        onNote={() => Promise.resolve(true)}
      />,
    );
    expect(out).not.toContain('data-testid="inbox-reply-bar"');
  });
});

describe('emoji', () => {
  it('puts an emoji button in the reply box', () => {
    const out = html(
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
      />,
    );
    expect(out).toContain('data-testid="inbox-emoji-button"');
  });

  it('lists the first group and its tabs, each emoji a labelled button', () => {
    const out = html(<EmojiPicker onPick={noop} onClose={noop} />);
    expect(out).toContain('data-testid="inbox-emoji-panel"');
    expect(out).toContain('role="tablist"');
    expect(out).toContain('aria-label="😀"');
    expect(out).toContain('Smileys');
  });

  it('has no duplicate emoji within a group', () => {
    for (const g of EMOJI_GROUPS) expect(new Set(g.emoji).size).toBe(g.emoji.length);
  });

  it('renders emoji in a message body untouched', () => {
    const out = html(
      <MessageBubble
        message={message(1, { body: 'Thanks 🙏🔥' })}
        quoted={null}
        onRetry={asyncNoop}
      />,
    );
    expect(out).toContain('Thanks 🙏🔥');
  });
});

describe('reacting to a message', () => {
  const bubble = (m: ReturnType<typeof message>, extra: Record<string, unknown> = {}) =>
    html(<MessageBubble message={m} quoted={null} onRetry={asyncNoop} {...extra} />);

  it('offers React on a customer message when reacting is allowed, and not otherwise', () => {
    expect(bubble(message(1), { onReact: asyncNoop })).toContain('data-testid="inbox-react"');
    expect(bubble(message(1))).not.toContain('data-testid="inbox-react"');
  });

  it('offers React on our message only once the provider accepted it', () => {
    const queued = outbound(2, { status: 'queued' });
    const sent = outbound(3, { status: 'delivered' });
    expect(bubble(queued, { onReact: asyncNoop })).not.toContain('data-testid="inbox-react"');
    expect(bubble(sent, { onReact: asyncNoop })).toContain('data-testid="inbox-react"');
  });

  it("shows the emoji the team put on it, apart from the customer's", () => {
    const out = bubble(message(1, { reaction: '😂' }), {
      onReact: asyncNoop,
      agentReaction: { emoji: '👍', messageId: id(9), status: 'sent' },
    });
    expect(out).toContain('data-testid="inbox-customer-reaction"');
    expect(out).toContain('data-testid="inbox-agent-reaction"');
    expect(out).toContain('Your reaction 👍. Take it back');
  });

  it('says a reaction was not sent, and cannot be tapped to take back', () => {
    const out = bubble(message(1), {
      onReact: asyncNoop,
      agentReaction: { emoji: '👍', messageId: id(9), status: 'failed' },
    });
    expect(out).toContain('This reaction was not sent');
    expect(out).toMatch(/<button[^>]*data-testid="inbox-agent-reaction"[^>]*\sdisabled=""/);
  });

  it('lists the quick reactions and marks the one in place', () => {
    const out = html(<ReactionBar current="❤️" onPick={noop} onClose={noop} />);
    for (const e of QUICK_REACTIONS) expect(out).toContain(e);
    expect(out).toContain('aria-pressed="true"');
    expect(out).toContain('Remove your ❤️ reaction');
  });
});
