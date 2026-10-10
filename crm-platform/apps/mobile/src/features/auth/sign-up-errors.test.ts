import { ApiError } from '@/lib/api';
import { i18n, initI18n } from '@/lib/i18n';
import { mapSignUpError } from './sign-up-errors';

let t: ReturnType<typeof i18n.getFixedT>;
beforeAll(async () => {
  await initI18n('en');
  t = i18n.getFixedT('en');
});

const refusal = (status: number, code: string, details: Array<[string, string]> = []) =>
  new ApiError(
    status,
    code,
    'English text that must never be shown',
    'req-1',
    details.map(([path, message]) => ({ path, message })),
  );

describe('mapSignUpError', () => {
  it('says registration is closed', () => {
    expect(mapSignUpError(refusal(403, 'AUTH_SIGNUP_CLOSED'), t).banner).toBe(
      'Registration is closed. Ask an administrator for an invitation.',
    );
  });

  it('says a CAPTCHA is needed that the app cannot pass', () => {
    expect(mapSignUpError(refusal(400, 'AUTH_CAPTCHA_FAILED'), t).banner).toMatch(
      /security check is required/,
    );
  });

  it('puts "email taken" on the email field', () => {
    const failure = mapSignUpError(refusal(409, 'AUTH_EMAIL_TAKEN'), t);
    expect(failure.fields).toEqual({ email: 'That email is already used in this workspace.' });
    expect(failure.banner).toBeNull();
  });

  it('puts "address taken" on the workspace address and asks the form to open that field', () => {
    const failure = mapSignUpError(refusal(409, 'AUTH_SLUG_TAKEN'), t);
    expect(failure.fields).toEqual({ orgSlug: 'That workspace address is already taken.' });
    expect(failure.openSlug).toBe(true);
  });

  it("lists each broken password rule in the person's language, one per line", () => {
    const failure = mapSignUpError(
      refusal(422, 'AUTH_PASSWORD_POLICY', [
        ['password.min_length', 'Use at least 14 characters.'],
        ['password.upper_lower', 'Mix upper and lower case letters.'],
        ['password.number', 'Include at least one number.'],
        ['password.symbol', 'Include at least one symbol.'],
        ['password.common', 'That password is too easy to guess.'],
        ['password.something_new', 'A rule this app has never heard of.'],
      ]),
      t,
    );
    expect(failure.fields.password?.split('\n')).toEqual([
      'That password does not meet the security policy:',
      '• Minimum length: 14.',
      '• Mix upper and lower case letters.',
      '• Include a number.',
      '• Include a symbol.',
      '• That password is too easy to guess.',
    ]);
  });

  it('still says the password was refused when the server names no rule', () => {
    expect(mapSignUpError(refusal(422, 'AUTH_PASSWORD_POLICY'), t).fields.password).toBe(
      'That password does not meet the security policy:',
    );
  });

  it('puts "could not send the code" on the phone number', () => {
    expect(mapSignUpError(refusal(502, 'AUTH_OTP_SEND_FAILED'), t).fields.phone).toMatch(
      /could not send the verification code/,
    );
  });

  it("maps the fields a validation failure names to the form's own wording", () => {
    const failure = mapSignUpError(
      refusal(422, 'VALIDATION_FAILED', [
        ['email', 'Invalid email'],
        ['fullName', 'Required'],
        ['somethingElse', 'ignored'],
      ]),
      t,
    );
    expect(failure.fields).toEqual({
      email: 'Enter a valid email address.',
      fullName: 'Enter your full name.',
    });
  });

  it('falls back to a general message when a validation failure names no field of the form', () => {
    const failure = mapSignUpError(refusal(422, 'VALIDATION_FAILED', [['x', 'y']]), t);
    expect(failure.fields).toEqual({});
    expect(failure.banner).toBe('Something went wrong. Please try again.');
  });

  it('uses the shared messages for offline, throttled and unknown failures', () => {
    expect(mapSignUpError(new ApiError(0, 'CLIENT_NETWORK', 'x'), t).banner).toMatch(
      /Can't reach the server/,
    );
    expect(mapSignUpError(refusal(429, 'RATE_LIMITED'), t).banner).toMatch(/Too many attempts/);
    expect(mapSignUpError(refusal(500, 'INTERNAL'), t).banner).toBe(
      'Something went wrong. Please try again.',
    );
    expect(mapSignUpError(new Error('boom'), t).banner).toBe(
      'Something went wrong. Please try again.',
    );
  });
});
