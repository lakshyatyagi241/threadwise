import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { MemberWorkingHours } from '@crm/contracts';
import { KEYS } from '../api/hooks';
import { readMessages } from '../lib/test-support';
import { StatusDialogs } from './agent-status-menu';
import { WorkingHoursDialog } from './working-hours-dialog';
import { WspProviders } from './parts';

const open = { enabled: true, windows: [{ start: '09:00', end: '18:00' }] };
const off = { enabled: false, windows: [] };
const week = { mon: open, tue: open, wed: open, thu: open, fri: open, sat: off, sun: off };

const base = {
  memberId: '0b6f6c2e-7a3d-4a0e-9c1e-2f6f6d9a1b11',
  configured: false,
  automate: false,
  timezone: 'Asia/Kolkata',
  workspaceTimezone: 'Asia/Kolkata',
  days: week,
  emptySchedule: false,
  entitled: true,
  canEdit: true,
  status: { state: 'available', reason: 'default', changesAt: null },
} as unknown as MemberWorkingHours;

const html = (data: MemberWorkingHours | null) => {
  const client = new QueryClient();
  if (data) client.setQueryData(KEYS.hours('me'), data);
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={readMessages('en')} timeZone="UTC">
      <QueryClientProvider client={client}>
        <WspProviders>
          <WorkingHoursDialog memberId="me" open onClose={() => undefined} />
        </WspProviders>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
};

describe('the working hours dialog', () => {
  it('draws the suggested week for a person with no saved schedule', () => {
    expect(() => html(base)).not.toThrow();
  });
  it('draws a saved schedule with several windows, an overnight window and a day off', () => {
    const data = {
      ...base,
      configured: true,
      automate: true,
      days: {
        ...week,
        mon: {
          enabled: true,
          windows: [
            { start: '09:00', end: '13:00' },
            { start: '14:00', end: '18:00' },
          ],
        },
        tue: { enabled: true, windows: [{ start: '22:00', end: '06:00' }] },
        wed: { enabled: true, windows: [{ start: '00:00', end: '24:00' }] },
      },
    } as unknown as MemberWorkingHours;
    expect(() => html(data)).not.toThrow();
  });
  it('draws a plan that does not allow saving, and an empty week', () => {
    expect(() => html({ ...base, entitled: false, canEdit: false })).not.toThrow();
    expect(() =>
      html({
        ...base,
        emptySchedule: true,
        days: { mon: off, tue: off, wed: off, thu: off, fri: off, sat: off, sun: off },
      } as unknown as MemberWorkingHours),
    ).not.toThrow();
  });
  it('draws a zone that is not in the usual list', () => {
    expect(() => html({ ...base, timezone: 'Asia/Calcutta' })).not.toThrow();
    expect(() => html({ ...base, timezone: 'UTC' })).not.toThrow();
  });
});

describe('the dialogs of the status pill in the top bar', () => {
  const bare = (hoursOpen: boolean, leaveOpen: boolean) => {
    const client = new QueryClient();
    client.setQueryData(KEYS.hours('me'), base);
    // no toast host above: this is how the top bar renders on a page that has none of its own
    return renderToStaticMarkup(
      <NextIntlClientProvider locale="en" messages={readMessages('en')} timeZone="UTC">
        <QueryClientProvider client={client}>
          <StatusDialogs
            hoursOpen={hoursOpen}
            leaveOpen={leaveOpen}
            onCloseHours={() => undefined}
            onCloseLeave={() => undefined}
          />
        </QueryClientProvider>
      </NextIntlClientProvider>,
    );
  };
  it('open the working hours without a toast host above them (they used to take the page down)', () => {
    expect(() => bare(true, false)).not.toThrow();
  });
  it('draw nothing while closed', () => {
    expect(bare(false, false)).toBe('');
  });
  it('the dialog itself needs a toast host, which is why the pill brings one', () => {
    const client = new QueryClient();
    client.setQueryData(KEYS.hours('me'), base);
    expect(() =>
      renderToStaticMarkup(
        <NextIntlClientProvider locale="en" messages={readMessages('en')} timeZone="UTC">
          <QueryClientProvider client={client}>
            <WorkingHoursDialog memberId="me" open onClose={() => undefined} />
          </QueryClientProvider>
        </NextIntlClientProvider>,
      ),
    ).toThrow('useToast');
  });
});
