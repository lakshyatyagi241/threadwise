import { ERROR_CODES } from '@crm/contracts';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { ApiError } from '@/lib/api';
import { signOut } from '@/lib/auth/sign-out';
import { initI18n } from '@/lib/i18n';
import { renderApp } from '@/test/render';
import { deleteAccount } from './delete-account-api';
import { DeleteAccountScreen } from './delete-account-screen';

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, canGoBack: () => true, replace: jest.fn() }),
}));
jest.mock('./delete-account-api');
jest.mock('@/lib/auth/sign-out', () => ({ signOut: jest.fn() }));

const deleteCall = jest.mocked(deleteAccount);
const PHRASE = 'DELETE my account';

async function show() {
  await renderApp(<DeleteAccountScreen />);
  await screen.findByLabelText(`Type ${PHRASE} to confirm`);
}
const fill = async (phrase: string, password: string) => {
  await fireEvent.changeText(screen.getByLabelText(`Type ${PHRASE} to confirm`), phrase);
  await fireEvent.changeText(screen.getByLabelText('Current password'), password);
};
const submit = async () =>
  await fireEvent.press(screen.getByRole('button', { name: 'Permanently delete account' }));

beforeAll(async () => {
  await initI18n('en');
});
beforeEach(() => {
  jest.resetAllMocks();
  deleteCall.mockResolvedValue({ ok: true });
});

describe('DeleteAccountScreen', () => {
  it('says what deleting does, and keeps the button off until the phrase and the password are in', async () => {
    await show();
    expect(screen.getByText('This cannot be undone.')).toBeTruthy();
    const button = () => screen.getByRole('button', { name: 'Permanently delete account' });
    expect(button().props.accessibilityState.disabled).toBe(true);
    await fill('delete my account', 'secret');
    expect(button().props.accessibilityState.disabled).toBe(true);
    await fill(PHRASE, 'secret');
    expect(button().props.accessibilityState.disabled).toBe(false);
  });

  it('sends the phrase and the password, then signs the phone out', async () => {
    await show();
    await fill(`  ${PHRASE} `, 'secret');
    await submit();
    await waitFor(() =>
      expect(deleteCall).toHaveBeenCalledWith({ confirmation: PHRASE, password: 'secret' }),
    );
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
  });

  it('says the password is wrong, and does not sign out', async () => {
    deleteCall.mockRejectedValue(
      new ApiError(403, ERROR_CODES.AUTH_CURRENT_PASSWORD_WRONG, 'wrong'),
    );
    await show();
    await fill(PHRASE, 'nope');
    await submit();
    expect(await screen.findByText('That password is not correct.')).toBeTruthy();
    expect(signOut).not.toHaveBeenCalled();
  });

  it.each([
    ['sole_member', 'You are the only member of this workspace.'],
    ['sole_admin', 'You are the only administrator.'],
  ])('explains why the only %s cannot delete the account', async (reason, title) => {
    deleteCall.mockRejectedValue(
      new ApiError(409, ERROR_CODES.AUTH_DELETE_BLOCKED, 'blocked', undefined, [
        { path: 'reason', message: reason },
      ]),
    );
    await show();
    await fill(PHRASE, 'secret');
    await submit();
    expect(await screen.findByText(new RegExp(title))).toBeTruthy();
    expect(signOut).not.toHaveBeenCalled();
  });

  it('says what went wrong for any other failure', async () => {
    deleteCall.mockRejectedValue(new ApiError(0, 'CLIENT_NETWORK', 'offline'));
    await show();
    await fill(PHRASE, 'secret');
    await submit();
    expect(await screen.findByText(/Can't reach the server/)).toBeTruthy();
  });

  it('goes back with Cancel without deleting anything', async () => {
    await show();
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    expect(mockBack).toHaveBeenCalled();
    expect(deleteCall).not.toHaveBeenCalled();
  });
});
