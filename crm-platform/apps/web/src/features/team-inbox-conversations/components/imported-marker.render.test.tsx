import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { message, summary } from '../lib/fixtures';
import { ConversationRow } from './conversation-row';
import { MessageBubble } from './message-bubble';

const html = (el: ReactElement, locale = 'en') =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={loadMessages(locale)} timeZone="UTC">
      {el}
    </NextIntlClientProvider>,
  );
const NOW = Date.parse('2026-10-05T12:00:00Z');
const row = (imported?: boolean) =>
  html(
    <ConversationRow
      row={summary(imported === undefined ? {} : { imported })}
      active={false}
      nowMs={NOW}
      showChannel={false}
      onOpen={() => undefined}
    />,
  );
const bubble = (imported?: boolean, locale = 'en') =>
  html(
    <MessageBubble
      message={message(1, imported === undefined ? {} : { imported })}
      quoted={null}
      onRetry={() => Promise.resolve()}
    />,
    locale,
  );

describe('the imported marker of a conversation row', () => {
  it("shows a small tag with a hint and puts the word in the row's spoken label", () => {
    const out = row(true);
    expect(out).toContain('data-testid="inbox-row-imported"');
    expect(out).toContain('>Imported<');
    expect(out).toContain('title="This chat was imported from the phone&#x27;s history"');
    expect(out).toMatch(/aria-label="[^"]*Imported[^"]*"/);
  });

  it('shows nothing on a live conversation', () => {
    expect(row()).not.toContain('inbox-row-imported');
    expect(row(false)).not.toContain('inbox-row-imported');
  });
});

describe('the imported marker of a message bubble', () => {
  it('marks an imported message, with a hint, and a live one is plain', () => {
    const out = bubble(true);
    expect(out).toContain('data-testid="inbox-imported"');
    expect(out).toContain('>Imported<');
    expect(bubble()).not.toContain('inbox-imported');
  });

  it('is translated: Arabic and German read in their own words, never the English tag', () => {
    for (const l of ['ar', 'de']) {
      const out = bubble(true, l);
      expect(out).toContain('data-testid="inbox-imported"');
      expect(out).not.toContain('>Imported<');
      expect(out).not.toContain('team-inbox-conversations.bubble');
    }
  });
});
