import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ApiError } from '@/lib/api';
import { fetchSession } from '@/lib/session/api';
import { session } from '@/test/dashboard-fixtures';
import { agent, me, owner, pageOf, readOnlySummary, summary } from '@/test/members-fixtures';
import { renderApp } from '@/test/render';
import { sales, teamPageOf } from '@/test/teams-fixtures';
import * as membersApi from './members-api';
import * as api from './teams-api';
import { TeamFormScreen } from './team-form-screen';

jest.mock('./members-api');
jest.mock('./teams-api');
jest.mock('@/lib/session/api');
jest.mock('expo-router', () => ({ useRouter: jest.fn(), useLocalSearchParams: jest.fn() }));

const summaryCall = jest.mocked(membersApi.fetchMembersSummary);
const membersCall = jest.mocked(membersApi.fetchMembers);
const listCall = jest.mocked(api.fetchTeams);
const createCall = jest.mocked(api.createTeam);
const updateCall = jest.mocked(api.updateTeam);
const deleteCall = jest.mocked(api.deleteTeam);
const router = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn() };

const fill = async (label: string, value: string) =>
  await fireEvent.changeText(await screen.findByLabelText(label), value);
const press = async (name: string | RegExp) =>
  await fireEvent.press(await screen.findByRole('button', { name }));

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(useRouter).mockReturnValue(router as unknown as ReturnType<typeof useRouter>);
  jest.mocked(useLocalSearchParams).mockReturnValue({});
  router.canGoBack.mockReturnValue(true);
  jest.mocked(fetchSession).mockResolvedValue(session);
  summaryCall.mockResolvedValue(summary);
  membersCall.mockResolvedValue(pageOf([owner, me, agent]));
  listCall.mockResolvedValue(teamPageOf([sales]));
});

describe('TeamFormScreen: a new team', () => {
  it('checks the name before calling the API', async () => {
    await renderApp(<TeamFormScreen />);
    await press('Create team');
    expect(await screen.findByText('Enter a team name.')).toBeTruthy();
    expect(createCall).not.toHaveBeenCalled();
  });

  it('creates the team with the colour, the strategy and the people chosen, then goes back', async () => {
    createCall.mockResolvedValue(sales);
    await renderApp(<TeamFormScreen />);
    await fill('Team name', ' Sales ');
    await fireEvent.press(await screen.findByRole('radio', { name: 'Colour #5B3D8A' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Auto-assignment strategy' }));
    await fireEvent.press(await screen.findByText('Least loaded — fewest open first'));
    await fireEvent.press(await screen.findByRole('checkbox', { name: 'Meera Nair' }));
    await press('Create team');
    await waitFor(() =>
      expect(createCall).toHaveBeenCalledWith({
        name: 'Sales',
        color: '#5B3D8A',
        assignmentStrategy: 'least_loaded',
        memberIds: [agent.id],
        deviceIds: [],
        receivesConversations: true,
        receivesRecords: true,
      }),
    );
    await waitFor(() => expect(router.back).toHaveBeenCalled());
  });

  it('puts a taken name on the name field', async () => {
    createCall.mockRejectedValue(new ApiError(409, 'WSP_TEAM_NAME_TAKEN', 'x'));
    await renderApp(<TeamFormScreen />);
    await fill('Team name', 'Sales');
    await press('Create team');
    expect(await screen.findAllByText('A team with that name already exists.')).not.toHaveLength(0);
    expect(await screen.findByText(/Create team failed:/)).toBeTruthy();
    expect(router.back).not.toHaveBeenCalled();
  });

  it('says when nobody is in the workspace yet to add', async () => {
    membersCall.mockResolvedValue(pageOf([]));
    await renderApp(<TeamFormScreen />);
    expect(await screen.findByText(/No teammates yet — invite some first/)).toBeTruthy();
  });

  it('says when the teammates could not be loaded', async () => {
    membersCall.mockRejectedValue(new ApiError(0, 'CLIENT_NETWORK', 'x'));
    await renderApp(<TeamFormScreen />);
    expect(await screen.findByText('Teammates could not be loaded.')).toBeTruthy();
  });

  it('does not offer the form to a person who may not manage teams', async () => {
    summaryCall.mockResolvedValue(readOnlySummary);
    await renderApp(<TeamFormScreen />);
    expect(await screen.findByText('You do not have permission to do that.')).toBeTruthy();
    expect(screen.queryByLabelText('Team name')).toBeNull();
  });
});

describe('TeamFormScreen: an existing team', () => {
  beforeEach(() => {
    jest.mocked(useLocalSearchParams).mockReturnValue({ teamId: sales.id });
  });

  it('starts from the team and saves with the version that was read, never sending devices', async () => {
    updateCall.mockResolvedValue(sales);
    await renderApp(<TeamFormScreen />);
    expect((await screen.findByLabelText('Team name')).props.value).toBe('Sales');
    expect(
      (await screen.findByRole('checkbox', { name: 'Meera Nair' })).props.accessibilityState
        .checked,
    ).toBe(true);
    expect(
      screen.getByRole('checkbox', { name: 'Olivia Owner' }).props.accessibilityState.checked,
    ).toBe(false);
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Meera Nair' }));
    await fill('Team name', 'Sales EU');
    await press('Save changes');
    await waitFor(() =>
      expect(updateCall).toHaveBeenCalledWith(sales.id, {
        name: 'Sales EU',
        color: '#13478A',
        assignmentStrategy: 'round_robin',
        memberIds: [me.id],
        rowVersion: 4,
      }),
    );
    await waitFor(() => expect(router.back).toHaveBeenCalled());
  });

  it('reads the list again when someone else changed the team, and says why the save failed', async () => {
    updateCall.mockRejectedValue(new ApiError(409, 'ROW_VERSION_CONFLICT', 'x'));
    await renderApp(<TeamFormScreen />);
    await fill('Team name', 'Sales EU');
    const reads = listCall.mock.calls.length;
    await press('Save changes');
    expect(
      await screen.findByText(
        'Update failed: Someone else changed this at the same time. Reload and try again.',
      ),
    ).toBeTruthy();
    await waitFor(() => expect(listCall.mock.calls.length).toBeGreaterThan(reads));
  });

  it('asks before deleting, then deletes and goes back', async () => {
    deleteCall.mockResolvedValue(undefined);
    await renderApp(<TeamFormScreen />);
    await press('Delete team');
    expect(await screen.findByText('Delete this team?')).toBeTruthy();
    expect(
      screen.getByText(
        'Delete team "Sales"? Conversations assigned to this team will become unassigned.',
      ),
    ).toBeTruthy();
    await fireEvent.press(screen.getAllByRole('button', { name: 'Delete team' }).at(-1)!);
    await waitFor(() => expect(deleteCall).toHaveBeenCalledWith(sales.id));
    await waitFor(() => expect(router.back).toHaveBeenCalled());
  });

  it('keeps the team when the person cancels, and says why a deletion failed', async () => {
    deleteCall.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'x'));
    await renderApp(<TeamFormScreen />);
    await press('Delete team');
    await fireEvent.press((await screen.findAllByRole('button', { name: 'Cancel' })).at(-1)!);
    expect(deleteCall).not.toHaveBeenCalled();
    await press('Delete team');
    await fireEvent.press(screen.getAllByRole('button', { name: 'Delete team' }).at(-1)!);
    expect(
      await screen.findByText('Delete failed: You do not have permission to do that.'),
    ).toBeTruthy();
  });

  it('says so when the team was deleted meanwhile', async () => {
    listCall.mockResolvedValue(teamPageOf([]));
    await renderApp(<TeamFormScreen />);
    expect(await screen.findByText('That no longer exists. Reload the page.')).toBeTruthy();
  });

  it('finds the team on a later page of the list', async () => {
    listCall
      .mockResolvedValueOnce({ data: [], page: { nextCursor: 'c2', hasMore: true, limit: 50 } })
      .mockResolvedValueOnce(teamPageOf([sales]));
    await renderApp(<TeamFormScreen />);
    expect((await screen.findByLabelText('Team name')).props.value).toBe('Sales');
    expect(listCall).toHaveBeenLastCalledWith('c2', expect.anything());
  });
});
