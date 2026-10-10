import { ApiError } from '@/lib/api';
import { jsonResponse, mockFetch, TOKEN_PAIR } from '@/test/fetch-mock';
import {
  fetchPasswordPolicy,
  fetchRegistrationConfig,
  resendSignUpOtp,
  signUp,
  verifySignUpOtp,
} from './api';

const authenticated = {
  status: 'authenticated',
  orgSlug: 'acme',
  tokens: TOKEN_PAIR(1),
  landing: 'onboarding',
  flags: {
    suspended: false,
    emailUnverified: false,
    emailBlocked: false,
    mfaEnrolmentRequired: false,
    passwordChangeRequired: false,
  },
};
const config = {
  appName: 'CRM Platform',
  registrationOpen: true,
  emailVerification: 'off',
  trialDays: 14,
  rememberMeEnabled: true,
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
const body = {
  orgName: 'Acme Ltd',
  fullName: 'Asha Rao',
  email: 'asha@acme.test',
  password: 'Correct-Horse-9',
  acceptTerms: true as const,
};

describe('the public doors of sign-up', () => {
  it('reads the platform settings with no bearer token and parses them with the contract', async () => {
    const f = mockFetch(jsonResponse(200, config));
    const result = await fetchRegistrationConfig();
    expect(f.calls[0]?.url).toBe('http://api.test/v2/auth/registration-config');
    expect(f.calls[0]?.init.method).toBe('GET');
    expect(f.calls[0]?.headers.Authorization).toBeUndefined();
    expect(result.appName).toBe('CRM Platform');
    expect(result.links.terms).toBe('/legal/terms');
  });

  it('reads the password rules', async () => {
    const f = mockFetch(
      jsonResponse(200, {
        minLength: 12,
        requireMixedCase: true,
        requireNumber: true,
        requireSymbol: false,
      }),
    );
    expect(await fetchPasswordPolicy()).toEqual({
      minLength: 12,
      requireMixedCase: true,
      requireNumber: true,
      requireSymbol: false,
    });
    expect(f.calls[0]?.url).toBe('http://api.test/v2/auth/password-policy');
  });

  it('refuses an answer in a shape this build does not understand', async () => {
    mockFetch(jsonResponse(200, { appName: 42 }));
    await expect(fetchRegistrationConfig()).rejects.toMatchObject({
      code: 'CLIENT_CONTRACT_MISMATCH',
    });
  });

  it('sends the sign-up as JSON with no bearer token, and gets a session back', async () => {
    const f = mockFetch(jsonResponse(200, authenticated));
    const answer = await signUp(body);
    expect(f.calls[0]?.url).toBe('http://api.test/v2/auth/signup');
    expect(f.calls[0]?.init.method).toBe('POST');
    expect(f.calls[0]?.body).toEqual(body);
    expect(f.calls[0]?.headers.Authorization).toBeUndefined();
    expect(answer.status).toBe('authenticated');
  });

  it('understands the answer that asks for a WhatsApp code', async () => {
    mockFetch(
      jsonResponse(200, {
        status: 'otp_required',
        challengeId: 'c-1',
        maskedPhone: '+91 •••• ••21',
        expiresInSeconds: 300,
        resendCooldownSeconds: 30,
        codeLength: 6,
      }),
    );
    const answer = await signUp(body);
    expect(answer).toMatchObject({ status: 'otp_required', challengeId: 'c-1', codeLength: 6 });
  });

  it('confirms the code and gets the session', async () => {
    const f = mockFetch(jsonResponse(200, authenticated));
    const answer = await verifySignUpOtp({ challengeId: 'c-1', code: '123456' });
    expect(f.calls[0]?.url).toBe('http://api.test/v2/auth/signup/verify-otp');
    expect(f.calls[0]?.body).toEqual({ challengeId: 'c-1', code: '123456' });
    expect(answer.tokens.accessToken).toBe('access-1');
  });

  it('asks for a new code', async () => {
    const f = mockFetch(jsonResponse(200, { expiresInSeconds: 300, resendCooldownSeconds: 30 }));
    expect(await resendSignUpOtp({ challengeId: 'c-1' })).toEqual({
      expiresInSeconds: 300,
      resendCooldownSeconds: 30,
    });
    expect(f.calls[0]?.url).toBe('http://api.test/v2/auth/signup/resend-otp');
  });

  it('turns a refusal into an error carrying the stable code and the fields the server named', async () => {
    mockFetch(
      jsonResponse(409, {
        type: 'x',
        title: 'x',
        status: 409,
        code: 'AUTH_EMAIL_TAKEN',
        errors: [{ path: 'email', message: 'Already used.' }],
      }),
    );
    const error: unknown = await signUp(body).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 409,
      code: 'AUTH_EMAIL_TAKEN',
      fieldErrors: [{ path: 'email', message: 'Already used.' }],
    });
  });

  it('reports a phone with no signal as a connectivity problem, not as a refusal', async () => {
    mockFetch(new TypeError('Network request failed'));
    await expect(signUp(body)).rejects.toMatchObject({ code: 'CLIENT_NETWORK', status: 0 });
  });
});
