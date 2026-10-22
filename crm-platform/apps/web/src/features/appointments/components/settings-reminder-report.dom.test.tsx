// @vitest-environment jsdom
import { NextIntlClientProvider } from 'next-intl';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReminderReport, ReminderReportStep } from '@crm/contracts';
import { loadMessages } from '@/i18n/messages';
import { ApiError } from '@/lib/api/errors';

const hooks = vi.hoisted(() => ({
  useReminderReport: vi.fn(),
  useBookingTypes: vi.fn(),
}));
vi.mock('../api/hooks', () => hooks);
vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useSession: () => ({ user: {}, org: {} }),
}));

import { ReminderReportSection } from './settings-reminder-report';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
const refetch = vi.fn();

const step = (over: Partial<ReminderReportStep> = {}): ReminderReportStep => ({
  stepKind: 'reminder_24h',
  sent: 0,
  delivered: 0,
  failed: 0,
  skipped: 0,
  fallbackUsed: 0,
  buttons: null,
  skippedReasons: {},
  confirmationRate: null,
  cancelRate: null,
  noShowRate: null,
  ...over,
});
const report = (steps: ReminderReportStep[], buttonsIncluded: boolean): ReminderReport => ({
  from: '2030-01-01T00:00:00.000Z',
  to: '2030-02-01T00:00:00.000Z',
  buttonsIncluded,
  data: [
    {
      bookingTypeId: '11111111-1111-4111-8111-111111111111',
      bookingTypeName: 'Consultation',
      appointments: 10,
      confirmationRate: 0.6,
      cancelRate: 0.1,
      noShowRate: 0.05,
      steps,
    },
  ],
});

function mount() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={loadMessages('en')} timeZone="UTC">
        <ReminderReportSection />
      </NextIntlClientProvider>,
    );
  });
}
const result = (over: Record<string, unknown>) =>
  hooks.useReminderReport.mockReturnValue({ refetch, isPending: false, isError: false, ...over });
const text = () => document.body.textContent ?? '';

beforeEach(() => {
  refetch.mockReset();
  hooks.useReminderReport.mockReset();
  hooks.useBookingTypes.mockReturnValue({
    data: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Consultation' }],
  });
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
});

describe('the reminder report', () => {
  it('shows the loading state', () => {
    result({ isPending: true, data: undefined });
    mount();
    expect(text()).toContain('Loading the report');
  });

  it('shows a failed call with a retry', () => {
    result({ isError: true, error: new ApiError(500, 'INTERNAL', 'x'), data: undefined });
    mount();
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('says so when nothing was due in the period', () => {
    result({ data: report([step()], true) });
    mount();
    expect(text()).toContain('No reminder was due in this period');
    expect(document.querySelector('table')).toBeNull();
  });

  it('shows the counts per step, the fallback, the reasons and the button columns when the plan has them', () => {
    result({
      data: report(
        [
          step({
            sent: 8,
            delivered: 6,
            failed: 1,
            skipped: 2,
            fallbackUsed: 3,
            skippedReasons: { already_confirmed: 2 },
            buttons: { confirmed: 4, rescheduled: 1, cancelled: 2 },
          }),
        ],
        true,
      ),
    });
    mount();
    const cells = [...document.querySelectorAll('tbody td')].map((c) => c.textContent);
    expect(cells[0]).toBe('8');
    expect(cells[1]).toBe('6');
    expect(cells[2]).toBe('1');
    expect(cells[3]).toBe('3');
    expect(cells[4]).toContain('2');
    expect(cells.slice(5)).toEqual(['4', '1', '2']);
    expect(text()).toContain('24 hour reminder');
    expect(text()).toContain('The contact had already confirmed');
    expect(text()).toContain('60% confirmed');
    expect(text()).not.toContain('belong to the Appointments upgrade tier');
  });

  it('leaves the button columns out on a plan without the buttons and says what unlocks them', () => {
    result({ data: report([step({ sent: 5 })], false) });
    mount();
    const heads = [...document.querySelectorAll('thead th')].map((h) => h.textContent);
    expect(heads).not.toContain('Confirmed');
    expect(text()).toContain('Appointments upgrade tier');
    expect(document.querySelector('a[href="/account/plans"]')).not.toBeNull();
  });

  it('asks for both dates before it reports a custom period', () => {
    result({ data: report([step({ sent: 1 })], true) });
    mount();
    const select = document.querySelectorAll('select')[1] as HTMLSelectElement;
    act(() => {
      select.value = 'custom';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(text()).toContain('Choose a start and an end date');
    expect(document.querySelectorAll('input[type="date"]').length).toBe(2);
  });
});
