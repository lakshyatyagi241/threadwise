import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useRouter } from 'expo-router';
import { Share } from 'react-native';
import { ApiError } from '@/lib/api';
import {
  AGENT_ROLE,
  VIEWER_ROLE,
  pendingAgent,
  readOnlySummary,
  summary,
} from '@/test/members-fixtures';
import { renderApp } from '@/test/render';
import * as api from './members-api';
import { MemberInviteScreen } from './member-invite-screen';

jest.mock('./members-api');
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));

const summaryCall = jest.mocked(api.fetchMembersSummary);
const inviteCall = jest.mocked(api.inviteMember);
const router = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn() };

const fill = async (label: string, value: string) =>
  await fireEvent.changeText(await screen.findByLabelText(label), value);
const press = async (name: string | RegExp) =>
  await fireEvent.press(await screen.findByRole('button', { name }));

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(useRouter).mockReturnValue(router as unknown as ReturnType<typeof useRouter>);
  router.canGoBack.mockReturnValue(true);
  summaryCall.mockResolvedValue(summary);
});

describe('MemberInviteScreen', () => {
  it('asks for a name, an email and a role, starting on the first role (agent), and shows the seats', async () => {
    await renderApp(<MemberInviteScreen />);
    expect(await screen.findByLabelText('Full name')).toBeTruthy();
    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Workspace role' }).props.accessibilityValue.text,
    ).toBe('Agent — handles assigned conversations only');
    expect(screen.getByText('4 of 10 seats')).toBeTruthy();
  });

  it('checks the fields before calling the API', async () => {
    await renderApp(<MemberInviteScreen />);
    await fill('Email', 'nope');
    await press('Send invite');
    expect(await screen.findByText("Enter the person's name.")).toBeTruthy();
    expect(screen.getByText('Enter a valid email address.')).toBeTruthy();
    expect(inviteCall).not.toHaveBeenCalled();
  });

  it('sends the invitation with the chosen role and says the mail went out', async () => {
    inviteCall.mockResolvedValue({ member: pendingAgent, emailSent: true, inviteLink: null });
    await renderApp(<MemberInviteScreen />);
    await fill('Full name', ' Rohan Mehta ');
    await fill('Email', 'rohan@example.test');
    await press('Workspace role');
    await fireEvent.press(await screen.findByText('Viewer — read-only'));
    await press('Send invite');
    await waitFor(() =>
      expect(inviteCall).toHaveBeenCalledWith({
        fullName: 'Rohan Mehta',
        email: 'rohan@example.test',
        roleId: VIEWER_ROLE.id,
      }),
    );
    expect(
      await screen.findByText('Invite sent to rohan@example.test. The link works for 7 days.'),
    ).toBeTruthy();
    await press('Done');
    expect(router.back).toHaveBeenCalled();
  });

  it('shows the one-time link to share when the server cannot send mail', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'dismissedAction' });
    inviteCall.mockResolvedValue({
      member: pendingAgent,
      emailSent: false,
      inviteLink: 'https://app.example.test/accept?t=xyz',
    });
    await renderApp(<MemberInviteScreen />);
    await fill('Full name', 'Rohan Mehta');
    await fill('Email', 'rohan@example.test');
    await press('Send invite');
    expect(await screen.findByText('Rohan Mehta added.')).toBeTruthy();
    expect(screen.getByTestId('member-link').props.children).toBe(
      'https://app.example.test/accept?t=xyz',
    );
    await press('Share link');
    expect(share).toHaveBeenCalledWith({ message: 'https://app.example.test/accept?t=xyz' });
  });

  it("says the seats are all used when the plan's limit stops the invitation", async () => {
    inviteCall.mockRejectedValue(new ApiError(402, 'PLAN_LIMIT_REACHED', 'x'));
    await renderApp(<MemberInviteScreen />);
    await fill('Full name', 'Rohan Mehta');
    await fill('Email', 'rohan@example.test');
    await press('Send invite');
    expect(
      await screen.findByText(
        'Your plan allows 10 seats and all are in use. Upgrade your plan to add more people.',
      ),
    ).toBeTruthy();
  });

  it('says the person is already a member, and the offline sentence', async () => {
    inviteCall
      .mockRejectedValueOnce(new ApiError(409, 'WSP_ALREADY_MEMBER', 'x'))
      .mockRejectedValueOnce(new ApiError(0, 'CLIENT_NETWORK', 'x'));
    await renderApp(<MemberInviteScreen />);
    await fill('Full name', 'Rohan Mehta');
    await fill('Email', 'rohan@example.test');
    await press('Send invite');
    expect(
      await screen.findByText('That person is already a member of this workspace.'),
    ).toBeTruthy();
    await press('Send invite');
    expect(await screen.findByText(/Can't reach the server/)).toBeTruthy();
  });

  it('does not offer the form to a person who may not invite', async () => {
    summaryCall.mockResolvedValue(readOnlySummary);
    await renderApp(<MemberInviteScreen />);
    expect(await screen.findByText('You do not have permission to do that.')).toBeTruthy();
    expect(screen.queryByLabelText('Full name')).toBeNull();
  });

  it('shows a failure to load with a way to try again, and goes back to the list when there is nothing to go back to', async () => {
    summaryCall
      .mockRejectedValueOnce(new ApiError(0, 'CLIENT_NETWORK', 'x'))
      .mockResolvedValue(summary);
    router.canGoBack.mockReturnValue(false);
    await renderApp(<MemberInviteScreen />);
    expect(await screen.findByText(/Can't reach the server/)).toBeTruthy();
    await press('Try again');
    expect(await screen.findByLabelText('Full name')).toBeTruthy();
    await press('Back');
    expect(router.replace).toHaveBeenCalledWith('/members');
    void AGENT_ROLE;
  });
});
