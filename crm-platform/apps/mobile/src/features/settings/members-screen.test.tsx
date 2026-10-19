import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useRouter } from 'expo-router';
import { Share } from 'react-native';
import { ApiError } from '@/lib/api';
import { fetchSession } from '@/lib/session/api';
import { session } from '@/test/dashboard-fixtures';
import {
  MANAGER_ROLE,
  agent,
  me,
  owner,
  pageOf,
  pendingAgent,
  readOnlySummary,
  summary,
} from '@/test/members-fixtures';
import { renderApp } from '@/test/render';
import * as api from './members-api';
import { MembersScreen } from './members-screen';

jest.mock('./members-api');
jest.mock('@/lib/session/api');
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));

const listCall = jest.mocked(api.fetchMembers);
const summaryCall = jest.mocked(api.fetchMembersSummary);
const roleCall = jest.mocked(api.changeMemberRole);
const removeCall = jest.mocked(api.removeMember);
const resetCall = jest.mocked(api.resetMemberPassword);
const resendCall = jest.mocked(api.resendInvite);
const router = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn() };

const press = async (name: string | RegExp) =>
  await fireEvent.press(await screen.findByRole('button', { name }));
const openActions = async (name: string) => await press(`Actions for ${name}`);

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(useRouter).mockReturnValue(router as unknown as ReturnType<typeof useRouter>);
  router.canGoBack.mockReturnValue(true);
  jest.mocked(fetchSession).mockResolvedValue(session);
  summaryCall.mockResolvedValue(summary);
  listCall.mockResolvedValue(pageOf([owner, me, agent, pendingAgent]));
});

describe('MembersScreen: the list', () => {
  it('shows each member with their role and state, and who you are', async () => {
    await renderApp(<MembersScreen />);
    expect(
      await screen.findByLabelText('Olivia Owner, olivia@example.test, Owner, Online'),
    ).toBeTruthy();
    expect(screen.getByLabelText('Meera Nair, meera@example.test, Agent, Away')).toBeTruthy();
    expect(screen.getByLabelText('Rohan Mehta, rohan@example.test, Agent, pending')).toBeTruthy();
    expect(screen.getByText('You')).toBeTruthy();
    expect(screen.getByText(/Everyone with access to Acme Ltd/)).toBeTruthy();
    expect(screen.getByText('4 members')).toBeTruthy();
  });

  it('shows the seats and the invite button to a person who may invite', async () => {
    await renderApp(<MembersScreen />);
    expect(await screen.findByText('4 of 10 seats')).toBeTruthy();
    await press('Invite teammate');
    expect(router.push).toHaveBeenCalledWith('/member-invite');
  });

  it('says when all the seats are used', async () => {
    summaryCall.mockResolvedValue({ ...summary, seats: { used: 10, limit: 10 } });
    await renderApp(<MembersScreen />);
    expect(await screen.findByText('10 of 10 seats: all in use')).toBeTruthy();
  });

  it('shows no invite button, and no dots, to a person who may only read', async () => {
    summaryCall.mockResolvedValue(readOnlySummary);
    await renderApp(<MembersScreen />);
    await screen.findByLabelText(/^Meera Nair,/);
    expect(screen.queryByRole('button', { name: 'Invite teammate' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Actions for / })).toBeNull();
  });

  it("filters by role with the server's counts, and hides the custom role until someone has one", async () => {
    await renderApp(<MembersScreen />);
    expect(await screen.findByRole('radio', { name: 'Agents (2)' })).toBeTruthy();
    expect(screen.queryByRole('radio', { name: /Custom roles/ })).toBeNull();
    await fireEvent.press(screen.getByRole('radio', { name: 'Agents (2)' }));
    await waitFor(() =>
      expect(listCall).toHaveBeenLastCalledWith(
        { q: '', tier: 'agent' },
        undefined,
        expect.anything(),
      ),
    );
  });

  it('searches by name or email, after a pause', async () => {
    await renderApp(<MembersScreen />);
    await screen.findByLabelText(/^Meera Nair,/);
    await fireEvent.changeText(screen.getByLabelText('Search members'), ' meera ');
    await waitFor(() =>
      expect(listCall).toHaveBeenLastCalledWith(
        { q: 'meera', tier: undefined },
        undefined,
        expect.anything(),
      ),
    );
  });

  it('says so when no member matches, and when there are none', async () => {
    listCall.mockResolvedValue(pageOf([]));
    await renderApp(<MembersScreen />);
    expect(await screen.findByText('No members found yet.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Search members'), 'zzz');
    expect(await screen.findByText('No members match this view.')).toBeTruthy();
  });

  it('shows a failure with a way to try again', async () => {
    summaryCall.mockRejectedValueOnce(new ApiError(0, 'CLIENT_NETWORK', 'x'));
    await renderApp(<MembersScreen />);
    expect(await screen.findByText(/Can't reach the server/)).toBeTruthy();
    await press('Try again');
    expect(await screen.findByLabelText(/^Meera Nair,/)).toBeTruthy();
  });

  it('goes back, or to the menu when there is nothing to go back to', async () => {
    router.canGoBack.mockReturnValue(false);
    await renderApp(<MembersScreen />);
    await press('Back');
    expect(router.replace).toHaveBeenCalledWith('/menu');
  });
});

describe('MembersScreen: the actions', () => {
  it('offers actions only on the rows the person may act on: not themselves, not an owner', async () => {
    await renderApp(<MembersScreen />);
    await screen.findByLabelText(/^Meera Nair,/);
    expect(screen.queryByRole('button', { name: 'Actions for Asha Verma' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Actions for Olivia Owner' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Actions for Meera Nair' })).toBeTruthy();
  });

  it('offers Change role, Reset password and Remove for an active member, and Resend invite for a pending one', async () => {
    await renderApp(<MembersScreen />);
    await openActions('Meera Nair');
    expect(screen.getByRole('button', { name: 'Change role' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reset password' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove from workspace' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Resend invite' })).toBeNull();
    await press('Cancel');
    await openActions('Rohan Mehta');
    expect(screen.getByRole('button', { name: 'Resend invite' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reset password' })).toBeNull();
  });

  it('changes a role with the version that was read, from the roles the person may give', async () => {
    roleCall.mockResolvedValue(agent);
    await renderApp(<MembersScreen />);
    await openActions('Meera Nair');
    await press('Change role');
    expect(screen.queryByRole('radio', { name: 'Owner' })).toBeNull();
    expect(screen.getByRole('radio', { name: 'Agent' }).props.accessibilityState.selected).toBe(
      true,
    );
    await fireEvent.press(screen.getByRole('radio', { name: 'Manager' }));
    await waitFor(() =>
      expect(roleCall).toHaveBeenCalledWith(agent.id, { roleId: MANAGER_ROLE.id, rowVersion: 3 }),
    );
    expect(await screen.findByText('Role updated.')).toBeTruthy();
  });

  it('says why a role change was refused, by error code', async () => {
    roleCall.mockRejectedValue(new ApiError(403, 'RBAC_ROLE_GRANT_FORBIDDEN', 'x'));
    await renderApp(<MembersScreen />);
    await openActions('Meera Nair');
    await press('Change role');
    await fireEvent.press(screen.getByRole('radio', { name: 'Manager' }));
    expect(
      await screen.findByText("Update failed: You don't have permission to grant that role."),
    ).toBeTruthy();
  });

  it('asks before removing, then removes', async () => {
    removeCall.mockResolvedValue(undefined);
    await renderApp(<MembersScreen />);
    await openActions('Meera Nair');
    await press('Remove from workspace');
    expect(await screen.findByText('Remove member?')).toBeTruthy();
    expect(
      screen.getByText("Remove Meera Nair from this workspace? They'll lose access immediately."),
    ).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(removeCall).toHaveBeenCalledWith(agent.id));
    expect(await screen.findByText('Removed.')).toBeTruthy();
  });

  it('keeps the member when the person cancels, and says why a removal was refused', async () => {
    removeCall.mockRejectedValue(new ApiError(409, 'RBAC_LAST_OWNER', 'x'));
    await renderApp(<MembersScreen />);
    await openActions('Meera Nair');
    await press('Remove from workspace');
    await fireEvent.press((await screen.findAllByRole('button', { name: 'Cancel' })).at(-1)!);
    expect(removeCall).not.toHaveBeenCalled();
    await openActions('Meera Nair');
    await press('Remove from workspace');
    await fireEvent.press(screen.getByRole('button', { name: 'Remove' }));
    expect(
      await screen.findByText('Remove failed: A workspace needs at least one owner.'),
    ).toBeTruthy();
  });

  it('asks before resetting a password, then says the link was emailed', async () => {
    resetCall.mockResolvedValue({ member: agent, emailSent: true, inviteLink: null });
    await renderApp(<MembersScreen />);
    await openActions('Meera Nair');
    await press('Reset password');
    expect(await screen.findByText('Reset password?')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Send reset link' }));
    await waitFor(() => expect(resetCall).toHaveBeenCalledWith(agent.id));
    expect(
      await screen.findByText(
        'Password reset. We emailed meera@example.test a link to set a new password.',
      ),
    ).toBeTruthy();
  });

  it('shows a one-time link to pass on when the server cannot send mail, and shares it', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'dismissedAction' });
    resendCall.mockResolvedValue({
      member: pendingAgent,
      emailSent: false,
      inviteLink: 'https://app.example.test/accept?t=abc',
    });
    await renderApp(<MembersScreen />);
    await openActions('Rohan Mehta');
    await press('Resend invite');
    expect(await screen.findByText('Link for Rohan Mehta')).toBeTruthy();
    expect(screen.getByTestId('member-link').props.children).toBe(
      'https://app.example.test/accept?t=abc',
    );
    expect(screen.getByText(/expires after 7 days/)).toBeTruthy();
    await press('Share link');
    expect(share).toHaveBeenCalledWith({ message: 'https://app.example.test/accept?t=abc' });
    await press('Dismiss');
    expect(screen.queryByText('Link for Rohan Mehta')).toBeNull();
  });

  it('says the invite was sent again when the mail went out', async () => {
    resendCall.mockResolvedValue({ member: pendingAgent, emailSent: true, inviteLink: null });
    await renderApp(<MembersScreen />);
    await openActions('Rohan Mehta');
    await press('Resend invite');
    expect(await screen.findByText('Invite sent again to rohan@example.test.')).toBeTruthy();
    expect(screen.queryByTestId('member-link')).toBeNull();
  });

  it('says a resend failed', async () => {
    resendCall.mockRejectedValue(new ApiError(409, 'WSP_INVITE_NOT_PENDING', 'x'));
    await renderApp(<MembersScreen />);
    await openActions('Rohan Mehta');
    await press('Resend invite');
    expect(
      await screen.findByText('Resend failed: That invitation was already accepted.'),
    ).toBeTruthy();
  });
});
