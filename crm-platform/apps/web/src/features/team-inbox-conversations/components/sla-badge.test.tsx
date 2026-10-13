import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SlaStatus } from '@crm/contracts';
import { SlaBadge, minutesLeft } from './sla-badge';

const messages = (locale: string) =>
  JSON.parse(
    readFileSync(join(process.cwd(), 'messages', locale, 'team-inbox-conversations.json'), 'utf8'),
  ) as Record<string, unknown>;

const NOW = Date.parse('2026-10-14T12:00:00.000Z');
const html = (status: SlaStatus | null, compact = false, locale = 'en') =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={messages(locale)} timeZone="UTC">
      <SlaBadge status={status} nowMs={NOW} compact={compact} />
    </NextIntlClientProvider>,
  );

const status = (state: SlaStatus['state'], dueAt = '2026-10-14T12:20:00.000Z'): SlaStatus => ({
  state,
  kind: 'first_response',
  dueAt,
});

describe('SlaBadge', () => {
  it('draws nothing without a clock', () => {
    expect(html(null)).toBe('');
  });

  it('says breached in red, with the clock and the due time in the tooltip', () => {
    const out = html(status('breached', '2026-10-14T11:30:00.000Z'));
    expect(out).toContain('data-sla-state="breached"');
    expect(out).toContain('SLA breached');
    expect(out).toContain('bg-danger/15');
    expect(out).toContain('First reply target: missed');
  });

  it('counts the minutes left when at risk, in amber', () => {
    const out = html(status('at_risk'));
    expect(out).toContain('data-sla-state="at_risk"');
    expect(out).toContain('SLA due in 20 min');
    expect(out).toContain('bg-warning/15');
  });

  it('shows a healthy clock in the thread header but not on a list row', () => {
    const ok = status('ok', '2026-10-14T18:00:00.000Z');
    expect(html(ok)).toContain('data-sla-state="ok"');
    expect(html(ok, true)).toBe('');
    expect(html(status('breached'), true)).toContain('SLA breached');
  });

  it('reads in Arabic', () => {
    expect(html(status('breached'), false, 'ar')).not.toContain('SLA breached');
  });
});

describe('minutesLeft', () => {
  it('rounds up and never goes below zero', () => {
    expect(minutesLeft('2026-10-14T12:00:30.000Z', NOW)).toBe(1);
    expect(minutesLeft('2026-10-14T11:00:00.000Z', NOW)).toBe(0);
  });
});
