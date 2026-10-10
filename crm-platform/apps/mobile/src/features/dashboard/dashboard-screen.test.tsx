import type { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { ScrollView } from 'react-native';
import { ApiError } from '@/lib/api';
import { signOut } from '@/lib/auth/sign-out';
import { initI18n } from '@/lib/i18n';
import { identifyUser } from '@/lib/observability/sentry';
import { fetchSession } from '@/lib/session/api';
import {
  emptyWidgets,
  session,
  summary,
  throughput,
  wallet,
  widgets,
} from '@/test/dashboard-fixtures';
import { renderApp } from '@/test/render';
import * as api from './api';
import { DashboardScreen } from './dashboard-screen';

jest.mock('./api');
jest.mock('@/lib/session/api');
jest.mock('@/lib/auth/sign-out', () => ({ signOut: jest.fn() }));
jest.mock('@/lib/observability/sentry', () => ({ identifyUser: jest.fn() }));

const sessionCall = jest.mocked(fetchSession);
const summaryCall = jest.mocked(api.fetchSummary);
const throughputCall = jest.mocked(api.fetchThroughput);
const widgetsCall = jest.mocked(api.fetchWidgets);
const walletCall = jest.mocked(api.fetchWalletSummary);
const entitlementsCall = jest.mocked(api.fetchEntitlements);

/** What the API answers; each test changes only what it is about. */
function arrange(
  over: Partial<{
    session: typeof session;
    widgets: typeof widgets;
    wallet: typeof wallet;
    features: string[];
  }> = {},
) {
  sessionCall.mockResolvedValue(over.session ?? session);
  summaryCall.mockResolvedValue(summary);
  throughputCall.mockResolvedValue(throughput);
  widgetsCall.mockResolvedValue(over.widgets ?? widgets);
  walletCall.mockResolvedValue(over.wallet ?? wallet);
  entitlementsCall.mockResolvedValue({ features: over.features ?? [] });
}

/** Waits until the numbers are on screen and every request has finished, so no update lands after the test. */
async function loaded(queryClient: QueryClient) {
  await screen.findByText('1,250');
  await screen.findByRole('header', { name: /Good (morning|afternoon|evening), Asha Verma\./ });
  await waitFor(() => expect(queryClient.isFetching()).toBe(0));
}

let client: QueryClient | undefined;
/** Renders the screen and remembers its query cache, so the test can wait for every request to finish. */
function show() {
  const view = renderApp(<DashboardScreen />);
  client = view.queryClient;
  return view;
}

beforeAll(async () => {
  await initI18n('en');
});
beforeEach(() => {
  jest.resetAllMocks();
  client = undefined;
});
afterEach(async () => {
  // A request that finishes after the test would update an unmounted screen; wait for the stragglers instead.
  if (client) {
    const cache = client;
    await waitFor(() => expect(cache.isFetching()).toBe(0));
  }
});

describe('DashboardScreen', () => {
  it('shows every card of a workspace that has data, in one column', async () => {
    arrange();
    const { queryClient } = show();
    await loaded(queryClient);
    for (const id of [
      'card-sent',
      'card-read',
      'card-contacts',
      'card-wallet',
      'ig-band',
      'strip-pipeline',
      'card-campaigns',
      'card-templates',
      'card-inbox',
      'card-flows',
      'engagement-funnel',
      'card-activity',
      'card-integrations',
    ]) {
      expect(await screen.findByTestId(id)).toBeTruthy();
    }
    expect(screen.queryByTestId('card-autopilot')).toBeNull();
    expect(
      screen.getByRole('header', { name: /Good (morning|afternoon|evening), Asha Verma\./ }),
    ).toBeTruthy();
    expect(screen.getByLabelText('Date range')).toBeTruthy();
  });

  it('tells Sentry who is signed in, by id only', async () => {
    arrange();
    const { queryClient } = show();
    await loaded(queryClient);
    expect(identifyUser).toHaveBeenCalledWith(session.user.id);
  });

  it('shows the devices card only while the platform has the personal-number engine on', async () => {
    arrange({ features: ['unofficial_whatsapp'] });
    const first = show();
    await loaded(first.queryClient);
    expect(await screen.findByTestId('card-devices')).toBeTruthy();
    first.unmount();

    arrange({ features: [] });
    const { queryClient } = show();
    await loaded(queryClient);
    expect(screen.queryByTestId('card-devices')).toBeNull();
  });

  it('hides the devices card when the widgets say the engine is off, whatever the plan says', async () => {
    arrange({
      features: ['unofficial_whatsapp'],
      widgets: { ...widgets, devices: { ...widgets.devices, unofficialDisabled: true } },
    });
    const { queryClient } = show();
    await loaded(queryClient);
    expect(screen.queryByTestId('card-devices')).toBeNull();
  });

  it('does not ask for the wallet at all without the permission, and shows the autopilot prompt instead', async () => {
    arrange({ session: { ...session, permissions: { 'dash.dashboard.read': 'all' } } });
    const { queryClient } = show();
    await loaded(queryClient);
    expect(walletCall).not.toHaveBeenCalled();
    expect(await screen.findByTestId('card-autopilot')).toBeTruthy();
    expect(screen.queryByTestId('card-wallet')).toBeNull();
  });

  it('shows the autopilot prompt when the wallet is empty', async () => {
    arrange({ wallet: { ...wallet, balanceMinor: 0 } });
    const { queryClient } = show();
    await loaded(queryClient);
    await waitFor(() => expect(walletCall).toHaveBeenCalled());
    expect(await screen.findByTestId('card-autopilot')).toBeTruthy();
  });

  it('leaves out the Instagram band and the pipeline for a workspace without them, and shows the empty states', async () => {
    arrange({ widgets: emptyWidgets });
    const { queryClient } = show();
    await loaded(queryClient);
    expect(await screen.findByText('No active campaigns')).toBeTruthy();
    expect(screen.queryByTestId('ig-band')).toBeNull();
    expect(screen.queryByTestId('strip-pipeline')).toBeNull();
    expect(screen.getByText('No conversations yet.')).toBeTruthy();
    expect(screen.getByText('No flows yet.')).toBeTruthy();
  });

  it('asks every endpoint again for the window the person picks', async () => {
    arrange();
    const { queryClient } = show();
    await loaded(queryClient);
    expect(summaryCall).toHaveBeenLastCalledWith('7d', expect.anything());
    fireEvent.press(screen.getByRole('radio', { name: 'Last 30 days' }));
    await waitFor(() => expect(summaryCall).toHaveBeenLastCalledWith('30d', expect.anything()));
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    expect(throughputCall).toHaveBeenLastCalledWith('30d', expect.anything());
    expect(widgetsCall).toHaveBeenLastCalledWith('30d', expect.anything());
    expect(
      screen.getByRole('radio', { name: 'Last 30 days' }).props.accessibilityState.checked,
    ).toBe(true);
  });

  it('reloads everything when the page is pulled down, and stops the spinner when done', async () => {
    arrange();
    const { queryClient } = show();
    await loaded(queryClient);
    const control = () => screen.UNSAFE_getByType(ScrollView).props.refreshControl;
    act(() => {
      control().props.onRefresh();
    });
    expect(control().props.refreshing).toBe(true);
    await waitFor(() => expect(control().props.refreshing).toBe(false));
    expect(summaryCall).toHaveBeenCalledTimes(2);
    expect(widgetsCall).toHaveBeenCalledTimes(2);
    expect(throughputCall).toHaveBeenCalledTimes(2);
  });

  it('tells a person whose role cannot open the dashboard, naming the role', async () => {
    arrange();
    summaryCall.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'Forbidden'));
    show();
    expect(
      await screen.findByText('Your role (Owner) does not have access to the dashboard.'),
    ).toBeTruthy();
    expect(screen.queryByTestId('card-sent')).toBeNull();
  });

  it('says the plan lacks analytics when the API says so', async () => {
    arrange();
    summaryCall.mockRejectedValue(new ApiError(402, 'PLAN_FEATURE_LOCKED', 'locked'));
    show();
    expect(await screen.findByText('Your plan does not include analytics.')).toBeTruthy();
  });

  it('shows the failure in words with a way to try again, and recovers', async () => {
    arrange();
    summaryCall.mockRejectedValueOnce(new ApiError(0, 'CLIENT_NETWORK', 'offline'));
    const { queryClient } = show();
    expect(
      await screen.findByText("Can't reach the server. Check your connection and try again."),
    ).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    await loaded(queryClient);
    expect(
      screen.queryByText("Can't reach the server. Check your connection and try again."),
    ).toBeNull();
  });

  it('keeps the numbers it has and offers a retry when only the cards fail to load', async () => {
    arrange();
    widgetsCall.mockRejectedValue(new ApiError(500, 'INTERNAL', 'boom'));
    const { queryClient } = show();
    await loaded(queryClient);
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeTruthy();
    expect(screen.queryByTestId('card-campaigns')).toBeNull();
  });

  it('reminds a new workspace to finish setting up on the web', async () => {
    arrange({ session: { ...session, landing: 'onboarding' } });
    const { queryClient } = show();
    await loaded(queryClient);
    expect(
      screen.getByText(
        'Your workspace setup is not finished. Finish it on the web to unlock the rest of your account.',
      ),
    ).toBeTruthy();
  });

  it('does not nag a finished workspace', async () => {
    arrange();
    const { queryClient } = show();
    await loaded(queryClient);
    expect(screen.queryByText(/setup is not finished/)).toBeNull();
  });

  it('signs out and clears the cache', async () => {
    arrange();
    const { queryClient } = show();
    await loaded(queryClient);
    fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
    expect(signOut).toHaveBeenCalledWith(queryClient);
  });
});
