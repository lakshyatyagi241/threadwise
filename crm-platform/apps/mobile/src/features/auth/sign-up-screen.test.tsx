import type { RegistrationConfigResponse } from '@crm/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useRouter } from 'expo-router';
import { I18nextProvider } from 'react-i18next';
import { ApiError } from '@/lib/api';
import { getSnapshot, resetSessionForTests } from '@/lib/auth/session-manager';
import { i18n, initI18n } from '@/lib/i18n';
import { TOKEN_PAIR } from '@/test/fetch-mock';
import * as api from './api';
import { SignUpScreen } from './sign-up-screen';

jest.mock('./api');
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));

const signUp = jest.mocked(api.signUp);
const verifySignUpOtp = jest.mocked(api.verifySignUpOtp);
const resendSignUpOtp = jest.mocked(api.resendSignUpOtp);

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
  links: { terms: '/legal/terms', privacy: '/legal/privacy', cookies: null },
};
const policy = { minLength: 12, requireMixedCase: true, requireNumber: true, requireSymbol: false };
const authenticated = {
  status: 'authenticated' as const,
  orgSlug: 'acme-ltd',
  tokens: TOKEN_PAIR(1),
  landing: 'onboarding' as const,
  flags: {
    suspended: false,
    emailUnverified: false,
    emailBlocked: false,
    mfaEnrolmentRequired: false,
    passwordChangeRequired: false,
  },
};
const codeRequired = (cooldown = 30) => ({
  status: 'otp_required' as const,
  challengeId: 'c-1',
  maskedPhone: '+91 •••• ••21',
  expiresInSeconds: 300,
  resendCooldownSeconds: cooldown,
  codeLength: 6,
});
const expectedBody = {
  orgName: 'Acme Ltd',
  fullName: 'Asha Rao',
  email: 'asha@acme.test',
  phone: '+919876543210',
  password: 'Correct-Horse-9',
  acceptTerms: true,
};

const router = {
  push: jest.fn(),
  back: jest.fn(),
  replace: jest.fn(),
  canGoBack: jest.fn(),
};

const renderScreen = async () =>
  await render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } })}
      >
        <SignUpScreen />
      </QueryClientProvider>
    </I18nextProvider>,
  );

const fill = async (label: string, value: string) =>
  await fireEvent.changeText(screen.getByLabelText(label), value);
const press = async (name: string) => await fireEvent.press(screen.getByRole('button', { name }));
const valueOf = (label: string): unknown => screen.getByLabelText(label).props.value;
const agree = async () =>
  await fireEvent.press(
    screen.getByRole('checkbox', { name: 'I agree to the Terms and Privacy policy.' }),
  );

async function fillForm(overrides: Partial<Record<string, string>> = {}) {
  await screen.findByText('Create your account');
  await fill('Full name', overrides.name ?? 'Asha Rao');
  await fill('Work email', overrides.email ?? 'asha@acme.test');
  await fill('Workspace name', overrides.org ?? 'Acme Ltd');
  await fill('Mobile number', overrides.phone ?? '98765 43210');
  await fill('Password', overrides.password ?? 'Correct-Horse-9');
  await fill('Confirm password', overrides.confirm ?? overrides.password ?? 'Correct-Horse-9');
  await agree();
}

beforeAll(async () => {
  await initI18n('en');
});
beforeEach(() => {
  jest.resetAllMocks();
  resetSessionForTests();
  router.canGoBack.mockReturnValue(true);
  jest.mocked(useRouter).mockReturnValue(router as unknown as ReturnType<typeof useRouter>);
  jest.mocked(api.fetchRegistrationConfig).mockResolvedValue(config);
  jest.mocked(api.fetchPasswordPolicy).mockResolvedValue(policy);
});

describe('SignUpScreen: before the form', () => {
  it('shows the form with the name of the app and the live password rules once the settings are known', async () => {
    await renderScreen();
    expect(await screen.findByText('Create your account')).toBeTruthy();
    expect(screen.getByText('GetaDesk')).toBeTruthy();
    expect(await screen.findByText('Minimum length: 12.')).toBeTruthy();
    expect(screen.getByText('Mix upper and lower case letters.')).toBeTruthy();
    expect(screen.getByText('Include a number.')).toBeTruthy();
    expect(screen.queryByText('Include a symbol.')).toBeNull();
  });

  it('offers to try again when the settings cannot be loaded', async () => {
    jest
      .mocked(api.fetchRegistrationConfig)
      .mockRejectedValue(new ApiError(0, 'CLIENT_NETWORK', 'offline'));
    await renderScreen();
    expect(await screen.findByText(/Can't reach the server/)).toBeTruthy();
    expect(screen.queryByLabelText('Full name')).toBeNull();

    jest.mocked(api.fetchRegistrationConfig).mockResolvedValue(config);
    await press('Try again');
    expect(await screen.findByLabelText('Full name')).toBeTruthy();
  });

  it('explains a closed registration instead of showing a form, and leads back to sign-in', async () => {
    jest
      .mocked(api.fetchRegistrationConfig)
      .mockResolvedValue({ ...config, registrationOpen: false });
    await renderScreen();
    expect(
      await screen.findByText('Registration is closed. Ask an administrator for an invitation.'),
    ).toBeTruthy();
    expect(screen.queryByLabelText('Full name')).toBeNull();
    await press('Back to sign in');
    expect(router.back).toHaveBeenCalled();
  });

  it('explains a CAPTCHA the app cannot pass instead of showing a form that cannot work', async () => {
    jest
      .mocked(api.fetchRegistrationConfig)
      .mockResolvedValue({ ...config, captcha: { version: 'v2', siteKey: 'site-key' } });
    await renderScreen();
    expect(await screen.findByText(/A security check is required/)).toBeTruthy();
    expect(screen.queryByLabelText('Full name')).toBeNull();
  });
});

describe('SignUpScreen: filling in the form', () => {
  it('hints at what to type in every empty field, the passwords included', async () => {
    await renderScreen();
    await screen.findByText('Create your account');
    for (const hint of [
      'Your name',
      'you@company.com',
      'Acme Inc.',
      '+91',
      "Got a friend's code?",
      'Create a password',
      'Re-enter your password',
    ]) {
      expect(screen.getByPlaceholderText(hint)).toBeTruthy();
    }
    await press('Choose a custom workspace address');
    expect(screen.getByPlaceholderText('your-workspace')).toBeTruthy();
  });

  it('checks the form before calling the API', async () => {
    await renderScreen();
    await screen.findByText('Create your account');
    await press('Create an account');
    expect(await screen.findByText('Enter your full name.')).toBeTruthy();
    expect(screen.getByText('Enter a valid email address.')).toBeTruthy();
    expect(screen.getByText('Name your workspace (at least 2 characters).')).toBeTruthy();
    expect(screen.getByText('Enter your mobile number.')).toBeTruthy();
    expect(screen.getByText('Enter your password.')).toBeTruthy();
    expect(screen.getByText('You must accept the terms to continue.')).toBeTruthy();
    expect(signUp).not.toHaveBeenCalled();
  });

  it('holds the password to the platform minimum, and asks for the two to match', async () => {
    await renderScreen();
    await fillForm({ password: 'Short-Pw-1', confirm: 'Different-Pw-1' });
    await press('Create an account');
    // The rule also sits in the checklist, so the same sentence shows twice: once as a rule, once as the problem.
    expect(await screen.findAllByText('Minimum length: 12.')).toHaveLength(2);
    expect(screen.getByText('The two passwords do not match.')).toBeTruthy();
    expect(signUp).not.toHaveBeenCalled();
  });

  it("clears a field's problem as soon as the person starts to fix it", async () => {
    await renderScreen();
    await screen.findByText('Create your account');
    await press('Create an account');
    expect(await screen.findByText('Enter your full name.')).toBeTruthy();
    await fill('Full name', 'A');
    expect(screen.queryByText('Enter your full name.')).toBeNull();
  });

  it('shows the address the workspace will get, from the name being typed', async () => {
    await renderScreen();
    await screen.findByText('This is the name your team sees.');
    await fill('Workspace name', 'Acme Inc.');
    expect(screen.getByText('Your team signs in with the address acme-inc.')).toBeTruthy();
  });

  it('upper-cases and limits the referral code, and writes a valid number the international way', async () => {
    await renderScreen();
    await screen.findByText('Create your account');
    await fill('Referral code (optional)', 'ab-12 cd');
    expect(valueOf('Referral code (optional)')).toBe('AB12CD');
    await fill('Mobile number', '9876543210');
    await fireEvent(screen.getByLabelText('Mobile number'), 'blur');
    expect(valueOf('Mobile number')).toBe('+91 98765 43210');
  });

  it('opens the workspace address field on request, and sends what was typed', async () => {
    signUp.mockResolvedValue(authenticated);
    await renderScreen();
    await fillForm();
    await press('Choose a custom workspace address');
    await fill('Workspace address', 'acme-team');
    await press('Create an account');
    await waitFor(() => expect(signUp).toHaveBeenCalled());
    expect(signUp).toHaveBeenCalledWith({ ...expectedBody, orgSlug: 'acme-team' });
  });
});

describe('SignUpScreen: creating the account', () => {
  it('sends the sign-up the contract describes and starts the session', async () => {
    signUp.mockResolvedValue(authenticated);
    await renderScreen();
    await fillForm();
    await press('Create an account');
    await waitFor(() => expect(getSnapshot().status).toBe('signedIn'));
    expect(signUp).toHaveBeenCalledWith(expectedBody);
  });

  it('sends the referral code when one was typed', async () => {
    signUp.mockResolvedValue(authenticated);
    await renderScreen();
    await fillForm();
    await fill('Referral code (optional)', 'friend7');
    await press('Create an account');
    await waitFor(() => expect(signUp).toHaveBeenCalled());
    expect(signUp).toHaveBeenCalledWith({ ...expectedBody, referralCode: 'FRIEND7' });
  });

  it('sends the form from the keyboard\'s "go" key on the last field, like Enter on the web', async () => {
    signUp.mockResolvedValue(authenticated);
    await renderScreen();
    await fillForm();
    await fireEvent(screen.getByLabelText('Confirm password'), 'submitEditing');
    await waitFor(() => expect(getSnapshot().status).toBe('signedIn'));
    expect(signUp).toHaveBeenCalledWith(expectedBody);
  });

  it('ignores a second tap while the first is still on its way', async () => {
    let finish: (value: typeof authenticated) => void = () => undefined;
    signUp.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await renderScreen();
    await fillForm();
    await press('Create an account');
    await press('Create an account');
    expect(signUp).toHaveBeenCalledTimes(1);
    finish(authenticated);
    await waitFor(() => expect(getSnapshot().status).toBe('signedIn'));
  });
});

describe('SignUpScreen: what the server can refuse', () => {
  it.each([
    [
      'an email already in use',
      new ApiError(409, 'AUTH_EMAIL_TAKEN', 'x'),
      'That email is already used in this workspace.',
    ],
    [
      'a registration that closed meanwhile',
      new ApiError(403, 'AUTH_SIGNUP_CLOSED', 'x'),
      'Registration is closed. Ask an administrator for an invitation.',
    ],
    ['a CAPTCHA', new ApiError(400, 'AUTH_CAPTCHA_FAILED', 'x'), /A security check is required/],
    ['no signal', new ApiError(0, 'CLIENT_NETWORK', 'x'), /Can't reach the server/],
    ['too many attempts', new ApiError(429, 'RATE_LIMITED', 'x'), /Too many attempts/],
  ])('shows the message for %s', async (_name, error, message) => {
    signUp.mockRejectedValue(error);
    await renderScreen();
    await fillForm();
    await press('Create an account');
    expect(await screen.findByText(message)).toBeTruthy();
    expect(getSnapshot().status).not.toBe('signedIn');
  });

  it('opens the address field when the address is taken, so another one can be typed', async () => {
    signUp.mockRejectedValue(new ApiError(409, 'AUTH_SLUG_TAKEN', 'x'));
    await renderScreen();
    await fillForm();
    expect(screen.queryByLabelText('Workspace address')).toBeNull();
    await press('Create an account');
    expect(await screen.findByText('That workspace address is already taken.')).toBeTruthy();
    expect(screen.getByLabelText('Workspace address')).toBeTruthy();

    // The next try sends the address that was typed, not a derived one.
    signUp.mockResolvedValue(authenticated);
    await fill('Workspace address', 'acme-two');
    await press('Create an account');
    await waitFor(() => expect(signUp).toHaveBeenCalledTimes(2));
    expect(signUp).toHaveBeenLastCalledWith({ ...expectedBody, orgSlug: 'acme-two' });
  });

  it('lists the broken password rules under the password', async () => {
    signUp.mockRejectedValue(
      new ApiError(422, 'AUTH_PASSWORD_POLICY', 'x', undefined, [
        { path: 'password.common', message: 'That password is too easy to guess.' },
      ]),
    );
    await renderScreen();
    await fillForm();
    await press('Create an account');
    expect(await screen.findByText(/does not meet the security policy/)).toBeTruthy();
    expect(screen.getByText(/That password is too easy to guess\./)).toBeTruthy();
  });
});

describe('SignUpScreen: the WhatsApp code', () => {
  const reachCodeStep = async (cooldown?: number) => {
    signUp.mockResolvedValue(codeRequired(cooldown));
    await renderScreen();
    await fillForm();
    await press('Create an account');
    await screen.findByText('Check your WhatsApp');
  };

  it('asks for the code after the form, naming the number the person typed', async () => {
    await reachCodeStep();
    expect(screen.getByText(/We sent a code to/)).toBeTruthy();
    expect(screen.getByText(/\+91 •••• ••10/)).toBeTruthy();
    // The clock may tick over to the next second while the screen renders: 5:00 or 4:59 are both right.
    expect(screen.getByText(/^The code expires in (5:00|4:59)\.$/)).toBeTruthy();
    expect(getSnapshot().status).not.toBe('signedIn');
  });

  it('checks the length of the code before asking the server', async () => {
    await reachCodeStep();
    await fill('Verification code', '123');
    await press('Verify and continue');
    expect(await screen.findByText('Enter the 6-digit code.')).toBeTruthy();
    expect(verifySignUpOtp).not.toHaveBeenCalled();
  });

  it('empties the box on a wrong code, then signs in with the right one', async () => {
    await reachCodeStep();
    verifySignUpOtp.mockRejectedValueOnce(new ApiError(400, 'AUTH_OTP_INVALID', 'x'));
    await fill('Verification code', '000000');
    await press('Verify and continue');
    expect(await screen.findByText('That code is not correct. Try again.')).toBeTruthy();
    expect(valueOf('Verification code')).toBe('');

    verifySignUpOtp.mockResolvedValueOnce(authenticated);
    await fill('Verification code', '123456');
    await press('Verify and continue');
    await waitFor(() => expect(getSnapshot().status).toBe('signedIn'));
    expect(verifySignUpOtp).toHaveBeenLastCalledWith({ challengeId: 'c-1', code: '123456' });
  });

  it('keeps only digits in the code box', async () => {
    await reachCodeStep();
    await fill('Verification code', '12 3a4-56789');
    expect(valueOf('Verification code')).toBe('123456');
  });

  it('keeps "resend" locked during the wait and says how long is left', async () => {
    await reachCodeStep(30);
    const resend = screen.getByRole('button', { name: /^Resend code in 0:(30|29)$/ });
    expect(resend.props.accessibilityState.disabled).toBe(true);
  });

  it('sends a new code when the wait is over', async () => {
    await reachCodeStep(0);
    resendSignUpOtp.mockResolvedValue({ expiresInSeconds: 300, resendCooldownSeconds: 0 });
    await press('Resend code');
    expect(await screen.findByText('A new code is on its way to your WhatsApp.')).toBeTruthy();
    expect(resendSignUpOtp).toHaveBeenCalledWith({ challengeId: 'c-1' });
  });

  it('goes back to the form with everything still typed', async () => {
    await reachCodeStep();
    await press('Wrong number? Go back');
    expect(await screen.findByLabelText('Full name')).toBeTruthy();
    expect(valueOf('Full name')).toBe('Asha Rao');
    expect(valueOf('Work email')).toBe('asha@acme.test');
    expect(valueOf('Mobile number')).toBe('98765 43210');
  });

  it('returns to the form with a message when the pending sign-up has expired', async () => {
    await reachCodeStep();
    verifySignUpOtp.mockRejectedValue(new ApiError(410, 'AUTH_SIGNUP_EXPIRED', 'x'));
    await fill('Verification code', '123456');
    await press('Verify and continue');
    expect(await screen.findByText('Please start registration again.')).toBeTruthy();
    expect(screen.getByLabelText('Full name')).toBeTruthy();
  });

  it('returns to the form and opens the address when it was taken while the code was on its way', async () => {
    await reachCodeStep();
    verifySignUpOtp.mockRejectedValue(new ApiError(409, 'AUTH_SLUG_TAKEN', 'x'));
    await fill('Verification code', '123456');
    await press('Verify and continue');
    expect(await screen.findByText('That workspace address is already taken.')).toBeTruthy();
    expect(screen.getByLabelText('Workspace address')).toBeTruthy();
  });
});

describe('SignUpScreen: leaving', () => {
  it('goes back to sign-in from the link at the bottom', async () => {
    await renderScreen();
    await screen.findByText('Create your account');
    await press('Sign in');
    expect(router.back).toHaveBeenCalled();
  });

  it('goes to sign-in when there is nothing to go back to (the screen was opened directly)', async () => {
    router.canGoBack.mockReturnValue(false);
    await renderScreen();
    await screen.findByText('Create your account');
    await press('Sign in');
    expect(router.replace).toHaveBeenCalledWith('/sign-in');
  });
});
