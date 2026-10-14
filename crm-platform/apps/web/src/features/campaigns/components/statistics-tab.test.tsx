import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CampaignStatistics } from '@crm/contracts';
import { loadMessages } from '@/i18n/messages';
import { KEYS } from '../api/campaigns';
import { StatisticsTab } from './statistics-tab';

const ID = '00000000-0000-4000-8000-000000000001';
const counts = { recipients: 10, sent: 7, delivered: 5, read: 3, failed: 1, replies: 1, clicks: 0 };
const stats = (over: Partial<CampaignStatistics> = {}): CampaignStatistics => ({
  status: 'running',
  inFlight: true,
  total: 10,
  breakdown: [
    { key: 'queued', count: 3, pct: 30 },
    { key: 'pending', count: 0, pct: 0 },
    { key: 'sent', count: 2, pct: 20 },
    { key: 'delivered', count: 2, pct: 20 },
    { key: 'read', count: 2, pct: 20 },
    { key: 'responded', count: 0, pct: 0 },
    { key: 'failed', count: 1, pct: 10 },
    { key: 'unsubscribed', count: 0, pct: 0 },
    { key: 'skipped', count: 0, pct: 0 },
  ],
  counts,
  rates: { delivered: 50, read: 60, replies: 10, clicks: 0, failed: 10 },
  lifecycle: {
    createdAt: '2026-10-14T08:00:00.000Z',
    scheduledFor: { date: '2026-10-14', time: '09:30:00', timezone: 'Asia/Kolkata' },
    firstSentAt: '2026-10-14T09:30:05.000Z',
    lastRunAt: '2026-10-14T09:30:00.000Z',
    completedAt: null,
  },
  fetchedAt: '2026-10-14T10:00:00.000Z',
  ...over,
});

function render(data: CampaignStatistics | undefined) {
  const qc = new QueryClient();
  if (data) qc.setQueryData([...KEYS.detail(ID), 'statistics'], data);
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={loadMessages('en')} timeZone="UTC">
      <QueryClientProvider client={qc}>
        <StatisticsTab id={ID} />
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

describe('the Statistics tab', () => {
  it('shows where everyone is, only the statuses somebody holds, each with its share of the audience', () => {
    const out = render(stats());
    expect(out).toContain('Where everyone is now');
    expect(out).toContain('Each of the 10 recipients is counted once');
    expect(out).toContain('Queued · 30.0%');
    expect(out).toContain('Failed · 10.0%');
    expect(out).not.toContain('Replied ·');
    expect(out).not.toContain('Sending ·');
  });

  it('shows the funnel rates', () => {
    const out = render(stats());
    expect(out).toContain('Delivery rate');
    expect(out).toContain('50.0%');
    expect(out).toContain('of delivered');
  });

  it('shows the timeline, the date it was set for in its own zone, and "Not yet" for what has not happened', () => {
    const out = render(stats());
    expect(out).toContain('Set to start');
    expect(out).toContain('2026-10-14 09:30 (Asia/Kolkata)');
    expect(out).toContain('First message sent');
    expect(out).toContain('Finished');
    expect(out).toContain('Not yet');
  });

  it('says whether it is following live or shows final numbers, with when it was read', () => {
    expect(render(stats())).toContain('Following live');
    const rest = render(stats({ inFlight: false, status: 'completed' }));
    expect(rest).toContain('Final numbers');
    expect(rest).not.toContain('Following live');
    expect(rest).toMatch(/Updated \d/);
  });

  it('a campaign with nobody in it says so', () => {
    expect(render(stats({ total: 0, breakdown: [] }))).toContain('has no recipients yet');
  });
});
