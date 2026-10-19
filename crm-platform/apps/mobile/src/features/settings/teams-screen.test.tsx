import { fireEvent, screen } from '@testing-library/react-native';
import { useRouter } from 'expo-router';
import { ApiError } from '@/lib/api';
import { fetchSession } from '@/lib/session/api';
import { session } from '@/test/dashboard-fixtures';
import { readOnlySummary, summary } from '@/test/members-fixtures';
import { renderApp } from '@/test/render';
import { sales, support, teamPageOf } from '@/test/teams-fixtures';
import * as membersApi from './members-api';
import * as api from './teams-api';
import { TeamsScreen } from './teams-screen';

jest.mock('./members-api');
jest.mock('./teams-api');
jest.mock('@/lib/session/api');
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));

const listCall = jest.mocked(api.fetchTeams);
const summaryCall = jest.mocked(membersApi.fetchMembersSummary);
const router = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn() };

const press = async (name: string | RegExp) =>
  await fireEvent.press(await screen.findByRole('button', { name }));

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(useRouter).mockReturnValue(router as unknown as ReturnType<typeof useRouter>);
  router.canGoBack.mockReturnValue(true);
  jest.mocked(fetchSession).mockResolvedValue(session);
  summaryCall.mockResolvedValue(summary);
  listCall.mockResolvedValue(teamPageOf([sales, support]));
});

describe('TeamsScreen', () => {
  it('shows each team with how it assigns, who is in it and who is online', async () => {
    await renderApp(<TeamsScreen />);
    expect(await screen.findByLabelText('Sales, Round robin, 2 members, 1 online')).toBeTruthy();
    expect(screen.getByLabelText('Support, Manual, 0 members, 2 devices')).toBeTruthy();
    expect(screen.getByText('Default')).toBeTruthy();
    expect(screen.getByText('Group your agents by department.', { exact: false })).toBeTruthy();
  });

  it('explains how teams work', async () => {
    await renderApp(<TeamsScreen />);
    expect(await screen.findByText('How teams work')).toBeTruthy();
    expect(screen.getByText(/The team colour is the chip colour/)).toBeTruthy();
  });

  it('offers Create team and the pencils to a person who manages teams', async () => {
    await renderApp(<TeamsScreen />);
    await press('Create team');
    expect(router.push).toHaveBeenCalledWith('/team-form');
    await press('Edit team: Sales');
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/team-form',
      params: { teamId: sales.id },
    });
  });

  it('shows the list but no way to change it to a person who may not manage teams', async () => {
    summaryCall.mockResolvedValue(readOnlySummary);
    await renderApp(<TeamsScreen />);
    await screen.findByLabelText(/^Sales,/);
    expect(screen.queryByRole('button', { name: 'Create team' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Edit team: / })).toBeNull();
  });

  it('says when there are no teams yet', async () => {
    listCall.mockResolvedValue(teamPageOf([]));
    await renderApp(<TeamsScreen />);
    expect(await screen.findByText('No teams yet')).toBeTruthy();
    expect(screen.getByText(/Create a team, add your agents to it/)).toBeTruthy();
  });

  it('shows a failure with a way to try again', async () => {
    listCall.mockRejectedValueOnce(new ApiError(0, 'CLIENT_NETWORK', 'x'));
    await renderApp(<TeamsScreen />);
    expect(await screen.findByText(/Can't reach the server/)).toBeTruthy();
    await press('Try again');
    expect(await screen.findByLabelText(/^Sales,/)).toBeTruthy();
  });

  it('goes back, or to the menu when there is nothing to go back to', async () => {
    router.canGoBack.mockReturnValue(false);
    await renderApp(<TeamsScreen />);
    await press('Back');
    expect(router.replace).toHaveBeenCalledWith('/menu');
  });
});
