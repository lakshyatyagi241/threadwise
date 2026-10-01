import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { BroadcastListItem, BroadcastSummary } from '@crm/contracts';
import { BroadcastsTable } from './broadcasts-table';
import { pageWindow } from './broadcasts-pagination';
import { KpiStrip } from './kpi-strip';
import { ListRail } from './list-rail';

const messages = JSON.parse(
  readFileSync(join(process.cwd(), 'messages', 'en', 'broadcasts.json'), 'utf8'),
) as Record<string, unknown>;

const html = (el: ReactElement) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      {el}
    </NextIntlClientProvider>,
  );

const item = (over: Partial<BroadcastListItem> = {}): BroadcastListItem => ({
  id: 'abcdef12-0000-4000-8000-000000000000',
  name: 'Diwali offer',
  status: 'completed',
  provider: 'waba',
  senderKey: null,
  templateId: null,
  templateName: 'promo_oct',
  timezone: 'UTC',
  scheduledAt: null,
  completedAt: null,
  totalRecipients: 1200,
  successCount: 1100,
  deliveredCount: 1000,
  readCount: 400,
  clickedCount: 0,
  failCount: 100,
  rowVersion: 1,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
  ...over,
});

const table = (rows: BroadcastListItem[], canExport = true, canDeleteRows = true) =>
  html(
    <BroadcastsTable
      rows={rows}
      canExport={canExport}
      canDeleteRows={canDeleteRows}
      onExport={() => undefined}
      onDelete={() => undefined}
    />,
  );

describe('broadcast table', () => {
  it('shows the name, engine chip, reference, template, counters and status', () => {
    const out = table([item()]);
    for (const s of [
      'Diwali offer',
      'WABA',
      'Broadcast #BR-ABCDEF12',
      'promo_oct',
      '1,200',
      '1,100',
      'Completed',
    ]) {
      expect(out).toContain(s);
    }
  });

  it('offers delete only for a scheduled or failed broadcast, and only with the permission', () => {
    expect(table([item({ status: 'scheduled' })])).toContain('aria-label="Delete"');
    expect(table([item({ status: 'failed' })])).toContain('aria-label="Delete"');
    expect(table([item({ status: 'processing' })])).not.toContain('aria-label="Delete"');
    expect(table([item({ status: 'completed' })])).not.toContain('aria-label="Delete"');
    expect(table([item({ status: 'failed' })], true, false)).not.toContain('aria-label="Delete"');
  });

  it('hides the export button without the permission; analytics always links to the detail page', () => {
    const out = table([item()], false);
    expect(out).not.toContain('aria-label="Export rows"');
    expect(out).toContain('href="/broadcasts/abcdef12-0000-4000-8000-000000000000"');
  });

  it('shows a dash for a missing template, provider or schedule', () => {
    const out = table([item({ templateName: null, provider: null })]);
    expect(out.match(/—/g)?.length).toBeGreaterThanOrEqual(3);
  });
});

describe('tiles and rail', () => {
  const stats: BroadcastSummary['stats'] = {
    total: 7,
    recipients: 100,
    sent: 90,
    delivered: 80,
    read: 40,
    failed: 10,
    clicked: 3,
    processing: 5,
    queued: 2,
    deliveryPct: 88.9,
    readPct: 50,
    failedPct: 11.1,
  };
  it('the six tiles carry the percentages with one decimal', () => {
    const out = html(<KpiStrip stats={stats} />);
    for (const s of [
      '88.9% delivery',
      '50.0% read rate',
      '11.1% failed',
      '7 broadcasts',
      'in flight',
      'awaiting send',
    ]) {
      expect(out).toContain(s);
    }
  });

  it('the rail lists the five views with their counts and hides "create" without the permission', () => {
    const counts = { all: 7, scheduled: 1, processing: 2, completed: 3, failed: 1 };
    const out = html(
      <ListRail
        status="failed"
        counts={counts}
        recent={[item()]}
        canCreate={false}
        onStatus={() => undefined}
      />,
    );
    for (const s of [
      'All broadcasts',
      'Scheduled',
      'Processing',
      'Completed',
      'Failed',
      'Diwali offer',
    ]) {
      expect(out).toContain(s);
    }
    expect(out).toContain('aria-current="true"');
    expect(out).not.toContain('Get started');
    expect(
      html(
        <ListRail status="all" counts={counts} recent={[]} canCreate onStatus={() => undefined} />,
      ),
    ).toContain('Get started');
  });
});

describe('page window', () => {
  it('shows first, last and two either side of the current page, with a gap between', () => {
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
    expect(pageWindow(1, 20)).toEqual([1, 2, 3, 'gap', 20]);
    expect(pageWindow(10, 20)).toEqual([1, 'gap', 8, 9, 10, 11, 12, 'gap', 20]);
  });
});
