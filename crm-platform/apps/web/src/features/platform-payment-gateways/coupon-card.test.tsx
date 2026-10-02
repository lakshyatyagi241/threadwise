import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CouponCard } from './components/coupon-card';

const messages = JSON.parse(
  readFileSync(
    join(resolve(__dirname, '../../..'), 'messages', 'en', 'platform-payment-gateways.json'),
    'utf8',
  ),
) as Record<string, unknown>;

const render = (busy: boolean, value = '') =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <CouponCard value={value} onChange={() => undefined} onApply={() => undefined} busy={busy} />
    </NextIntlClientProvider>,
  );

describe('TW-CPN-007 checkout coupon card', () => {
  it('shows the input (uppercase styling, placeholder) and the Apply button', () => {
    const html = render(false, 'SAVE20');
    expect(html).toContain('placeholder="Have a coupon code?"');
    expect(html).toContain('value="SAVE20"');
    expect(html).toContain('uppercase');
    expect(html).toContain('Apply');
    expect(html).not.toContain('disabled=""');
  });

  it('disables Apply while a check is in flight', () => {
    expect(render(true)).toContain('disabled=""');
  });
});
