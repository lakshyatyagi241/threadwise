import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { MetaCardsResponse } from '@crm/contracts';
import { ReminderBanner } from './components/admin/meta-cards';

const raw = JSON.parse(
  readFileSync(
    join(resolve(__dirname, '../../..'), 'messages', 'en', 'wallet-message-billing.json'),
    'utf8',
  ),
) as Record<string, unknown>;

const render = (el: ReactElement) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={raw} timeZone="UTC">
      {el}
    </NextIntlClientProvider>,
  );

const fresh = (state: 'current' | 'upcoming' | 'due', daysUntilNext = 80) => ({
  state,
  quarterStart: '2026-10-01',
  nextQuarterStart: '2027-01-01',
  daysUntilNext,
});

const data = (over: Partial<MetaCardsResponse>): MetaCardsResponse => ({
  platformCurrency: 'USD',
  cards: [],
  missing: [],
  reminder: fresh('current'),
  ...over,
});

describe('the quarterly reminder banner', () => {
  it('says a quarter has begun, with the date, when the cards are due for a check', () => {
    const html = render(<ReminderBanner data={data({ reminder: fresh('due') })} />);
    expect(html).toContain('A new quarter began on October 1, 2026');
    expect(html).toContain('Meta may have changed its prices');
    expect(html).toContain('href="https://developers.facebook.com/docs/whatsapp/pricing"');
    expect(html).toContain('role="alert"');
  });

  it('warns ahead of the next date Meta can change prices, with the days left', () => {
    const html = render(<ReminderBanner data={data({ reminder: fresh('upcoming', 6) })} />);
    expect(html).toContain('January 1, 2027');
    expect(html).toContain('6 days away');
    expect(html).not.toContain('role="alert"');
  });

  it('uses the singular for one day', () => {
    expect(render(<ReminderBanner data={data({ reminder: fresh('upcoming', 1) })} />)).toContain(
      '1 day away',
    );
  });

  it('is a quiet line, not a banner, when everything is current', () => {
    const html = render(<ReminderBanner data={data({})} />);
    expect(html).toContain('Up to date. Meta may next change its prices on January 1, 2027.');
    expect(html).not.toContain('role="alert"');
  });

  it('asks for a card for a currency that has none, ahead of the quarter reminder', () => {
    const html = render(
      <ReminderBanner data={data({ missing: ['EUR', 'GBP'], reminder: fresh('due') })} />,
    );
    expect(html).toContain('No Meta rate card for EUR, GBP.');
    expect(html).not.toContain('A new quarter began');
  });

  it('never shows an untranslated key', () => {
    for (const reminder of [fresh('due'), fresh('upcoming', 3), fresh('current')]) {
      expect(render(<ReminderBanner data={data({ reminder })} />)).not.toMatch(/metaCards\./);
    }
    expect(render(<ReminderBanner data={data({ missing: ['EUR'] })} />)).not.toMatch(/metaCards\./);
  });
});
