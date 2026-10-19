import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react-native';
import * as Linking from 'expo-linking';
import { Share } from 'react-native';
import { ApiError } from '@/lib/api';
import { signOut } from '@/lib/auth/sign-out';
import { clearWorkspaceSuspended } from '@/lib/session/account-gate';
import { fetchSession } from '@/lib/session/api';
import { sessionKey } from '@/lib/session/use-session';
import { session } from '@/test/dashboard-fixtures';
import { renderApp } from '@/test/render';
import * as api from './gates-api';
import { MfaView } from './mfa-view';
import { clearRecoveryCodes, setRecoveryCodes } from './recovery-codes-store';
import { useAccountGate } from './use-account-gate';

jest.mock('./gates-api');
jest.mock('@/lib/session/api');
jest.mock('@/lib/auth/sign-out');
jest.mock('expo-linking', () => ({ openURL: jest.fn() }));

const SECRET = 'JBSWY3DPEHPK3PXP';
const OTPAUTH = `otpauth://totp/Acme:asha@example.test?secret=${SECRET}&issuer=Acme`;
const setup = { secret: SECRET, otpauthUrl: OTPAUTH, expiresInSeconds: 600 };
const CODES = ['aaaa-1111', 'bbbb-2222', 'cccc-3333'];

const show = async () => {
  const view = await renderApp(<MfaView />);
  view.queryClient.setQueryDefaults(sessionKey, { queryFn: () => fetchSession() });
  view.queryClient.setQueryData(sessionKey, {
    ...session,
    flags: { ...session.flags, mfaEnrolmentRequired: true },
  });
  return view;
};
const press = async (name: string) =>
  await fireEvent.press(await screen.findByRole('button', { name }));
const type = async (label: string, value: string) =>
  await fireEvent.changeText(await screen.findByLabelText(label), value);

beforeEach(() => {
  jest.resetAllMocks();
  clearRecoveryCodes();
  clearWorkspaceSuspended();
  jest.mocked(signOut).mockResolvedValue(undefined);
  jest.mocked(api.startMfaSetup).mockResolvedValue(setup);
});

describe('MfaView: setting up the authenticator', () => {
  it('explains why it is there, makes the key, and shows it to type by hand', async () => {
    await show();
    expect(
      await screen.findByText(/Your organization requires two-factor authentication/),
    ).toBeTruthy();
    expect((await screen.findByTestId('gate-mfa-secret')).props.children).toBe(SECRET);
    expect(api.startMfaSetup).toHaveBeenCalledWith({});
    expect(screen.getByText(/Tap the button to add it to your authenticator app/)).toBeTruthy();
  });

  it('opens the authenticator app with the otpauth link', async () => {
    jest.mocked(Linking.openURL).mockResolvedValue(true);
    await show();
    await press('Open authenticator app');
    expect(Linking.openURL).toHaveBeenCalledWith(OTPAUTH);
    expect(screen.queryByText(/No authenticator app was found/)).toBeNull();
  });

  it('says so, and leaves the key to type, when no app handles the link', async () => {
    jest.mocked(Linking.openURL).mockRejectedValue(new Error('no handler'));
    await show();
    await press('Open authenticator app');
    expect(await screen.findByText(/No authenticator app was found on this phone/)).toBeTruthy();
    expect(screen.getByTestId('gate-mfa-secret')).toBeTruthy();
  });

  it('checks that the code is six digits before calling the API', async () => {
    await show();
    await type('Six-digit code', '12ab');
    await press('Turn on');
    expect(await screen.findByText('Enter the six digits from your app.')).toBeTruthy();
    expect(api.enableMfa).not.toHaveBeenCalled();
  });

  it('says the code is wrong, by error code, and lets the person try the next one', async () => {
    jest.mocked(api.enableMfa).mockRejectedValue(new ApiError(422, 'AUTH_MFA_INVALID_CODE', 'x'));
    await show();
    await type('Six-digit code', '123456');
    await press('Turn on');
    expect(await screen.findByText(/That code is not right or has expired/)).toBeTruthy();
    expect(screen.getByTestId('gate-mfa-secret')).toBeTruthy();
  });

  it('offers to start again when the ten minutes ran out', async () => {
    jest.mocked(api.enableMfa).mockRejectedValue(new ApiError(410, 'AUTH_MFA_SETUP_EXPIRED', 'x'));
    await show();
    await type('Six-digit code', '123456');
    await press('Turn on');
    expect(await screen.findByText(/This setup expired/)).toBeTruthy();
    expect(screen.queryByTestId('gate-mfa-secret')).toBeNull();
    await press('Start again');
    expect(await screen.findByTestId('gate-mfa-secret')).toBeTruthy();
    expect(api.startMfaSetup).toHaveBeenCalledTimes(2);
  });

  it('offers to try again when the key could not be made', async () => {
    jest.mocked(api.startMfaSetup).mockRejectedValueOnce(new ApiError(0, 'CLIENT_NETWORK', 'x'));
    await show();
    expect(await screen.findByText(/Can't reach the server/)).toBeTruthy();
    await press('Try again');
    expect(await screen.findByTestId('gate-mfa-secret')).toBeTruthy();
  });
});

describe('MfaView: an old session asks for the password', () => {
  it('asks for the password before the key, then makes the key with it', async () => {
    jest
      .mocked(api.startMfaSetup)
      .mockRejectedValueOnce(new ApiError(403, 'AUTH_REAUTH_REQUIRED', 'x'))
      .mockResolvedValue(setup);
    await show();
    expect(await screen.findByText(/It has been a while since you signed in/)).toBeTruthy();
    await type('Current password', 'Old-Password-1');
    await press('Turn on');
    expect(await screen.findByTestId('gate-mfa-secret')).toBeTruthy();
    expect(api.startMfaSetup).toHaveBeenLastCalledWith({ password: 'Old-Password-1' });
  });

  it('asks for the password when the code is entered after the session got old, then finishes with it', async () => {
    jest
      .mocked(api.enableMfa)
      .mockRejectedValueOnce(new ApiError(403, 'AUTH_REAUTH_REQUIRED', 'x'))
      .mockResolvedValue({ recoveryCodes: CODES });
    await show();
    await type('Six-digit code', '123456');
    await press('Turn on');
    await type('Current password', 'Old-Password-1');
    await press('Turn on');
    expect(await screen.findByText('aaaa-1111')).toBeTruthy();
    expect(api.enableMfa).toHaveBeenLastCalledWith({ code: '123456', password: 'Old-Password-1' });
  });

  it('says the password is wrong, by error code, and asks again', async () => {
    jest
      .mocked(api.startMfaSetup)
      .mockRejectedValueOnce(new ApiError(403, 'AUTH_REAUTH_REQUIRED', 'x'))
      .mockRejectedValueOnce(new ApiError(422, 'AUTH_CURRENT_PASSWORD_WRONG', 'x'));
    await show();
    await type('Current password', 'Wrong-Password-1');
    await press('Turn on');
    expect(await screen.findByText('That password is not correct.')).toBeTruthy();
  });

  it('asks for a password that was left empty', async () => {
    jest
      .mocked(api.startMfaSetup)
      .mockRejectedValueOnce(new ApiError(403, 'AUTH_REAUTH_REQUIRED', 'x'));
    await show();
    await press('Turn on');
    expect(await screen.findByText('Enter your current password.')).toBeTruthy();
  });
});

describe('MfaView: the recovery codes', () => {
  const finishSetup = async () => {
    jest.mocked(api.enableMfa).mockResolvedValue({ recoveryCodes: CODES });
    const view = await show();
    await type('Six-digit code', '123456');
    await press('Turn on');
    await screen.findByText('aaaa-1111');
    return view;
  };

  it('shows the codes once two-factor is on, and drops the key', async () => {
    await finishSetup();
    for (const code of CODES) expect(screen.getByText(code)).toBeTruthy();
    expect(screen.getByText(/shown only once/)).toBeTruthy();
    expect(screen.queryByTestId('gate-mfa-secret')).toBeNull();
    expect(api.enableMfa).toHaveBeenCalledWith({ code: '123456' });
  });

  it('offers the codes to the share sheet (there is no clipboard library)', async () => {
    jest.spyOn(Share, 'share').mockResolvedValue({ action: 'dismissedAction' });
    await finishSetup();
    await press('Share codes');
    expect(Share.share).toHaveBeenCalledWith({ message: CODES.join('\n') });
  });

  it('does not let go until the person says they saved the codes, then reads the session again', async () => {
    const view = await finishSetup();
    const invalidate = jest.spyOn(view.queryClient, 'invalidateQueries');
    const done = await screen.findByRole('button', { name: 'I saved them' });
    expect(done.props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(
      screen.getByRole('checkbox', { name: 'I have saved these codes in a safe place.' }),
    );
    await press('I saved them');
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: sessionKey }));
    // The codes are gone from memory once they were acknowledged.
    expect(screen.queryByText('aaaa-1111')).toBeNull();
  });

  it('keeps showing the codes after the session says two-factor is on (the person came back from the authenticator app)', async () => {
    const view = await finishSetup();
    await act(async () => {
      view.queryClient.setQueryData(sessionKey, { ...session });
    });
    expect(screen.getByText('aaaa-1111')).toBeTruthy();
  });

  it('drops the codes from memory when the person signs out', async () => {
    await finishSetup();
    await press('Sign out');
    await waitFor(() => expect(signOut).toHaveBeenCalled());
    expect(screen.queryByText('aaaa-1111')).toBeNull();
  });
});

describe('useAccountGate and the recovery codes', () => {
  it('keeps the two-factor screen up while codes wait to be saved, even if no flag is set', async () => {
    const { result } = await renderHook(() => useAccountGate(session));
    expect(result.current).toBeNull();
    await act(async () => setRecoveryCodes(CODES));
    expect(result.current).toBe('mfa');
    await act(async () => clearRecoveryCodes());
    expect(result.current).toBeNull();
  });
});
