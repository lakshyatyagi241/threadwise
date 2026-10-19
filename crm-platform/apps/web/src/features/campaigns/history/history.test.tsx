import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { WizardBroadcast, WizardHistoryRow } from '@crm/contracts';
import { html, uuid } from '../wizard/testing';
import { BroadcastHistoryScreen } from './components/history-screen';
import { RecurringBroadcastsScreen } from './components/recurring-screen';
import { ScheduledBroadcastsScreen } from './components/scheduled-screen';
import { afterLaunchPath, canCancel, highlightOf, pathForMode, rowHref } from './lib';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/campaigns/history',
  useSearchParams: () => new URLSearchParams(),
}));

const counts = {
  recipients: 120,
  sent: 118,
  delivered: 100,
  read: 0,
  replies: 0,
  clicks: 0,
  failed: 2,
};
const row = (n: number, over: Partial<WizardHistoryRow> = {}): WizardHistoryRow => ({
  id: uuid(n),
  source: 'wizard',
  type: 'now',
  name: `Offer ${n}`,
  status: 'completed',
  templateName: 'diwali_offer',
  senderLabel: '+91 98765 43210',
  seriesId: null,
  occurrence: null,
  counts,
  runAt: null,
  startedAt: '2026-10-06T06:00:00.000Z',
  finishedAt: '2026-10-06T06:05:00.000Z',
  createdAt: '2026-10-06T05:59:00.000Z',
  ...over,
});
const page = { nextCursor: null, hasMore: false, limit: 25 };
const ZONE = 'Asia/Kolkata';
const hq = { type: '', status: '', from: '', to: '', q: '', cursor: undefined };

describe('history paths and links', () => {
  it('each kind has its own page, and a launch lands there with the new id', () => {
    expect(pathForMode('now')).toBe('/campaigns/history');
    expect(pathForMode('scheduled')).toBe('/campaigns/scheduled');
    expect(pathForMode('recurring')).toBe('/campaigns/recurring');
    expect(afterLaunchPath('scheduled', uuid(5))).toBe(`/campaigns/scheduled?new=${uuid(5)}`);
  });

  it('only an id marks a row', () => {
    expect(highlightOf(uuid(1))).toBe(uuid(1));
    expect(highlightOf('x')).toBeNull();
    expect(highlightOf(undefined)).toBeNull();
    expect(highlightOf([uuid(1)])).toBeNull();
  });

  it('a row opens the screen that knows it; only a waiting wizard campaign can be cancelled here', () => {
    expect(rowHref(row(1))).toBe(`/campaigns/wizard/broadcasts/${uuid(1)}`);
    expect(rowHref(row(2, { type: 'recurring', seriesId: uuid(9) }))).toBe(
      `/campaigns/wizard/broadcasts/${uuid(9)}`,
    );
    expect(rowHref(row(3, { source: 'classic' }))).toBe(`/campaigns/${uuid(3)}`);
    expect(canCancel(row(4, { status: 'scheduled' }))).toBe(true);
    expect(canCancel(row(5, { status: 'scheduled', source: 'classic' }))).toBe(false);
    expect(canCancel(row(6))).toBe(false);
  });
});

describe('the three history screens', () => {
  it('Campaign history lists each run with its type, counts and the new row marked', () => {
    const qc = new QueryClient();
    qc.setQueryData(['camp', 'history', 'runs', hq, ZONE], {
      data: [
        row(1),
        row(2, { type: 'scheduled', name: 'Weekend sale' }),
        row(3, { type: 'recurring', occurrence: 2, seriesId: uuid(9), name: 'Monday digest' }),
      ],
      page,
    });
    const out = html(<BroadcastHistoryScreen highlight={uuid(1)} />, { qc });
    expect(out).toContain('Campaign history');
    expect(out).toContain('Send now');
    expect(out).toContain('Recurring run');
    expect(out).toContain('Weekend sale');
    expect(out).toContain('Run 2');
    expect(out).toContain('118');
    expect(out).toContain('+91 98765 43210');
    expect(out).toContain('aria-current="true"');
    expect(out).toContain('>New<');
    // The list is the default view, with the switch to blocks and the count of what is shown.
    expect(out).toContain('data-testid="history-view-blocks"');
    expect(out).toContain('aria-pressed="true"');
    expect(out).toContain('Showing 3 campaigns');
    // No launch just happened: nothing is marked.
    const plain = html(<BroadcastHistoryScreen highlight={null} />, { qc });
    expect(plain).not.toContain('aria-current');
    expect(plain).not.toContain('>New<');
  });

  it('Campaign history with nothing sent offers Create campaign', () => {
    const qc = new QueryClient();
    qc.setQueryData(['camp', 'history', 'runs', hq, ZONE], { data: [], page });
    const out = html(<BroadcastHistoryScreen highlight={null} />, { qc });
    expect(out).toContain('No campaign has been sent yet.');
    expect(out).toContain('href="/campaigns/create"');
  });

  it('Scheduled campaigns shows the run time in the workspace zone, a countdown and Cancel', () => {
    const qc = new QueryClient();
    qc.setQueryData(['camp', 'history', 'scheduled', { q: '', cursor: undefined }], {
      data: [
        row(1, { status: 'scheduled', type: 'scheduled', runAt: '2026-10-07T04:30:00.000Z' }),
        row(2, {
          status: 'scheduled',
          type: 'scheduled',
          source: 'classic',
          runAt: '2026-10-08T04:30:00.000Z',
        }),
      ],
      page,
    });
    const out = html(<ScheduledBroadcastsScreen highlight={null} />, { qc });
    expect(out).toContain('Times are shown in Asia/Kolkata.');
    expect(out).toContain('10:00 AM');
    expect(out).toContain('in 21 hours');
    // One row button (the classic row has none) and the confirm dialog's own button.
    expect(out.match(/>Cancel campaign</g)).toHaveLength(2);
  });

  it('Recurring campaigns shows the rule in words, next and last run, runs and the series controls', () => {
    const series: WizardBroadcast = {
      id: uuid(9),
      kind: 'series',
      name: 'Monday digest',
      status: 'active',
      mode: 'recurring',
      templateId: uuid(1),
      templateName: 'weekly_digest',
      templateCount: 1,
      nextRunAt: '2026-10-12T04:30:00.000Z',
      lastRunAt: '2026-10-05T04:30:00.000Z',
      runs: 2,
      recipients: 240,
      retries: {
        enabled: false,
        endDate: null,
        pending: 0,
        nextRetryAt: null,
        recovered: 0,
        exhausted: 0,
      },
      schedule: {
        mode: 'recurring',
        rule: {
          frequency: 'weekly',
          interval: 1,
          startDate: '2026-09-28',
          timeOfDay: '10:00',
          timezone: ZONE,
          weekdays: [1],
          monthDay: null,
          ends: { kind: 'never' },
        },
      },
      createdAt: '2026-09-27T10:00:00.000Z',
      updatedAt: '2026-10-05T04:30:00.000Z',
      rowVersion: 1,
    };
    const qc = new QueryClient();
    qc.setQueryData(['camp', 'history', 'series', { q: '', status: '', cursor: undefined }], {
      data: [series],
      page,
    });
    const out = html(<RecurringBroadcastsScreen highlight={uuid(9)} />, { qc });
    expect(out).toContain('Monday digest');
    expect(out).toContain('Monday');
    expect(out).toContain('Show runs');
    expect(out).toContain('>Pause<');
    expect(out).toContain('Cancel series');
  });
});
