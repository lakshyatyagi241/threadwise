import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { BotReturnedLine } from './bot-returned-line';

const html = (el: ReactElement, locale = 'en') =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={loadMessages(locale)} timeZone="UTC">
      {el}
    </NextIntlClientProvider>,
  );

describe('BotReturnedLine', () => {
  it('right after the press: who gave the chat back and that the flow continues', () => {
    const out = html(
      <BotReturnedLine
        event={{ event: 'bot_returned', stage: 'pressed', by: 'Asha', resumed: 'flow' }}
        fallback={null}
      />,
    );
    expect(out).toContain('data-testid="inbox-bot-returned-line"');
    expect(out).toContain('Bot is back, returned by Asha. The flow continues.');
  });

  it('says the bot answers the next message when no flow continues now', () => {
    const live = html(
      <BotReturnedLine
        event={{
          event: 'bot_returned',
          stage: 'pressed',
          by: 'Asha',
          resumed: 'next_message',
          nextMessageBy: 'live_flow',
        }}
        fallback={null}
      />,
    );
    expect(live).toContain('It will answer the customer&#x27;s next message.');
    const none = html(
      <BotReturnedLine
        event={{ event: 'bot_returned', stage: 'pressed', by: null, resumed: 'next_message' }}
        fallback={null}
      />,
    );
    expect(none).toContain('returned by the system');
    expect(none).toContain('only if a default flow is set');
  });

  it('the result line tells what became of the flow and of the message to the customer', () => {
    const out = html(
      <BotReturnedLine
        event={{
          event: 'bot_returned',
          stage: 'result',
          result: 'continued',
          customer: 'window_closed',
        }}
        fallback={null}
      />,
    );
    expect(out).toContain('The flow continued from the &quot;returned&quot; exit.');
    expect(out).toContain('the 24 hour window is closed');
    const claimed = html(
      <BotReturnedLine
        event={{ event: 'bot_returned', stage: 'result', result: 'claimed_again' }}
        fallback={null}
      />,
    );
    expect(claimed).toContain('a person took the chat again');
  });

  it('falls back to the server text for a shape this build does not know', () => {
    const out = html(
      <BotReturnedLine
        event={{ event: 'bot_returned', stage: 'result' }}
        fallback="Bot is back (server text)"
      />,
    );
    expect(out).toContain('Bot is back (server text)');
  });
});
