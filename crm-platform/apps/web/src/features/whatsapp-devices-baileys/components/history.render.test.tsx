import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NOT_REQUESTED_STATUS, type HistoryImportStatus } from '@crm/contracts';
import { ToastProvider } from '@crm/ui';
import { loadMessages } from '@/i18n/messages';

const state = vi.hoisted(() => ({
  query: { data: undefined as unknown, isPending: false, isError: false },
}));
vi.mock('../api/history', () => ({
  useHistoryImport: () => state.query,
  useCancelHistoryImport: () => ({ mutate: () => undefined, isPending: false }),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/devices/x',
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
}));

import { HistoryChoice } from './history-choice';
import { HistoryImportCard } from './history-import-card';
import { ResultStep } from './wizard-steps';

const render = (el: ReactElement, locale = 'en') =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={loadMessages(locale)} timeZone="UTC">
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider dismissLabel="Dismiss">{el}</ToastProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );

const status = (over: Partial<HistoryImportStatus>): HistoryImportStatus => ({
  ...NOT_REQUESTED_STATUS,
  mode: 'recent',
  windowDays: 90,
  ...over,
});
const card = (s: HistoryImportStatus, canCancel = true, locale = 'en') => {
  state.query = { data: { deviceId: 'd', status: s }, isPending: false, isError: false };
  return render(<HistoryImportCard deviceId="d" canCancel={canCancel} />, locale);
};
const en = loadMessages('en') as unknown as {
  'whatsapp-devices-baileys': { history: Record<string, Record<string, unknown>> };
};
/** The markup escapes an apostrophe; the message files do not. */
const esc = (v: unknown) => String(v).replace(/'/g, '&#x27;');
const H = en['whatsapp-devices-baileys'].history;

beforeEach(() => {
  state.query = { data: undefined, isPending: false, isError: false };
});

describe('the choice before the QR', () => {
  it('shows three options with none selected by default and the expectations only after opting in', () => {
    const none = render(<HistoryChoice value="none" onChange={() => undefined} />);
    expect(none).toContain('role="radiogroup"');
    expect(none).toContain(H.choice!.none as string);
    expect(none).toContain(H.choice!.recent as string);
    expect(none).toContain(H.choice!.full as string);
    expect(none).toMatch(
      /data-testid="history-none"[^>]*checked=""|checked=""[^>]*data-testid="history-none"/,
    );
    expect(none).not.toContain('data-testid="history-points"');
    const recent = render(<HistoryChoice value="recent" onChange={() => undefined} />);
    expect(recent).toContain('data-testid="history-points"');
    // the promises a person needs before scanning
    for (const k of [
      'pointQuiet',
      'pointNothingSent',
      'pointMedia',
      'pointGroups',
      'pointConsent',
      'pointLimit',
      'pointTime',
      'pointOnce',
    ]) {
      expect(recent).toContain(esc(H.choice![k]));
    }
  });

  it('the result step points to the import only when it was chosen', () => {
    const base = {
      outcome: { kind: 'connected' as const },
      phoneLabel: '+91',
      warmerHref: '/w',
      inboxHref: '/i',
    };
    expect(render(<ResultStep {...base} importHref={null} />)).not.toContain('result-import');
    const html = render(<ResultStep {...base} importHref="/devices/abc" />);
    expect(html).toContain('data-testid="result-import"');
    expect(html).toContain('href="/devices/abc"');
  });
});

describe('the full history is a plan feature', () => {
  it('without the feature the full option is shown but disabled, with a pointer to the plans', () => {
    const out = render(
      <HistoryChoice value="none" onChange={() => undefined} fullAllowed={false} />,
    );
    expect(out).toMatch(
      /data-testid="history-full"[^>]*disabled=""|disabled=""[^>]*data-testid="history-full"/,
    );
    expect(out).toContain('data-testid="history-full-locked"');
    expect(out).toContain('href="/account/plans"');
    expect(out).not.toMatch(
      /data-testid="history-recent"[^>]*disabled=""|disabled=""[^>]*data-testid="history-recent"/,
    );
    expect(out).not.toMatch(
      /data-testid="history-none"[^>]*disabled=""|disabled=""[^>]*data-testid="history-none"/,
    );
  });

  it('with the feature (or by default) no option is disabled and no hint shows', () => {
    for (const el of [
      <HistoryChoice key="a" value="none" onChange={() => undefined} fullAllowed />,
      <HistoryChoice key="b" value="none" onChange={() => undefined} />,
    ]) {
      const out = render(el);
      expect(out).not.toContain('history-full-locked');
      expect(out).not.toMatch(/disabled=""/);
    }
  });

  it('the hint is translated in Arabic', () => {
    const out = render(
      <HistoryChoice value="none" onChange={() => undefined} fullAllowed={false} />,
      'ar',
    );
    expect(out).toContain('history-full-locked');
    expect(out).not.toContain('Not part of your plan');
  });
});

describe('the card on the number page', () => {
  it('a number that never opted in says so and offers no cancel', () => {
    const html = card(NOT_REQUESTED_STATUS);
    expect(html).toContain((H.card!.body as Record<string, string>).not_requested!);
    expect(html).not.toContain('history-cancel');
    expect(html).not.toContain('history-counts');
  });

  it('a waiting run shows the empty bar and can be cancelled by someone who may pair', () => {
    const html = card(status({ state: 'idle' }));
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('history-cancel');
    expect(card(status({ state: 'idle' }), false)).not.toContain('history-cancel');
  });

  it('a running run shows counts, progress and the media note, and links to the inbox', () => {
    const html = card(
      status({ state: 'running', chats: 2, contacts: 1, messages: 40, progress: 55 }),
    );
    expect(html).toContain('aria-valuenow="55"');
    expect(html).toContain('2 chats');
    expect(html).toContain('1 contact');
    expect(html).toContain('40 messages');
    expect(html).toContain('last 90 days');
    expect(html).toContain(H.card!.mediaNote as string);
    expect(html).toContain('href="/inbox"');
  });

  it('a finished run has no cancel; a limit and a failure say why in words', () => {
    const done = card(
      status({ state: 'done', messages: 5, progress: 100, finishedAt: '2026-10-05T12:00:00.000Z' }),
    );
    expect(done).not.toContain('history-cancel');
    expect(done).toContain((H.card!.body as Record<string, string>).done!);
    const limit = card(
      status({ state: 'limit_reached', contacts: 3, lastError: { code: 'contact_limit_reached' } }),
    );
    expect(limit).toContain(esc((H.error as Record<string, string>).contact_limit_reached));
    expect(limit).toContain('data-state="limit_reached"');
    const failed = card(status({ state: 'failed', lastError: { code: 'history_not_received' } }));
    expect(failed).toContain(esc((H.error as Record<string, string>).history_not_received));
  });

  it('renders nothing while loading or when the read failed', () => {
    state.query = { data: undefined, isPending: true, isError: false };
    expect(render(<HistoryImportCard deviceId="d" canCancel />)).not.toContain('history-card');
    state.query = { data: undefined, isPending: false, isError: true };
    expect(render(<HistoryImportCard deviceId="d" canCancel />)).not.toContain('history-card');
  });

  it('is fully translated in Arabic (no raw key, an RTL language still gets the same sections)', () => {
    const html = card(
      status({ state: 'running', chats: 1, contacts: 1, messages: 3, progress: 10 }),
      true,
      'ar',
    );
    expect(html).not.toContain('whatsapp-devices-baileys.history');
    expect(html).toContain('data-testid="history-card"');
    expect(html).not.toContain(H.card!.mediaNote as string);
  });
});
