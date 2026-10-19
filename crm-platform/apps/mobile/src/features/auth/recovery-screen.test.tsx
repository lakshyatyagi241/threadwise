import type { RegistrationConfigResponse } from '@crm/contracts';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ApiError } from '@/lib/api';
import { renderApp } from '@/test/render';
import * as api from './api';
import { FindWorkspaceScreen, ForgotPasswordScreen } from './recovery-screen';

jest.mock('./api');
jest.mock('expo-router', () => ({ useRouter: jest.fn(), useLocalSearchParams: jest.fn() }));

const resetCall = jest.mocked(api.requestPasswordReset);
const findCall = jest.mocked(api.requestWorkspaceList);
const router = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn() };

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

const fill = async (label: string, value: string) =>
  await fireEvent.changeText(await screen.findByLabelText(label), value);
const press = async (name: string) =>
  await fireEvent.press(await screen.findByRole('button', { name }));

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(useRouter).mockReturnValue(router as unknown as ReturnType<typeof useRouter>);
  jest.mocked(useLocalSearchParams).mockReturnValue({});
  router.canGoBack.mockReturnValue(true);
  jest.mocked(api.fetchRegistrationConfig).mockResolvedValue(config);
});

describe('ForgotPasswordScreen', () => {
  it('asks for the workspace and the email, and says what it will do', async () => {
    await renderApp(<ForgotPasswordScreen />);
    expect(await screen.findByLabelText('Workspace')).toBeTruthy();
    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(screen.getByText(/We'll email you a link to choose a new password/)).toBeTruthy();
  });

  it('checks both fields before calling the API', async () => {
    await renderApp(<ForgotPasswordScreen />);
    await fill('Workspace', '!');
    await fill('Email', 'not-an-email');
    await press('Email reset link');
    expect((await screen.findAllByText(/Enter your workspace address/)).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Enter a valid email address.').length).toBeGreaterThan(0);
    expect(resetCall).not.toHaveBeenCalled();
  });

  it('sends the trimmed workspace and email, then tells the person to check the inbox', async () => {
    resetCall.mockResolvedValue({ ok: true });
    await renderApp(<ForgotPasswordScreen />);
    await fill('Workspace', ' acme ');
    await fill('Email', ' person@example.com ');
    await press('Email reset link');
    await waitFor(() =>
      expect(resetCall).toHaveBeenCalledWith({ orgSlug: 'acme', email: 'person@example.com' }),
    );
    expect(await screen.findByText('Check your inbox')).toBeTruthy();
    expect(screen.getByText(/a reset link is on its way/)).toBeTruthy();
    // The link in the mail opens the web's reset page: the phone user is told so.
    expect(screen.getByText(/Open the link on this phone/)).toBeTruthy();
  });

  it('goes back to the form to use a different email', async () => {
    resetCall.mockResolvedValue({ ok: true });
    await renderApp(<ForgotPasswordScreen />);
    await fill('Workspace', 'acme');
    await fill('Email', 'person@example.com');
    await press('Email reset link');
    await press('Use a different email');
    expect(await screen.findByLabelText('Email')).toBeTruthy();
  });

  it('starts with the email already typed on the sign-in screen', async () => {
    jest.mocked(useLocalSearchParams).mockReturnValue({ email: 'typed@example.com' });
    await renderApp(<ForgotPasswordScreen />);
    expect((await screen.findByLabelText('Email')).props.value).toBe('typed@example.com');
  });

  it('offers to find the workspace address, and goes back to sign in', async () => {
    await renderApp(<ForgotPasswordScreen />);
    await press('Find my workspace');
    expect(router.push).toHaveBeenCalledWith('/find-workspace');
    await press('Back to sign in');
    expect(router.back).toHaveBeenCalled();
  });

  it('goes to the sign-in screen when there is nothing to go back to', async () => {
    router.canGoBack.mockReturnValue(false);
    await renderApp(<ForgotPasswordScreen />);
    await press('Back to sign in');
    expect(router.replace).toHaveBeenCalledWith('/sign-in');
  });

  it('says plainly when the platform asks for a CAPTCHA the app cannot pass, with no form', async () => {
    jest
      .mocked(api.fetchRegistrationConfig)
      .mockResolvedValue({ ...config, captcha: { version: 'v2', siteKey: 'site-key' } });
    await renderApp(<ForgotPasswordScreen />);
    expect(await screen.findByText(/security check is required/)).toBeTruthy();
    expect(screen.queryByLabelText('Email')).toBeNull();
  });

  it('shows the CAPTCHA sentence when the server refuses the request for it', async () => {
    resetCall.mockRejectedValue(new ApiError(400, 'AUTH_CAPTCHA_FAILED', 'x'));
    await renderApp(<ForgotPasswordScreen />);
    await fill('Workspace', 'acme');
    await fill('Email', 'person@example.com');
    await press('Email reset link');
    expect(await screen.findByText(/security check is required/)).toBeTruthy();
    expect(screen.getByLabelText('Email')).toBeTruthy();
  });

  it('shows the too-many-attempts and the offline sentences, chosen by error code', async () => {
    resetCall.mockRejectedValueOnce(new ApiError(429, 'RATE_LIMITED', 'x'));
    await renderApp(<ForgotPasswordScreen />);
    await fill('Workspace', 'acme');
    await fill('Email', 'person@example.com');
    await press('Email reset link');
    expect(await screen.findByText(/Too many attempts/)).toBeTruthy();
    resetCall.mockRejectedValueOnce(new ApiError(0, 'CLIENT_NETWORK', 'x'));
    await press('Email reset link');
    expect(await screen.findByText(/Can't reach the server/)).toBeTruthy();
  });

  it('says so, with a retry, when the platform settings cannot be loaded', async () => {
    jest
      .mocked(api.fetchRegistrationConfig)
      .mockRejectedValue(new ApiError(0, 'CLIENT_NETWORK', 'x'));
    await renderApp(<ForgotPasswordScreen />);
    expect(await screen.findByText(/Can't reach the server/)).toBeTruthy();
    jest.mocked(api.fetchRegistrationConfig).mockResolvedValue(config);
    await press('Try again');
    expect(await screen.findByLabelText('Email')).toBeTruthy();
  });
});

describe('FindWorkspaceScreen', () => {
  it('asks only for the email', async () => {
    await renderApp(<FindWorkspaceScreen />);
    expect(await screen.findByLabelText('Email')).toBeTruthy();
    expect(screen.queryByLabelText('Workspace')).toBeNull();
  });

  it('checks the email, sends it, and tells the person to check the inbox', async () => {
    findCall.mockResolvedValue({ ok: true });
    await renderApp(<FindWorkspaceScreen />);
    await fill('Email', 'nope');
    await press('Email me my workspaces');
    expect(await screen.findByText('Enter a valid email address.')).toBeTruthy();
    expect(findCall).not.toHaveBeenCalled();
    await fill('Email', ' person@example.com ');
    await press('Email me my workspaces');
    await waitFor(() => expect(findCall).toHaveBeenCalledWith({ email: 'person@example.com' }));
    expect(await screen.findByText('Check your inbox')).toBeTruthy();
    expect(screen.queryByText(/Open the link on this phone/)).toBeNull();
  });
});
