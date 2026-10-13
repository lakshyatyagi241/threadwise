import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { message } from '../lib/fixtures';
import { MessageBubble } from './message-bubble';

const load = (locale: string) => {
  const read = (file: string) =>
    JSON.parse(readFileSync(join(process.cwd(), 'messages', locale, file), 'utf8')) as Record<
      string,
      unknown
    >;
  return { ...read('team-inbox-conversations.json'), ...read('contact-consent.json') };
};

const render = (locale: string, withEvent: boolean, action: 'withdrawn' | 'granted') =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={load(locale)} timeZone="UTC">
      <ul>
        <MessageBubble
          message={message(7, {
            kind: 'system',
            direction: 'in',
            body: 'Contact replied STOP: unsubscribed from marketing',
            ...(withEvent ? { systemEvent: { event: 'consent', action, keyword: 'stop' } } : {}),
          })}
        />
      </ul>
    </NextIntlClientProvider>,
  );

describe('the consent system line in the thread', () => {
  it('says the opt-out in English, with the keyword the contact typed', () => {
    const out = render('en', true, 'withdrawn');
    expect(out).toContain('data-testid="inbox-consent-line"');
    expect(out).toContain('Contact replied STOP: unsubscribed from marketing');
  });

  it('says the opt-in', () => {
    expect(render('en', true, 'granted')).toContain(
      'Contact replied STOP: resubscribed to marketing',
    );
  });

  it('is worded in the reader’s language (Arabic), not the server’s English', () => {
    const out = render('ar', true, 'withdrawn');
    expect(out).toContain('data-testid="inbox-consent-line"');
    expect(out).not.toContain('Contact replied');
    expect(out).toMatch(/[؀-ۿ]/);
    expect(out).toContain('STOP');
  });

  it('falls back to the stored text when the server sent no systemEvent (an older line)', () => {
    const out = render('en', false, 'withdrawn');
    expect(out).not.toContain('inbox-consent-line');
    expect(out).toContain('Contact replied STOP: unsubscribed from marketing');
  });
});
