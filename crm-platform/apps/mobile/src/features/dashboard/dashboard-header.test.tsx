import { screen } from '@testing-library/react-native';
import { initI18n } from '@/lib/i18n';
import { summary } from '@/test/dashboard-fixtures';
import { renderApp } from '@/test/render';
import { DashboardHeader } from './dashboard-header';

const MORNING = new Date('2026-10-10T08:00:00.000Z');
const base = {
  name: 'Asha',
  timezone: 'UTC',
  now: MORNING,
  running: 0,
  summary,
  showDevices: false,
  devicesOnline: 0,
  rangeName: 'Last 7 days',
  updatedAt: 0,
};

beforeAll(async () => {
  await initI18n('en');
});

describe('DashboardHeader', () => {
  it('greets the person by name for the time of day in the workspace zone, and calls a quiet workspace calm', async () => {
    await renderApp(<DashboardHeader {...base} />);
    expect(
      screen.getByRole('header', { name: /Good morning, Asha\. Workspace is calm\./ }),
    ).toBeTruthy();
    expect(screen.getByText('Operator dashboard')).toBeTruthy();
  });

  it('greets without a name rather than leaving a gap while the name is not known yet', async () => {
    await renderApp(<DashboardHeader {...base} name="" />);
    expect(screen.getByRole('header', { name: /Good morning\. Workspace is calm\./ })).toBeTruthy();
    expect(screen.queryByText(/Good morning, /)).toBeNull();
  });

  it('says how many campaigns are sending', async () => {
    await renderApp(<DashboardHeader {...base} running={1} />);
    expect(screen.getByRole('header', { name: /1 campaign is running\./ })).toBeTruthy();
    await renderApp(<DashboardHeader {...base} running={2} />);
    expect(screen.getByRole('header', { name: /2 campaigns are running\./ })).toBeTruthy();
  });

  it('sums up the day in one line, with connected devices only where that card exists', async () => {
    const { rerender } = await renderApp(<DashboardHeader {...base} />);
    expect(
      screen.getByText(
        'Saturday, October 10 - Last 7 days showing 1250 outbound, 94.5% deliverability.',
      ),
    ).toBeTruthy();
    await rerender(<DashboardHeader {...base} showDevices devicesOnline={1} />);
    expect(screen.getByText(/across 1 connected device\./)).toBeTruthy();
    await rerender(<DashboardHeader {...base} showDevices devicesOnline={3} />);
    expect(screen.getByText(/across 3 connected devices\./)).toBeTruthy();
  });

  it('shows no summary line before the numbers arrive', async () => {
    await renderApp(<DashboardHeader {...base} summary={undefined} />);
    expect(screen.queryByText(/deliverability/)).toBeNull();
  });

  it('shows how fresh the numbers are once they have arrived', async () => {
    await renderApp(<DashboardHeader {...base} updatedAt={Date.now() - 12_000} />);
    expect(screen.getByTestId('live-chip')).toBeTruthy();
    expect(screen.getByText(/Live · synced \d+s ago/)).toBeTruthy();
  });

  it('shows no freshness chip before the first answer', async () => {
    await renderApp(<DashboardHeader {...base} />);
    expect(screen.queryByTestId('live-chip')).toBeNull();
  });
});
