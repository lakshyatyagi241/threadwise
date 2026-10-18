import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { id, outbound } from '../lib/fixtures';
import { Composer } from './composer';
import { MessageBubble } from './message-bubble';

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

describe('composer share button', () => {
  it('is offered only when the channel carries a kind and the screen wires it', () => {
    expect(composer({ canShare: true, onShare: noop })).toContain(
      'data-testid="inbox-share-button"',
    );
    expect(composer({ canShare: false, onShare: noop })).not.toContain('inbox-share-button');
    expect(composer({ canShare: true })).not.toContain('inbox-share-button');
  });

  it('is hidden on the internal note tab', () => {
    expect(composer({ mode: 'note', canShare: true, onShare: noop })).not.toContain(
      'inbox-share-button',
    );
  });

  it('is disabled while replies are turned off (window closed)', () => {
    const out = composer({ canShare: true, onShare: noop, replyDisabled: true });
    expect(out).toMatch(/data-testid="inbox-share-button"[^>]*disabled/);
  });
});

describe('buttons we sent', () => {
  const sent = (type: 'buttons' | 'cta_url', buttons: { title: string; url: string | null }[]) =>
    outbound(3, {
      kind: 'interactive',
      body: 'Pick one',
      sentInteractive: { type, header: 'Order 42', body: 'Pick one', footer: 'Thanks', buttons },
    });

  it('draws the text and one chip per reply button', () => {
    const out = html(
      <MessageBubble
        message={sent('buttons', [
          { title: 'Yes', url: null },
          { title: 'No', url: null },
        ])}
        quoted={null}
        onRetry={asyncNoop}
      />,
    );
    expect(out).toContain('data-testid="inbox-sent-interactive"');
    expect(out).toContain('Order 42');
    expect(out).toContain('Pick one');
    expect(out).toContain('Thanks');
    expect(out.match(/data-testid="inbox-sent-button"/g)).toHaveLength(2);
  });

  it('draws a link button with its title (the url is not shown as text)', () => {
    const out = html(
      <MessageBubble
        message={sent('cta_url', [{ title: 'Open', url: 'https://x.io/p' }])}
        quoted={null}
        onRetry={asyncNoop}
      />,
    );
    expect(out.match(/data-testid="inbox-sent-button"/g)).toHaveLength(1);
    expect(out).toContain('Open');
    // The address is the link's target, never visible text.
    expect(out).toContain('href="https://x.io/p"');
    expect(out).not.toMatch(/>https:\/\/x\.io\/p</);
  });

  it('draws the button without a link when the address is not a web address', () => {
    const out = html(
      <MessageBubble
        message={sent('cta_url', [{ title: 'Open', url: 'javascript:alert(1)' }])}
        quoted={null}
        onRetry={asyncNoop}
      />,
    );
    expect(out).toContain('Open');
    expect(out).not.toContain('href=');
    expect(out).not.toContain('data-link="true"');
  });
});

describe('buttons under a message with a header image (imported history)', () => {
  it('draws the image first, then the text and every button', () => {
    const out = html(
      <MessageBubble
        message={outbound(5, {
          kind: 'image',
          body: 'This is test bot',
          media: { url: '/v2/media/t', mime: 'image/png', sizeBytes: 12000, name: 'logo.png' },
          sentInteractive: {
            type: 'buttons',
            header: null,
            body: 'This is test bot',
            footer: null,
            buttons: [
              { title: 'Welcome', url: null },
              { title: 'Feedback', url: null },
              { title: 'No more', url: null },
            ],
          },
        })}
        quoted={null}
        onRetry={asyncNoop}
      />,
    );
    expect(out).toContain('data-testid="inbox-sent-interactive"');
    expect(out.indexOf('/v2/media/t')).toBeGreaterThan(-1);
    expect(out.indexOf('/v2/media/t')).toBeLessThan(out.indexOf('This is test bot'));
    expect(out.match(/data-testid="inbox-sent-button"/g)).toHaveLength(3);
    for (const t of ['Welcome', 'Feedback', 'No more']) expect(out).toContain(t);
    // reply buttons are not links: they are drawn, not actionable
    expect(out).not.toMatch(/<a [^>]*data-testid="inbox-sent-button"/);
  });
});

describe('a list we sent', () => {
  it('draws the text, the rows by section and the button that opens it', () => {
    const out = html(
      <MessageBubble
        message={outbound(4, {
          kind: 'interactive',
          body: 'Choose a size',
          sentInteractive: {
            type: 'list',
            header: null,
            body: 'Choose a size',
            footer: null,
            buttons: [{ title: 'Sizes', url: null }],
            sections: [
              { title: 'Shirts', rows: [{ title: 'Small', description: 'Fits 6-8' }] },
              { title: null, rows: [{ title: 'Large', description: null }] },
            ],
          },
        })}
        quoted={null}
        onRetry={asyncNoop}
      />,
    );
    expect(out).toContain('Choose a size');
    expect(out).toContain('Shirts');
    expect(out).toContain('Small');
    expect(out).toContain('Fits 6-8');
    expect(out).toContain('Large');
    expect(out.match(/data-testid="inbox-sent-button"/g)).toHaveLength(1);
    expect(out).toContain('Sizes');
  });
});
