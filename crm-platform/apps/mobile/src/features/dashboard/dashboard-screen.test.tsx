import type { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { ApiError } from '@/lib/api';
import { signOut } from '@/lib/auth/sign-out';
import { initI18n } from '@/lib/i18n';
import { identifyUser } from '@/lib/observability/sentry';
import { fetchSession } from '@/lib/session/api';
import {
  emptyWidgets,
  session,
  summary,
  teamPanel,
  throughput,
  wallet,
  widgets,
} from '@/test/dashboard-fixtures';
import { renderApp } from '@/test/render';
import * as api from './api';
import { DashboardScreen } from './dashboard-screen';
import { presetRange, todayIn } from './date-range';

jest.mock('./api');
jest.mock('@/lib/session/api');
jest.mock('@/lib/auth/sign-out', () => ({ signOut: jest.fn() }));
jest.mock('@/lib/observability/sentry', () => ({ identifyUser: jest.fn() }));
jest.mock('expo-router', () => ({ useRouter: () => ({ navigate: jest.fn(), push: jest.fn() }) }));

const sessionCall = jest.mocked(fetchSession);
const summaryCall = jest.mocked(api.fetchSummary);
const throughputCall = jest.mocked(api.fetchThroughput);
const widgetsCall = jest.mocked(api.fetchWidgets);
const teamCall = jest.mocked(api.fetchTeamPanel);
const walletCall = jest.mocked(api.fetchWalletSummary);
const entitlementsCall = jest.mocked(api.fetchEntitlements);
const newContactsCall = jest.mocked(api.fetchNewContacts);
const taskCountsCall = jest.mocked(api.fetchTaskCounts);
const inboxCountsCall = jest.mocked(api.fetchInboxCounts);

/** A signed-in person who may read contacts, tasks and the inbox, so every card of the summary has something to show. */
const sessionAll = {
  ...session,
  permissions: {
    ...session.permissions,
    'record.contacts.read': 'all',
    'record.tasks.read': 'all',
    'inbox.conversation.read': 'all',
  },
} as typeof session;

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
  newContactsCall.mockResolvedValue(42);
  taskCountsCall.mockResolvedValue({
    overdue: 1,
    today: 2,
    upcoming: 3,
    noDate: 4,
    open: 10,
    done: 5,
    mine: { open: 6, overdue: 1 },
  });
  inboxCountsCall.mockResolvedValue({ all: 9, mine: 4, unassigned: 3, unread: 2, archived: 1 });
}

/** Waits until the numbers are on screen and every request has finished, so no update lands after the test. */
async function loaded(queryClient: QueryClient) {
  await screen.findByTestId('card-sent');
  await screen.findByTestId('engagement-funnel');
  await waitFor(() => expect(queryClient.isFetching()).toBe(0));
}

let client: QueryClient | undefined;
/** Renders the screen and remembers its query cache, so the test can wait for every request to finish. */
async function show() {
  const view = await renderApp(<DashboardScreen />);
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
    const { queryClient } = await show();
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
    expect(screen.getByRole('button', { name: 'Dashboard view' })).toBeTruthy();
    expect(screen.getByText('Summary')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /^Date range: \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}/ }),
    ).toBeTruthy();
  });

  it('opens on the last 30 days, asking every endpoint for those two days', async () => {
    arrange();
    const { queryClient } = await show();
    await loaded(queryClient);
    const win = presetRange('last30', todayIn(session.org.timezone ?? undefined));
    expect(summaryCall).toHaveBeenLastCalledWith(win, expect.anything());
    expect(throughputCall).toHaveBeenLastCalledWith(win, expect.anything());
    expect(widgetsCall).toHaveBeenLastCalledWith(win, expect.anything());
  });

  describe('the cards in the style of the reference app', () => {
    it('shows new contacts, open tasks, messages and the live conversation counts', async () => {
      arrange({ session: sessionAll });
      const { queryClient } = await show();
      await loaded(queryClient);
      expect(await screen.findByLabelText('Contacts Added in this period: 42')).toBeTruthy();
      expect(screen.getByLabelText('Tasks Open now: 10')).toBeTruthy();
      expect(screen.getByLabelText('Messages Sent: 1,250')).toBeTruthy();
      expect(screen.getByRole('header', { name: 'Conversations' })).toBeTruthy();
      expect(screen.getByLabelText('Active: 9')).toBeTruthy();
      expect(screen.getByLabelText('Mine: 4')).toBeTruthy();
      expect(screen.getByLabelText('Unassigned: 3')).toBeTruthy();
      expect(screen.getByLabelText('Assigned: 6')).toBeTruthy();
      expect(screen.getByLabelText('Unread: 2')).toBeTruthy();
      expect(screen.getByLabelText('Archived: 1')).toBeTruthy();
      expect(screen.getByRole('header', { name: 'All messages' })).toBeTruthy();
      expect(screen.getByLabelText('Failed: 20')).toBeTruthy();
      expect(screen.getAllByLabelText(/^Delivered: /).length).toBeGreaterThan(0);
    });

    it('asks for no contacts, tasks or inbox numbers without the permission, and shows a dash', async () => {
      arrange();
      const { queryClient } = await show();
      await loaded(queryClient);
      expect(newContactsCall).not.toHaveBeenCalled();
      expect(taskCountsCall).not.toHaveBeenCalled();
      expect(inboxCountsCall).not.toHaveBeenCalled();
      expect(screen.getByLabelText('Contacts Added in this period: —')).toBeTruthy();
      expect(screen.getByLabelText('Tasks Open now: —')).toBeTruthy();
      expect(screen.queryByRole('header', { name: 'Conversations' })).toBeNull();
    });

    it('shows a dash for tasks when the plan has none, and keeps everything else', async () => {
      arrange({ session: sessionAll });
      taskCountsCall.mockRejectedValue(new ApiError(422, 'PLAN_FEATURE_LOCKED', 'locked'));
      const { queryClient } = await show();
      await loaded(queryClient);
      expect(await screen.findByLabelText('Tasks Open now: —')).toBeTruthy();
      expect(screen.getByLabelText('Contacts Added in this period: 42')).toBeTruthy();
    });
  });

  it('tells Sentry who is signed in, by id only', async () => {
    arrange();
    const { queryClient } = await show();
    await loaded(queryClient);
    expect(identifyUser).toHaveBeenCalledWith(session.user.id);
  });

  it('shows the devices card only while the platform has the personal-number engine on', async () => {
    arrange({ features: ['unofficial_whatsapp'] });
    const first = await show();
    await loaded(first.queryClient);
    expect(await screen.findByTestId('card-devices')).toBeTruthy();
    await first.unmount();

    arrange({ features: [] });
    const { queryClient } = await show();
    await loaded(queryClient);
    expect(screen.queryByTestId('card-devices')).toBeNull();
  });

  it('hides the devices card when the widgets say the engine is off, whatever the plan says', async () => {
    arrange({
      features: ['unofficial_whatsapp'],
      widgets: { ...widgets, devices: { ...widgets.devices, unofficialDisabled: true } },
    });
    const { queryClient } = await show();
    await loaded(queryClient);
    expect(screen.queryByTestId('card-devices')).toBeNull();
  });

  it('does not ask for the wallet at all without the permission, and shows the autopilot prompt instead', async () => {
    arrange({ session: { ...session, permissions: { 'dash.dashboard.read': 'all' } } });
    const { queryClient } = await show();
    await loaded(queryClient);
    expect(walletCall).not.toHaveBeenCalled();
    expect(await screen.findByTestId('card-autopilot')).toBeTruthy();
    expect(screen.queryByTestId('card-wallet')).toBeNull();
  });

  it('shows the autopilot prompt when the wallet is empty', async () => {
    arrange({ wallet: { ...wallet, balanceMinor: 0 } });
    const { queryClient } = await show();
    await loaded(queryClient);
    await waitFor(() => expect(walletCall).toHaveBeenCalled());
    expect(await screen.findByTestId('card-autopilot')).toBeTruthy();
  });

  it('leaves out the Instagram band and the pipeline for a workspace without them, and shows the empty states', async () => {
    arrange({ widgets: emptyWidgets });
    const { queryClient } = await show();
    await loaded(queryClient);
    expect(await screen.findByText('No active campaigns')).toBeTruthy();
    expect(screen.queryByTestId('ig-band')).toBeNull();
    expect(screen.queryByTestId('strip-pipeline')).toBeNull();
    expect(screen.getByText('No conversations yet.')).toBeTruthy();
    expect(screen.getByText('No flows yet.')).toBeTruthy();
  });

  it('asks every endpoint again for the days the person picks in the calendar sheet', async () => {
    arrange();
    const { queryClient } = await show();
    await loaded(queryClient);
    const today = todayIn(session.org.timezone ?? undefined);
    await fireEvent.press(screen.getByRole('button', { name: /^Date range:/ }));
    expect(await screen.findByText('Search by calendar')).toBeTruthy();
    await fireEvent.press(screen.getByRole('radio', { name: 'Last 7 days' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Apply' }));
    const win = presetRange('last7', today);
    await waitFor(() => expect(summaryCall).toHaveBeenLastCalledWith(win, expect.anything()));
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    expect(throughputCall).toHaveBeenLastCalledWith(win, expect.anything());
    expect(widgetsCall).toHaveBeenLastCalledWith(win, expect.anything());
    expect(
      screen.getByRole('button', { name: new RegExp(`^Date range: ${win.from} to ${win.to}`) }),
    ).toBeTruthy();
  });

  it('reloads everything when the page is pulled down, and stops the spinner when done', async () => {
    arrange();
    const { queryClient } = await show();
    await loaded(queryClient);
    const control = () => screen.getByTestId('dashboard-scroll').props.refreshControl;
    await act(() => {
      control().props.onRefresh();
    });
    await waitFor(() => expect(control().props.refreshing).toBe(false));
    expect(summaryCall).toHaveBeenCalledTimes(2);
    expect(widgetsCall).toHaveBeenCalledTimes(2);
    expect(throughputCall).toHaveBeenCalledTimes(2);
  });

  it('tells a person whose role cannot open the dashboard, naming the role', async () => {
    arrange();
    summaryCall.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'Forbidden'));
    await show();
    expect(
      await screen.findByText('Your role (Owner) does not have access to the dashboard.'),
    ).toBeTruthy();
    expect(screen.queryByTestId('card-sent')).toBeNull();
  });

  it('says the plan lacks analytics when the API says so', async () => {
    arrange();
    summaryCall.mockRejectedValue(new ApiError(402, 'PLAN_FEATURE_LOCKED', 'locked'));
    await show();
    expect(await screen.findByText('Your plan does not include analytics.')).toBeTruthy();
  });

  it('shows the failure in words with a way to try again, and recovers', async () => {
    arrange();
    summaryCall.mockRejectedValueOnce(new ApiError(0, 'CLIENT_NETWORK', 'offline'));
    const { queryClient } = await show();
    expect(
      await screen.findByText("Can't reach the server. Check your connection and try again."),
    ).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    await loaded(queryClient);
    expect(
      screen.queryByText("Can't reach the server. Check your connection and try again."),
    ).toBeNull();
  });

  it('keeps the numbers it has and offers a retry when only the cards fail to load', async () => {
    arrange();
    widgetsCall.mockRejectedValue(new ApiError(500, 'INTERNAL', 'boom'));
    const { queryClient } = await show();
    await loaded(queryClient);
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeTruthy();
    expect(screen.queryByTestId('card-campaigns')).toBeNull();
  });

  it('reminds a new workspace to finish setting up on the web', async () => {
    arrange({ session: { ...session, landing: 'onboarding' } });
    const { queryClient } = await show();
    await loaded(queryClient);
    expect(
      screen.getByText(
        'Your workspace setup is not finished. Finish it on the web to unlock the rest of your account.',
      ),
    ).toBeTruthy();
  });

  it('does not nag a finished workspace', async () => {
    arrange();
    const { queryClient } = await show();
    await loaded(queryClient);
    expect(screen.queryByText(/setup is not finished/)).toBeNull();
  });

  it('has no sign-out button: signing out is in the Menu tab', async () => {
    arrange();
    const { queryClient } = await show();
    await loaded(queryClient);
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
    expect(signOut).not.toHaveBeenCalled();
  });

  describe('the view dropdown at the top', () => {
    const sessionAnalytics = {
      ...session,
      permissions: { ...session.permissions, 'dash.analytics.read': 'all' },
    } as typeof session;

    const open = async () => {
      await fireEvent.press(await screen.findByRole('button', { name: 'Dashboard view' }));
    };
    const pick = async (label: string) => {
      await open();
      await fireEvent.press(await screen.findByRole('menuitem', { name: label }));
    };

    it('offers Summary, Agent and Bot, and starts on Summary', async () => {
      arrange();
      const { queryClient } = await show();
      await loaded(queryClient);
      await open();
      for (const label of ['Summary', 'Agent', 'Bot']) {
        expect(screen.getByRole('menuitem', { name: label })).toBeTruthy();
      }
      expect(
        screen.getByRole('menuitem', { name: 'Summary' }).props.accessibilityState.selected,
      ).toBe(true);
      // Nothing for the other views is asked for until one is opened.
      expect(teamCall).not.toHaveBeenCalled();
    });

    it('shows how each person of the team did, in the Agent view', async () => {
      arrange({ session: sessionAnalytics });
      teamCall.mockResolvedValue(teamPanel);
      const { queryClient } = await show();
      await loaded(queryClient);
      await pick('Agent');
      expect(await screen.findByText('Asha Verma')).toBeTruthy();
      expect(screen.getByText('asha@example.test')).toBeTruthy();
      expect(screen.getByText('Rohan Mehta')).toBeTruthy();
      // Totals of the team: 40 + 10 conversations, 32 + 3 resolved.
      expect(screen.getByLabelText(/^Conversations .*: 50$/)).toBeTruthy();
      expect(screen.getByLabelText(/^Resolved .*: 35$/)).toBeTruthy();
      expect(screen.getByText('12 min')).toBeTruthy();
      expect(screen.getByText('3.5 h')).toBeTruthy();
      expect(screen.getByText('4.6 (9)')).toBeTruthy();
      // Nobody answered or was rated yet: dashes, not zeros.
      expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3);
      expect(teamCall).toHaveBeenCalledWith(
        expect.objectContaining({ from: expect.any(String) }),
        expect.anything(),
      );
      expect(screen.queryByTestId('card-sent')).toBeNull();
    });

    it('says so when nobody was given a conversation in the period', async () => {
      arrange({ session: sessionAnalytics });
      teamCall.mockResolvedValue({ ...teamPanel, team: [] });
      const { queryClient } = await show();
      await loaded(queryClient);
      await pick('Agent');
      expect(
        await screen.findByText('No conversation was given to anyone in this period.'),
      ).toBeTruthy();
    });

    it('asks nothing of the API from a person who may not read analytics', async () => {
      arrange();
      const { queryClient } = await show();
      await loaded(queryClient);
      await pick('Agent');
      expect(
        await screen.findByText('Your role (Owner) does not have access to agent analytics.'),
      ).toBeTruthy();
      expect(teamCall).not.toHaveBeenCalled();
    });

    it('says when the plan has no analytics', async () => {
      arrange({ session: sessionAnalytics });
      teamCall.mockRejectedValue(new ApiError(403, 'PLAN_FEATURE_LOCKED', 'no'));
      const { queryClient } = await show();
      await loaded(queryClient);
      await pick('Agent');
      expect(await screen.findByText('Your plan does not include analytics.')).toBeTruthy();
    });

    it('shows the automation flows in the Bot view, without the date pill', async () => {
      arrange();
      const { queryClient } = await show();
      await loaded(queryClient);
      await pick('Bot');
      expect(await screen.findByText('Order follow-up')).toBeTruthy();
      expect(screen.getByText('Win-back')).toBeTruthy();
      expect(screen.getByLabelText('Active flows of 5 flows: 3')).toBeTruthy();
      expect(screen.getByLabelText('Subscribers in all flows: 1,200')).toBeTruthy();
      expect(screen.queryByRole('button', { name: /^Date range/ })).toBeNull();
      expect(screen.queryByTestId('card-sent')).toBeNull();
    });

    it('goes back to the summary cards', async () => {
      arrange();
      const { queryClient } = await show();
      await loaded(queryClient);
      await pick('Bot');
      await screen.findByText('Order follow-up');
      await pick('Summary');
      expect(await screen.findByTestId('card-sent')).toBeTruthy();
      expect(screen.getByRole('button', { name: /^Date range/ })).toBeTruthy();
    });
  });
});
