import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { MessageResponse } from '@crm/contracts';
import { outbound } from '../lib/fixtures';
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

const asyncNoop = () => Promise.resolve();

/** A message a bot flow sent: outbound from the bot, delivered, stored as the line the flow wrote. */
const fromFlow = (seq: number, over: Partial<MessageResponse>) =>
  outbound(seq, {
    kind: 'text',
    status: 'sent',
    sender: { kind: 'bot', userId: null, name: 'Welcome flow' },
    ...over,
  });

const bubble = (m: MessageResponse) =>
  html(<MessageBubble message={m} quoted={null} onRetry={asyncNoop} />);

describe('a Buttons node the flow sent', () => {
  it('draws the question and one button per option, not the option names in brackets', () => {
    const out = bubble(
      fromFlow(1, {
        body: 'Pick one',
        sentInteractive: {
          type: 'buttons',
          header: null,
          body: 'Pick one',
          footer: null,
          buttons: [
            { title: 'Yes', url: null },
            { title: 'No', url: null },
          ],
        },
      }),
    );
    expect(out).toContain('data-testid="inbox-sent-interactive"');
    expect(out).toContain('Pick one');
    expect(out.match(/data-testid="inbox-sent-button"/g)).toHaveLength(2);
    expect(out).toContain('Yes');
    expect(out).toContain('No');
    expect(out).not.toContain('[Yes | No]');
  });
});

describe('a Carousel node the flow sent', () => {
  const carousel = fromFlow(2, {
    body: 'Our range',
    sentCarousel: {
      cards: [
        {
          title: 'Running shoes',
          text: 'Light and fast',
          image: 'https://cdn.x.io/shoe.png',
          buttons: [
            { title: 'Buy', url: null },
            { title: 'Site', url: 'https://x.io/shoes' },
          ],
        },
        { title: 'Hats', text: '', image: null, buttons: [] },
      ],
    },
  });

  it('draws the intro line, then each card in order with its picture, text and buttons', () => {
    const out = bubble(carousel);
    expect(out).toContain('data-testid="inbox-sent-carousel"');
    expect(out).toContain('Our range');
    expect(out.match(/data-testid="inbox-sent-carousel-card"/g)).toHaveLength(2);
    expect(out.indexOf('Running shoes')).toBeLessThan(out.indexOf('Hats'));
    expect(out).toContain('Light and fast');
    expect(out).toContain('src="https://cdn.x.io/shoe.png"');
    expect(out.match(/data-testid="inbox-sent-carousel-button"/g)).toHaveLength(2);
    expect(out).toContain('Buy');
    expect(out).toContain('Site');
  });

  it('links only the link button, and never shows its address as text', () => {
    const out = bubble(carousel);
    expect(out).toContain('href="https://x.io/shoes"');
    // The reply button is drawn, not actionable.
    expect(out).not.toMatch(/<a [^>]*>Buy</);
    expect(out).not.toMatch(/>https:\/\/x\.io\/shoes</);
  });

  it('drops a picture or a link whose address is not a web address', () => {
    const out = bubble(
      fromFlow(3, {
        body: '',
        sentCarousel: {
          cards: [
            {
              title: 'Mug',
              text: '',
              image: 'javascript:alert(1)',
              buttons: [{ title: 'Open', url: 'javascript:alert(2)' }],
            },
          ],
        },
      }),
    );
    expect(out).toContain('Mug');
    expect(out).toContain('Open');
    expect(out).not.toContain('javascript:');
    expect(out).not.toContain('<img');
  });
});

describe('a Media node the flow sent', () => {
  it('draws the file as the image it is, with its caption', () => {
    const out = bubble(
      fromFlow(4, {
        kind: 'image',
        body: 'Our logo',
        media: { url: '/v2/media/logo', mime: 'image/png', sizeBytes: null, name: 'logo.png' },
      }),
    );
    expect(out).toContain('src="/v2/media/logo"');
    expect(out).toContain('Our logo');
    expect(out).not.toContain('inbox-unsupported');
  });
});
