import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@crm/ui';
import { loadMessages } from '@/i18n/messages';
import { detail, summary } from '../lib/fixtures';
import { ConversationRow } from './conversation-row';
import { HandoffBar } from './handoff-bar';

vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: () => true,
}));

const NOW = Date.parse('2026-10-21T12:00:00.000Z');
const noop = () => undefined;
const html = (el: ReactElement, locale = 'en') =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider locale={locale} messages={loadMessages(locale)} timeZone="UTC">
        <ToastProvider dismissLabel="Dismiss">{el}</ToastProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );

const bar = (over: Parameters<typeof detail>[0], can = { claim: true, send: true, back: true }) =>
  html(
    <HandoffBar
      detail={detail(over)}
      nowMs={NOW}
      canClaim={can.claim}
      canSend={can.send}
      canReturn={can.back}
      onPlaced={noop}
    />,
  );

describe('HandoffBar', () => {
  it('draws nothing for a thread no handoff ever touched', () => {
    expect(bar({ handling: null })).not.toContain('inbox-handoff-bar');
    expect(bar({})).not.toContain('inbox-handoff-bar');
  });

  it('a waiting thread says so, shows how long it waited and offers Claim and Return to bot', () => {
    const out = bar({ handling: 'waiting', handlingSince: '2026-10-21T11:48:00.000Z' });
    expect(out).toContain('data-testid="inbox-handoff-bar"');
    expect(out).toContain('data-handling="waiting"');
    expect(out).toContain('Waiting for a person');
    expect(out).toContain('12m');
    expect(out).toContain('data-testid="inbox-claim"');
    expect(out).toContain('data-testid="inbox-return-to-bot"');
  });

  it('hides Claim when somebody holds the thread or the viewer may not claim', () => {
    const held = bar({
      handling: 'waiting',
      assignment: { user: { id: 'u1', name: 'Ben' }, team: null, aiAgent: null },
    });
    expect(held).not.toContain('data-testid="inbox-claim"');
    const noRight = bar({ handling: 'waiting' }, { claim: false, send: false, back: false });
    expect(noRight).not.toContain('data-testid="inbox-claim"');
    expect(noRight).not.toContain('data-testid="inbox-return-to-bot"');
  });

  it('a thread the bot answers offers Send to queue only to people who may assign', () => {
    expect(bar({ handling: 'with_bot' })).toContain('data-testid="inbox-send-to-queue"');
    expect(bar({ handling: 'with_bot' }, { claim: true, send: false, back: true })).not.toContain(
      'data-testid="inbox-send-to-queue"',
    );
    expect(bar({ handling: 'with_bot' })).toContain('The bot is answering');
  });

  it('speaks Arabic', () => {
    const out = html(
      <HandoffBar
        detail={detail({ handling: 'waiting' })}
        nowMs={NOW}
        canClaim
        canSend
        canReturn
        onPlaced={noop}
      />,
      'ar',
    );
    expect(out).toContain('data-handling="waiting"');
    expect(out).not.toContain('Waiting for a person');
  });
});

describe('the Waiting chip of a conversation row', () => {
  const row = (over: Parameters<typeof summary>[0]) =>
    html(
      <ConversationRow
        row={summary(over)}
        active={false}
        nowMs={NOW}
        onOpen={noop}
        showChannel={false}
      />,
    );

  it('shows the wait in place of "Unassigned" for a thread in the queue', () => {
    const out = row({ handling: 'waiting', handlingSince: '2026-10-21T10:00:00.000Z' });
    expect(out).toContain('data-testid="inbox-row-waiting"');
    expect(out).toContain('Waiting 2h');
    expect(out).not.toContain('Unassigned');
  });

  it('a held thread shows the person, and an untouched one the usual Unassigned chip', () => {
    expect(row({ handling: null })).toContain('Unassigned');
    expect(row({ handling: null })).not.toContain('inbox-row-waiting');
  });
});
