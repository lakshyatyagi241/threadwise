import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';
import { ApiError } from '@/lib/api';
import { i18n, initI18n } from '@/lib/i18n';
import { getSnapshot, resetSessionForTests } from '@/lib/auth/session-manager';
import { TOKEN_PAIR } from '@/test/fetch-mock';
import * as api from './api';
import { SignInScreen } from './sign-in-screen';

jest.mock('./api');
const signInWithPassword = jest.mocked(api.signInWithPassword);
const signInWithMfa = jest.mocked(api.signInWithMfa);
const signInToWorkspace = jest.mocked(api.signInToWorkspace);

const authenticated = {
  status: 'authenticated' as const,
  orgSlug: 'acme',
  tokens: TOKEN_PAIR(1),
  landing: 'dashboard' as const,
  flags: {
    suspended: false,
    emailUnverified: false,
    emailBlocked: false,
    mfaEnrolmentRequired: false,
    passwordChangeRequired: false,
  },
};

const renderScreen = () =>
  render(
    <I18nextProvider i18n={i18n}>
      <SignInScreen />
    </I18nextProvider>,
  );

const fill = (label: string, value: string) =>
  fireEvent.changeText(screen.getByLabelText(label), value);
const press = (label: string) => fireEvent.press(screen.getByRole('button', { name: label }));

beforeAll(async () => {
  await initI18n('en');
});
beforeEach(() => {
  jest.resetAllMocks();
  resetSessionForTests();
});

describe('SignInScreen', () => {
  it('validates the fields before calling the API', async () => {
    renderScreen();
    fill('Email', 'not-an-email');
    press('Sign in');
    expect(await screen.findByText('Enter a valid email address.')).toBeTruthy();
    expect(screen.getByText('Enter your password.')).toBeTruthy();
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it('signs in with the typed credentials and keeps the session', async () => {
    signInWithPassword.mockResolvedValue(authenticated);
    renderScreen();
    fill('Email', ' person@example.com ');
    fill('Password', 'correct horse');
    press('Sign in');
    await waitFor(() => expect(getSnapshot().status).toBe('signedIn'));
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: 'person@example.com',
      password: 'correct horse',
      remember: true,
    });
  });

  it('shows the message for a wrong password, chosen by error code', async () => {
    signInWithPassword.mockRejectedValue(
      new ApiError(401, 'AUTH_INVALID_CREDENTIALS', 'whatever the server said'),
    );
    renderScreen();
    fill('Email', 'person@example.com');
    fill('Password', 'nope');
    press('Sign in');
    expect(await screen.findByText('The email or password is incorrect.')).toBeTruthy();
    expect(getSnapshot().status).not.toBe('signedIn');
  });

  it('shows the offline message when the server cannot be reached', async () => {
    signInWithPassword.mockRejectedValue(new ApiError(0, 'CLIENT_NETWORK', 'x'));
    renderScreen();
    fill('Email', 'person@example.com');
    fill('Password', 'x');
    press('Sign in');
    expect(await screen.findByText(/Can't reach the server/)).toBeTruthy();
  });

  it('asks for the authenticator code, then signs in', async () => {
    signInWithPassword.mockResolvedValue({
      status: 'mfa_required',
      challengeToken: 'challenge-1',
      expiresInSeconds: 300,
    });
    signInWithMfa.mockResolvedValue(authenticated);
    renderScreen();
    fill('Email', 'person@example.com');
    fill('Password', 'correct horse');
    press('Sign in');
    expect(await screen.findByText('Two-step verification')).toBeTruthy();
    fill('Verification code', '123456');
    press('Verify');
    await waitFor(() => expect(getSnapshot().status).toBe('signedIn'));
    expect(signInWithMfa).toHaveBeenCalledWith({ challengeToken: 'challenge-1', code: '123456' });
  });

  it('goes back to the password step when the code challenge has expired', async () => {
    signInWithPassword.mockResolvedValue({
      status: 'mfa_required',
      challengeToken: 'challenge-1',
      expiresInSeconds: 300,
    });
    signInWithMfa.mockRejectedValue(new ApiError(401, 'AUTH_MFA_CHALLENGE_EXPIRED', 'x'));
    renderScreen();
    fill('Email', 'person@example.com');
    fill('Password', 'correct horse');
    press('Sign in');
    await screen.findByText('Two-step verification');
    fill('Verification code', '123456');
    press('Verify');
    expect(await screen.findByText('The sign-in expired. Please start again.')).toBeTruthy();
    expect(screen.getByLabelText('Password')).toBeTruthy();
  });

  it('lets the person pick a workspace when the same login opens several', async () => {
    signInWithPassword.mockResolvedValue({
      status: 'workspace_required',
      selectionToken: 'select-1',
      expiresInSeconds: 300,
      workspaces: [
        { slug: 'acme', name: 'Acme Ltd', role: 'Admin', memberCount: 4 },
        { slug: 'globex', name: 'Globex', role: null, memberCount: 9 },
      ],
    });
    signInToWorkspace.mockResolvedValue(authenticated);
    renderScreen();
    fill('Email', 'person@example.com');
    fill('Password', 'correct horse');
    press('Sign in');
    expect(await screen.findByText('Choose a workspace')).toBeTruthy();
    press('Globex');
    await waitFor(() => expect(getSnapshot().status).toBe('signedIn'));
    expect(signInToWorkspace).toHaveBeenCalledWith({
      selectionToken: 'select-1',
      orgSlug: 'globex',
    });
  });
});
