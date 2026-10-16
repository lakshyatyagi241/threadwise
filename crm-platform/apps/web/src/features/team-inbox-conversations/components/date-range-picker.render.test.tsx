// @vitest-environment jsdom
import { NextIntlClientProvider } from 'next-intl';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DateRangePicker } from './date-range-picker';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const messages = {
  'team-inbox-conversations': {
    list: {
      filters: {
        from: 'From',
        to: 'To',
        dateRange: 'Date range',
        today: 'Today',
        last7: 'Last 7 days',
        last30: 'Last 30 days',
        thisMonth: 'This month',
        clearDates: 'Clear dates',
        previousMonth: 'Previous month',
        nextMonth: 'Next month',
      },
    },
  },
};
let root: Root | null = null;
let host: HTMLElement;
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
});
async function show(from: string, to: string, onChange = vi.fn()) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <DateRangePicker from={from} to={to} onChange={onChange} />
      </NextIntlClientProvider>,
    );
  });
  return onChange;
}
const click = (el: Element) =>
  act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
const q = (sel: string) => document.querySelector(sel)!;

describe('the date range picker', () => {
  it('shows the placeholders, opens a calendar and takes two taps as a range (earlier day first)', async () => {
    const onChange = await show('2026-10-05', '');
    expect(host.textContent).toContain('To');
    await click(q('[data-testid="inbox-filters-dates"]'));
    await click(q('[data-testid="inbox-filters-day-2026-10-12"]'));
    expect(onChange).not.toHaveBeenCalled();
    await click(q('[data-testid="inbox-filters-day-2026-10-08"]'));
    expect(onChange).toHaveBeenCalledWith({ from: '2026-10-08', to: '2026-10-12' });
  });

  it('a quick range fills both days, and Clear empties them', async () => {
    const onChange = await show('2026-10-05', '2026-10-09');
    await click(q('[data-testid="inbox-filters-dates"]'));
    const clear = [...document.querySelectorAll('button')].find(
      (b) => b.textContent === 'Clear dates',
    )!;
    await click(clear);
    expect(onChange).toHaveBeenCalledWith({ from: '', to: '' });
    await click(q('[data-testid="inbox-filters-dates"]'));
    await click(q('[data-testid="inbox-filters-dates"]'));
    const t7 = [...document.querySelectorAll('button')].find(
      (b) => b.textContent === 'Last 7 days',
    )!;
    await click(t7);
    const arg = onChange.mock.calls.at(-1)![0] as { from: string; to: string };
    expect(arg.from < arg.to).toBe(true);
    expect(arg.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
