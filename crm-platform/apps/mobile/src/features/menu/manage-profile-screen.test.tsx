import type { ProfileResponse } from '@crm/contracts';
import type { QueryClient } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { ApiError } from '@/lib/api';
import { initI18n } from '@/lib/i18n';
import { renderApp } from '@/test/render';
import { ManageProfileScreen } from './manage-profile-screen';
import {
  confirmPhoneVerification,
  fetchProfile,
  resendPhoneVerification,
  startPhoneVerification,
  updateProfile,
} from './profile-api';

const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockCanGoBack = jest.fn(() => true);
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, replace: mockReplace, canGoBack: mockCanGoBack }),
}));
jest.mock('./profile-api');
jest.mock('@/lib/session/api');

const fetchCall = jest.mocked(fetchProfile);
const updateCall = jest.mocked(updateProfile);
const startCall = jest.mocked(startPhoneVerification);
const confirmCall = jest.mocked(confirmPhoneVerification);
const resendCall = jest.mocked(resendPhoneVerification);

const profile: ProfileResponse = {
  fullName: 'Asha Verma',
  displayName: 'Asha',
  email: 'asha@example.test',
  emailVerified: true,
  pendingEmail: null,
  phone: '+919812345678',
  locale: 'en',
  timezone: null,
  theme: 'paper',
  avatarUrl: null,
  effectiveTimezone: 'Asia/Kolkata',
  workspaceTimezone: 'Asia/Kolkata',
  canEditWorkspaceTimezone: false,
};

let client: QueryClient | undefined;
async function show() {
  const view = await renderApp(<ManageProfileScreen />);
  client = view.queryClient;
  await screen.findByLabelText('Full name');
  return view;
}
const save = () => fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));

beforeAll(async () => {
  await initI18n('en');
});
beforeEach(() => {
  jest.resetAllMocks();
  mockCanGoBack.mockReturnValue(true);
  client = undefined;
  fetchCall.mockResolvedValue(profile);
});
afterEach(async () => {
  if (client) {
    const cache = client;
    await waitFor(() => expect(cache.isFetching()).toBe(0));
  }
});

describe('ManageProfileScreen', () => {
  it('shows the profile, and the email and time zone as read-only', async () => {
    await show();
    expect(screen.getByLabelText('Full name').props.value).toBe('Asha Verma');
    expect(screen.getByLabelText('Display name').props.value).toBe('Asha');
    expect(screen.getByLabelText('Phone').props.value).toBe('+919812345678');
    expect(screen.getByLabelText('Email: asha@example.test')).toBeTruthy();
    expect(screen.getByLabelText('Workspace time zone: Asia/Kolkata')).toBeTruthy();
  });

  it('says when a new email is waiting for confirmation', async () => {
    fetchCall.mockResolvedValue({ ...profile, pendingEmail: 'new@example.test' });
    await show();
    expect(
      await screen.findByText(/new@example\.test is waiting for your confirmation/),
    ).toBeTruthy();
  });

  it('sends only what changed, and goes back', async () => {
    updateCall.mockResolvedValue({ ...profile, fullName: 'Asha V' });
    await show();
    await fireEvent.changeText(screen.getByLabelText('Full name'), '  Asha V ');
    await save();
    await waitFor(() =>
      expect(updateCall).toHaveBeenCalledWith({ fullName: 'Asha V' }, expect.any(String)),
    );
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
  });

  it('cleans a phone typed with spaces, and clears what is emptied', async () => {
    updateCall.mockResolvedValue({ ...profile, displayName: null, phone: '+919800000001' });
    await show();
    await fireEvent.changeText(screen.getByLabelText('Display name'), '   ');
    await fireEvent.changeText(screen.getByLabelText('Phone'), '+91 98000-00001');
    await save();
    await waitFor(() =>
      expect(updateCall).toHaveBeenCalledWith(
        { displayName: null, phone: '+919800000001' },
        expect.any(String),
      ),
    );
  });

  it('sends nothing when nothing changed', async () => {
    await show();
    await save();
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(updateCall).not.toHaveBeenCalled();
  });

  it('checks the name and the phone before sending anything', async () => {
    await show();
    await fireEvent.changeText(screen.getByLabelText('Full name'), '   ');
    await fireEvent.changeText(screen.getByLabelText('Phone'), '98123');
    await save();
    expect(await screen.findByText('Enter your name.')).toBeTruthy();
    expect(
      screen.getByText('Enter the phone number with the country code, for example +919876543210.'),
    ).toBeTruthy();
    expect(updateCall).not.toHaveBeenCalled();
  });

  it('shows what the server refused under the field', async () => {
    updateCall.mockRejectedValue(
      new ApiError(422, 'VALIDATION_FAILED', 'Invalid', undefined, [
        { path: 'phone', message: 'bad' },
      ]),
    );
    await show();
    await fireEvent.changeText(screen.getByLabelText('Phone'), '+919800000002');
    await save();
    expect(
      await screen.findByText(
        'Enter the phone number with the country code, for example +919876543210.',
      ),
    ).toBeTruthy();
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('shows any other failure above the form and stays', async () => {
    updateCall.mockRejectedValue(new ApiError(0, 'CLIENT_NETWORK', 'offline'));
    await show();
    await fireEvent.changeText(screen.getByLabelText('Full name'), 'Asha Verma Jr');
    await save();
    expect(await screen.findByText(/Can't reach the server/)).toBeTruthy();
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('says why the profile could not be loaded, and tries again', async () => {
    fetchCall.mockRejectedValueOnce(new ApiError(0, 'CLIENT_NETWORK', 'offline'));
    const view = await renderApp(<ManageProfileScreen />);
    client = view.queryClient;
    expect(await screen.findByText(/Can't reach the server/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByLabelText('Full name')).toBeTruthy();
  });
});

describe('ManageProfileScreen: verifying the phone number', () => {
  const challenge = {
    maskedPhone: '+91 •••• ••78',
    expiresInSeconds: 300,
    resendCooldownSeconds: 60,
    codeLength: 6,
  };
  const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }));

  it('says nothing about verification when the server does not tell whether the number is verified', async () => {
    await show();
    expect(screen.queryByText('Verified')).toBeNull();
    expect(screen.queryByText('Not verified')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Verify number' })).toBeNull();
  });

  it('shows a verified number as verified, with nothing to do', async () => {
    fetchCall.mockResolvedValue({ ...profile, phoneVerified: true });
    await show();
    expect(await screen.findByText('Verified')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Verify number' })).toBeNull();
  });

  it('offers to verify a number that is not verified yet', async () => {
    fetchCall.mockResolvedValue({ ...profile, phoneVerified: false });
    await show();
    expect(await screen.findByText('Not verified')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Verify number' })).toBeTruthy();
  });

  it('asks to save a number that was typed and not saved before verifying it', async () => {
    fetchCall.mockResolvedValue({ ...profile, phoneVerified: false });
    await show();
    await fireEvent.changeText(screen.getByLabelText('Phone'), '+919000000000');
    expect(await screen.findByText('Save your number first, then verify it.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Verify number' })).toBeNull();
  });

  it('sends a code, takes it, and shows the number as verified', async () => {
    fetchCall
      .mockResolvedValueOnce({ ...profile, phoneVerified: false })
      .mockResolvedValue({ ...profile, phoneVerified: true });
    startCall.mockResolvedValue(challenge);
    confirmCall.mockResolvedValue({ verified: true });
    await show();
    await press('Verify number');
    expect(await screen.findByText('We sent a code to ⁦+91 •••• ••78⁩')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Verification code'), '123456');
    await press('Verify and continue');
    await waitFor(() => expect(confirmCall).toHaveBeenCalledWith({ code: '123456' }));
    expect(await screen.findByText('Your number is verified.')).toBeTruthy();
    expect(await screen.findByText('Verified')).toBeTruthy();
  });

  it('says so when the code is wrong, and stays on the code step', async () => {
    fetchCall.mockResolvedValue({ ...profile, phoneVerified: false });
    startCall.mockResolvedValue(challenge);
    confirmCall.mockRejectedValue(new ApiError(400, 'AUTH_OTP_INVALID', 'x'));
    await show();
    await press('Verify number');
    await screen.findByText('We sent a code to ⁦+91 •••• ••78⁩');
    await fireEvent.changeText(screen.getByLabelText('Verification code'), '000000');
    await press('Verify and continue');
    expect(await screen.findByText('That code is not correct. Try again.')).toBeTruthy();
  });

  it('says plainly when a code cannot be sent, and stays on the profile', async () => {
    fetchCall.mockResolvedValue({ ...profile, phoneVerified: false });
    startCall.mockRejectedValue(new ApiError(503, 'AUTH_OTP_SEND_FAILED', 'x'));
    await show();
    await press('Verify number');
    expect(
      await screen.findByText('We could not send a code right now. Try again later.'),
    ).toBeTruthy();
    expect(screen.getByLabelText('Full name')).toBeTruthy();
  });

  it('asks for a new code for the same request, and goes back to the profile to fix the number', async () => {
    fetchCall.mockResolvedValue({ ...profile, phoneVerified: false });
    startCall.mockResolvedValue({ ...challenge, resendCooldownSeconds: 0 });
    resendCall.mockResolvedValue({ expiresInSeconds: 300, resendCooldownSeconds: 60 });
    await show();
    await press('Verify number');
    await screen.findByText('We sent a code to ⁦+91 •••• ••78⁩');
    await press('Resend code');
    expect(await screen.findByText('A new code is on its way to your WhatsApp.')).toBeTruthy();
    expect(resendCall).toHaveBeenCalledTimes(1);
    await press('Wrong number? Go back');
    expect(await screen.findByLabelText('Full name')).toBeTruthy();
  });
});
