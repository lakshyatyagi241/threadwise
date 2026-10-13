import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { MessageLogResponse } from '@crm/contracts';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}|${JSON.stringify(values)}` : key,
  useLocale: () => 'en',
  useTimeZone: () => 'UTC',
}));
vi.mock('@/features/channel-whatsapp-cloud', () => ({
  FailureNote: ({ failure }: { failure: { code: string | null } | null }) => (
    <span data-testid="failure-note">{failure?.code}</span>
  ),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

let current: { data?: MessageLogResponse; isPending?: boolean; isError?: boolean } = {};
vi.mock('../api/message-log', () => ({
  useMessageLog: () => ({ isPending: false, isError: false, refetch: vi.fn(), ...current }),
}));

import { MessageLogDialog } from './message-log-dialog';

const at = (s: number) => `2026-10-11T15:21:${String(s).padStart(2, '0')}.000Z`;
const base = {
  source: 'system' as const,
  providerMessageId: null,
  errorCode: null,
  errorMessage: null,
  attempt: null,
  byUserId: null,
  applied: null,
  replayed: null,
  detail: {},
};

const log = (over: Partial<MessageLogResponse> = {}): MessageLogResponse => ({
  messageId: '11111111-1111-4111-8111-111111111111',
  kind: 'template',
  status: 'failed',
  providerMessageId: 'wamid.ABC',
  failureCode: 'ECOSYSTEM_ENGAGEMENT_BLOCKED',
  failureReason: 'not delivered (#131049)',
  createdAt: at(40),
  fromArchive: false,
  expired: false,
  events: [
    { ...base, event: 'queued', at: at(40) },
    { ...base, event: 'attempt', at: at(41), attempt: 1 },
    { ...base, event: 'sent', at: at(42), providerMessageId: 'wamid.ABC' },
    { ...base, event: 'sent', at: at(42), source: 'provider', applied: true },
    {
      ...base,
      event: 'failed',
      at: at(43),
      source: 'provider',
      errorCode: 'ECOSYSTEM_ENGAGEMENT_BLOCKED',
      errorMessage: 'not delivered (#131049)',
      applied: true,
    },
    { ...base, event: 'failed', at: at(44), source: 'provider', errorCode: 'LATE', applied: false },
  ],
  ...over,
});

const render = (props: { canExport?: boolean } = {}) =>
  renderToStaticMarkup(<MessageLogDialog messageId="m1" onClose={() => undefined} {...props} />);

describe('the delivery log dialog', () => {
  it('lists every step in order, with who wrote it, the error code, and the status now', () => {
    current = { data: log() };
    const html = render();
    const events = [...html.matchAll(/data-event="(\w+)" data-source="(\w+)"/g)].map(
      (m) => `${m[2]}:${m[1]}`,
    );
    expect(events).toEqual([
      'system:queued',
      'system:attempt',
      'system:sent',
      'provider:sent',
      'provider:failed',
      'provider:failed',
    ]);
    expect(html).toContain('event.accepted');
    expect(html).toContain('event.sentReceipt');
    expect(html).toContain('event.failedReceipt');
    expect(html).toContain('ECOSYSTEM_ENGAGEMENT_BLOCKED');
    expect(html).toContain('wamid.ABC');
    expect(html).toContain('data-testid="failure-note"');
  });

  it('greys a receipt that changed nothing and says why; never hides it', () => {
    current = { data: log() };
    const html = render();
    expect(html).toContain('notApplied');
    expect(html.match(/opacity-60/g)).toHaveLength(1);
  });

  it('offers the export page only to someone who may export', () => {
    current = { data: log() };
    expect(render({ canExport: true })).toContain('href="/inbox/message-logs"');
    expect(render({ canExport: false })).not.toContain('/inbox/message-logs');
  });

  it('says so when the log came from the archive, is past retention, or was never recorded', () => {
    current = { data: log({ fromArchive: true }) };
    expect(render()).toContain('archived|{&quot;days&quot;:90}');
    current = { data: log({ expired: true, events: [] }) };
    expect(render()).toContain('expired|{&quot;days&quot;:365}');
    current = { data: log({ status: 'sent', events: [] }) };
    const html = render();
    expect(html).toContain('>empty<');
    expect(html).not.toContain('data-testid="failure-note"');
  });

  it('shows the loading line and the error with a way to try again', () => {
    current = { isPending: true };
    expect(render()).toContain('loading');
    current = { isError: true };
    expect(render()).toContain('tryAgain');
  });
});
