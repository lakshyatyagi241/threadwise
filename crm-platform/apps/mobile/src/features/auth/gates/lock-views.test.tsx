import type { SessionResponse } from '@crm/contracts';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { ApiError } from '@/lib/api';
import { signOut } from '@/lib/auth/sign-out';
import { clearWorkspaceSuspended } from '@/lib/session/account-gate';
import { fetchSession } from '@/lib/session/api';
import { sessionKey } from '@/lib/session/use-session';
import { session } from '@/test/dashboard-fixtures';
import { renderApp } from '@/test/render';
import { fetchPasswordPolicy } from '../api';
import * as api from './gates-api';
import { PasswordView } from './password-view';
import { SuspendedView } from './suspended-view';
import { VerifyEmailView } from './verify-email-view';

jest.mock('./gates-api');
jest.mock('../api');
jest.mock('@/lib/session/api');
jest.mock('@/lib/auth/sign-out');

const gated = (over: Partial<SessionResponse['flags']>): SessionResponse => ({
  ...session,
  flags: { ...session.flags, ...over },
});

const press = async (name: string) =>
  await fireEvent.press(await screen.findByRole('button', { name }));
const fill = async (label: string, value: string) =>
  await fireEvent.changeText(await screen.findByLabelText(label), value);

beforeEach(() => {
  jest.resetAllMocks();
  clearWorkspaceSuspended();
  jest.mocked(signOut).mockResolvedValue(undefined);
  jest.mocked(fetchPasswordPolicy).mockResolvedValue({
    minLength: 10,
    requireMixedCase: true,
    requireNumber: true,
    requireSymbol: false,
  });
});

describe('SuspendedView', () => {
  const show = async () => {
    const view = await renderApp(<SuspendedView session={gated({ suspended: true })} />);
    view.queryClient.setQueryDefaults(sessionKey, { queryFn: () => fetchSession() });
    view.queryClient.setQueryData(sessionKey, gated({ suspended: true }));
    return view;
  };

  it('greets the person by name and says who to ask', async () => {
    await show();
    expect(await screen.findByText('Your account is suspended')).toBeTruthy();
    expect(
      screen.getByText(/Hi Asha Verma, an administrator has suspended this account/),
    ).toBeTruthy();
    expect(screen.getByText(/ask your workspace owner or administrator/)).toBeTruthy();
  });

  it('reads the session again when the person checks', async () => {
    jest.mocked(fetchSession).mockResolvedValue(gated({ suspended: true }));
    await show();
    await press('Check again');
    await waitFor(() => expect(fetchSession).toHaveBeenCalled());
  });

  it('signs out', async () => {
    await show();
    await press('Sign out');
    await waitFor(() => expect(signOut).toHaveBeenCalled());
  });
});

describe('VerifyEmailView', () => {
  const blocked = gated({ emailBlocked: true, emailUnverified: true });
  const show = async () => {
    const view = await renderApp(<VerifyEmailView session={blocked} />);
    view.queryClient.setQueryDefaults(sessionKey, { queryFn: () => fetchSession() });
    view.queryClient.setQueryData(sessionKey, blocked);
    return view;
  };

  it('shows the address the link went to', async () => {
    await show();
    expect(await screen.findByText('Please verify your email')).toBeTruthy();
    expect(screen.getByText('asha@example.test')).toBeTruthy();
  });

  it('sends the mail again, says so, and makes the person wait a minute', async () => {
    jest.mocked(api.resendVerification).mockResolvedValue({ sent: true, alreadyVerified: false });
    await show();
    await press('Resend verification email');
    expect(await screen.findByText('We sent a new link to asha@example.test.')).toBeTruthy();
    const wait = await screen.findByRole('button', { name: /^Resend in \d+s$/ });
    expect(wait.props.accessibilityState.disabled).toBe(true);
  });

  it('says so, and starts no wait, when the mail could not be sent', async () => {
    jest.mocked(api.resendVerification).mockResolvedValue({
      sent: false,
      alreadyVerified: false,
      reason: 'not_configured',
    });
    await show();
    await press('Resend verification email');
    expect(await screen.findByText('We could not send the email just now.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resend verification email' })).toBeTruthy();
  });

  it('waits as long as the server says when it was asked too soon', async () => {
    jest
      .mocked(api.resendVerification)
      .mockRejectedValue(
        new ApiError(429, 'RATE_LIMITED', 'x', undefined, [
          { path: 'retryAfterSeconds', message: '42' },
        ]),
      );
    await show();
    await press('Resend verification email');
    expect(await screen.findByText(/A link was sent a moment ago/)).toBeTruthy();
    expect(
      await screen.findByRole('button', { name: /^Resend in 4\d s$|^Resend in 42s$/ }),
    ).toBeTruthy();
  });

  it('reads the session again when the address was verified meanwhile', async () => {
    jest.mocked(api.resendVerification).mockResolvedValue({ sent: false, alreadyVerified: true });
    jest.mocked(fetchSession).mockResolvedValue(session);
    await show();
    await press('Resend verification email');
    expect(await screen.findByText(/already verified/)).toBeTruthy();
    await waitFor(() => expect(fetchSession).toHaveBeenCalled());
  });

  it('says the address is not verified yet when the person taps the button too early', async () => {
    jest.mocked(fetchSession).mockResolvedValue(blocked);
    await show();
    await press("I've verified my email");
    expect(await screen.findByText(/Your email is not verified yet/)).toBeTruthy();
  });

  it('shows an error when the mail could not be asked for at all', async () => {
    jest.mocked(api.resendVerification).mockRejectedValue(new ApiError(0, 'CLIENT_NETWORK', 'x'));
    await show();
    await press('Resend verification email');
    expect(await screen.findByText(/Can't reach the server/)).toBeTruthy();
  });
});

describe('PasswordView', () => {
  const show = async () => {
    const view = await renderApp(<PasswordView />);
    view.queryClient.setQueryDefaults(sessionKey, { queryFn: () => fetchSession() });
    view.queryClient.setQueryData(sessionKey, gated({ passwordChangeRequired: true }));
    return view;
  };
  const fillAll = async (current: string, next: string, confirm: string) => {
    await fill('Current password', current);
    await fill('New password', next);
    await fill('Confirm new password', confirm);
  };

  it('explains why it is there and lists the rules the new password must meet', async () => {
    await show();
    expect(
      await screen.findByText(/You need to set a new password before you can continue/),
    ).toBeTruthy();
    expect(await screen.findByLabelText('Minimum length: 10.')).toBeTruthy();
  });

  it('checks the entries before calling the API', async () => {
    await show();
    await fillAll('', 'short', 'different');
    await press('Update password');
    expect(await screen.findByText('Enter your current password.')).toBeTruthy();
    expect(screen.getByText('The two passwords do not match.')).toBeTruthy();
    expect(api.changePassword).not.toHaveBeenCalled();
  });

  it('refuses a new password that is the current one', async () => {
    await show();
    await fillAll('Sunrise-Pass-2026', 'Sunrise-Pass-2026', 'Sunrise-Pass-2026');
    await press('Update password');
    expect(
      await screen.findByText('Choose a password different from your current one.'),
    ).toBeTruthy();
    expect(api.changePassword).not.toHaveBeenCalled();
  });

  it('changes the password, then reads the session again so the lock screen can go', async () => {
    jest.mocked(api.changePassword).mockResolvedValue(undefined);
    const view = await show();
    const invalidate = jest.spyOn(view.queryClient, 'invalidateQueries');
    await fillAll('Old-Password-1', 'New-Password-2026', 'New-Password-2026');
    await press('Update password');
    await waitFor(() =>
      expect(api.changePassword).toHaveBeenCalledWith({
        currentPassword: 'Old-Password-1',
        newPassword: 'New-Password-2026',
      }),
    );
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: sessionKey }));
  });

  it('says the current password is wrong, by error code', async () => {
    jest
      .mocked(api.changePassword)
      .mockRejectedValue(new ApiError(422, 'AUTH_CURRENT_PASSWORD_WRONG', 'whatever'));
    await show();
    await fillAll('Wrong-Password-1', 'New-Password-2026', 'New-Password-2026');
    await press('Update password');
    expect(await screen.findByText('That password is not correct.')).toBeTruthy();
  });

  it('lists the rules the server says the password broke', async () => {
    jest
      .mocked(api.changePassword)
      .mockRejectedValue(
        new ApiError(422, 'AUTH_PASSWORD_POLICY', 'x', undefined, [
          { path: 'newPassword.common', message: 'too common' },
        ]),
      );
    await show();
    await fillAll('Old-Password-1', 'Password-12345', 'Password-12345');
    await press('Update password');
    expect(await screen.findByText(/too easy to guess/)).toBeTruthy();
  });

  it('shows the offline sentence when the server cannot be reached, and keeps what was typed', async () => {
    jest.mocked(api.changePassword).mockRejectedValue(new ApiError(0, 'CLIENT_NETWORK', 'x'));
    await show();
    await fillAll('Old-Password-1', 'New-Password-2026', 'New-Password-2026');
    await press('Update password');
    expect(await screen.findByText(/Can't reach the server/)).toBeTruthy();
    expect((await screen.findByLabelText('Current password')).props.value).toBe('Old-Password-1');
  });

  it('signs out', async () => {
    await show();
    await act(async () => undefined);
    await press('Sign out');
    await waitFor(() => expect(signOut).toHaveBeenCalled());
  });
});
