import type { RegistrationConfigResponse } from '@crm/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useRouter } from 'expo-router';
import { I18nextProvider } from 'react-i18next';
import { ApiError } from '@/lib/api';
import { i18n, initI18n } from '@/lib/i18n';
import { getSnapshot, resetSessionForTests } from '@/lib/auth/session-manager';
import { TOKEN_PAIR } from '@/test/fetch-mock';
import * as api from './api';
import { SignInScreen } from './sign-in-screen';

jest.mock('./api');
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));
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

const config: RegistrationConfigResponse = {
  appName: 'CRM Platform',
  registrationOpen: true,
  emailVerification: 'off',
  trialDays: 14,
  rememberMeEnabled: true,
  businessEmailOnly: true,
  phoneRequired: true,
  otp: { enabled: false },
  captcha: null,
  social: { google: false, facebook: false },
  defaultCountryIso: null,
  authPages: {
    variant: 1,
    login: {},
    register: {},
    forgot: {},
    defaulted: { login: [], register: [], forgot: [] },
    extra: { login: {}, register: {}, forgot: {} },
  },
  links: { terms: 'https://example.com/terms', privacy: '/legal/privacy', cookies: null },
};

const router = { push: jest.fn() };

const renderScreen = async () =>
  await render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } })}
      >
        <SignInScreen />
      </QueryClientProvider>
    </I18nextProvider>,
  );

const fill = async (label: string, value: string) =>
  await fireEvent.changeText(screen.getByLabelText(label), value);
const press = async (label: string) =>
  await fireEvent.press(screen.getByRole('button', { name: label }));

beforeAll(async () => {
  await initI18n('en');
});
beforeEach(() => {
  jest.resetAllMocks();
  resetSessionForTests();
  jest.mocked(useRouter).mockReturnValue(router as unknown as ReturnType<typeof useRouter>);
  jest.mocked(api.fetchRegistrationConfig).mockResolvedValue(config);
});

describe('SignInScreen', () => {
  it(
    'hints at what to type in both fields',
    async () => {
      await renderScreen();
      expect(screen.getByPlaceholderText('you@company.com')).toBeTruthy();
      expect(screen.getByPlaceholderText('Enter your password')).toBeTruthy();
      // Let the platform settings arrive, so the screen is not still updating when the test ends.
      expect(await screen.findByText('Create an account')).toBeTruthy();
    },
    // First test in the file: pays the suite's one-time render setup cost, which can push it past
    // the 20s floor under a loaded coverage run even though nothing here is slow on its own.
    40000,
  );

  it('validates the fields before calling the API', async () => {
    await renderScreen();
    await fill('Email', 'not-an-email');
    await press('Sign in');
    expect(await screen.findByText('Enter a valid email address.')).toBeTruthy();
    expect(screen.getByText('Enter your password.')).toBeTruthy();
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it('signs in with the typed credentials and keeps the session', async () => {
    signInWithPassword.mockResolvedValue(authenticated);
    await renderScreen();
    await fill('Email', ' person@example.com ');
    await fill('Password', 'correct horse');
    await press('Sign in');
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
    await renderScreen();
    await fill('Email', 'person@example.com');
    await fill('Password', 'nope');
    await press('Sign in');
    expect(await screen.findByText('The email or password is incorrect.')).toBeTruthy();
    expect(getSnapshot().status).not.toBe('signedIn');
  });

  it('shows the offline message when the server cannot be reached', async () => {
    signInWithPassword.mockRejectedValue(new ApiError(0, 'CLIENT_NETWORK', 'x'));
    await renderScreen();
    await fill('Email', 'person@example.com');
    await fill('Password', 'x');
    await press('Sign in');
    expect(await screen.findByText(/Can't reach the server/)).toBeTruthy();
  });

  it('says plainly when the workspace asks for a CAPTCHA the app cannot pass', async () => {
    signInWithPassword.mockRejectedValue(new ApiError(400, 'AUTH_CAPTCHA_FAILED', 'x'));
    await renderScreen();
    await fill('Email', 'person@example.com');
    await fill('Password', 'x');
    await press('Sign in');
    expect(await screen.findByText(/A security check is required/)).toBeTruthy();
  });

  it('asks for the authenticator code, then signs in', async () => {
    signInWithPassword.mockResolvedValue({
      status: 'mfa_required',
      challengeToken: 'challenge-1',
      expiresInSeconds: 300,
    });
    signInWithMfa.mockResolvedValue(authenticated);
    await renderScreen();
    await fill('Email', 'person@example.com');
    await fill('Password', 'correct horse');
    await press('Sign in');
    expect(await screen.findByText('Two-step verification')).toBeTruthy();
    await fill('Verification code', '123456');
    await press('Verify');
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
    await renderScreen();
    await fill('Email', 'person@example.com');
    await fill('Password', 'correct horse');
    await press('Sign in');
    await screen.findByText('Two-step verification');
    await fill('Verification code', '123456');
    await press('Verify');
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
    await renderScreen();
    await fill('Email', 'person@example.com');
    await fill('Password', 'correct horse');
    await press('Sign in');
    expect(await screen.findByText('Choose a workspace')).toBeTruthy();
    expect(screen.getByText('Admin')).toBeTruthy();
    await press('Globex');
    await waitFor(() => expect(getSnapshot().status).toBe('signedIn'));
    expect(signInToWorkspace).toHaveBeenCalledWith({
      selectionToken: 'select-1',
      orgSlug: 'globex',
    });
  });
});

describe('SignInScreen: what comes from the platform settings', () => {
  it('shows the name of the app, the sign-up link and the terms line while registration is open', async () => {
    await renderScreen();
    expect(await screen.findByText('GetaDesk')).toBeTruthy();
    expect(screen.getByText('New here?')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Terms' })).toBeTruthy();
    // The privacy address is a path and no web address is configured, so it stays plain text.
    expect(screen.queryByRole('link', { name: 'Privacy policy' })).toBeNull();
  });

  it('opens the sign-up screen from "Create an account"', async () => {
    await renderScreen();
    await fireEvent.press(await screen.findByRole('button', { name: 'Create an account' }));
    expect(router.push).toHaveBeenCalledWith('/sign-up');
  });

  it('offers no sign-up link while registration is closed', async () => {
    jest
      .mocked(api.fetchRegistrationConfig)
      .mockResolvedValue({ ...config, registrationOpen: false });
    await renderScreen();
    expect(await screen.findByText('GetaDesk')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Create an account' })).toBeNull();
    expect(screen.queryByText('New here?')).toBeNull();
  });

  it('still lets the person sign in when the settings cannot be loaded, and guesses nothing', async () => {
    jest
      .mocked(api.fetchRegistrationConfig)
      .mockRejectedValue(new ApiError(0, 'CLIENT_NETWORK', 'offline'));
    signInWithPassword.mockResolvedValue(authenticated);
    await renderScreen();
    await fill('Email', 'person@example.com');
    await fill('Password', 'correct horse');
    await press('Sign in');
    await waitFor(() => expect(getSnapshot().status).toBe('signedIn'));
    expect(screen.queryByText('New here?')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Terms' })).toBeNull();
  });
});
