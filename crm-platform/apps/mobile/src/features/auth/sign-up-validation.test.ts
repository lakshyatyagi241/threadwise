import { validateSignUp, type SignUpValues } from './sign-up-validation';

const filled: SignUpValues = {
  fullName: '  Asha Rao ',
  email: ' Asha@Acme.test ',
  orgName: 'Acme Ltd',
  orgSlug: '',
  customSlug: false,
  phone: '98765 43210',
  referral: '',
  password: 'Correct-Horse-9',
  confirmPassword: 'Correct-Horse-9',
  acceptTerms: true,
};
const empty: SignUpValues = {
  fullName: '',
  email: '',
  orgName: '',
  orgSlug: '',
  customSlug: false,
  phone: '',
  referral: '',
  password: '',
  confirmPassword: '',
  acceptTerms: false,
};
const rules = { minLength: 12, defaultCountry: 'IN' as const };

const refused = (values: SignUpValues) => {
  const result = validateSignUp(values, rules);
  if (result.ok) throw new Error('expected the form to be refused');
  return result;
};

describe('validateSignUp: a good form', () => {
  it('builds the request the API expects: trimmed, lower-case email, the number in E.164', () => {
    expect(validateSignUp(filled, rules)).toEqual({
      ok: true,
      body: {
        orgName: 'Acme Ltd',
        fullName: 'Asha Rao',
        email: 'asha@acme.test',
        phone: '+919876543210',
        password: 'Correct-Horse-9',
        acceptTerms: true,
      },
    });
  });

  it('sends the workspace address only when the person chose to type one', () => {
    const typed = validateSignUp({ ...filled, customSlug: true, orgSlug: ' acme-team ' }, rules);
    expect(typed.ok && typed.body.orgSlug).toBe('acme-team');
    const blank = validateSignUp({ ...filled, customSlug: true, orgSlug: '  ' }, rules);
    expect(blank.ok && 'orgSlug' in blank.body).toBe(false);
    const forgotten = validateSignUp({ ...filled, customSlug: false, orgSlug: 'left-over' }, rules);
    expect(forgotten.ok && 'orgSlug' in forgotten.body).toBe(false);
  });

  it('sends the referral code when there is one', () => {
    const result = validateSignUp({ ...filled, referral: 'FRIEND7' }, rules);
    expect(result.ok && result.body.referralCode).toBe('FRIEND7');
  });
});

describe('validateSignUp: problems, by message key', () => {
  it('names every required field of an empty form, and starts at the first one on screen', () => {
    const result = refused(empty);
    expect(result.firstInvalid).toBe('fullName');
    expect(Object.fromEntries(Object.entries(result.issues).map(([f, i]) => [f, i.key]))).toEqual({
      fullName: 'signUp.validation.fullName',
      email: 'auth.emailInvalid',
      orgName: 'signUp.validation.orgName',
      phone: 'signUp.validation.phoneRequired',
      password: 'auth.passwordRequired',
      acceptTerms: 'signUp.validation.acceptTerms',
    });
  });

  it('holds the password to the live minimum, not only the contract floor of 8', () => {
    const result = refused({ ...filled, password: 'Short-Pw-1', confirmPassword: 'Short-Pw-1' });
    expect(result.issues.password).toEqual({
      key: 'signUp.passwordMinLength',
      params: { min: 12 },
    });
  });

  it('asks for the two passwords to match', () => {
    const result = refused({ ...filled, confirmPassword: 'Correct-Horse-8' });
    expect(result.issues.confirmPassword?.key).toBe('signUp.validation.passwordMismatch');
    expect(result.firstInvalid).toBe('confirmPassword');
  });

  it('tells a missing phone number from an invalid one', () => {
    expect(refused({ ...filled, phone: ' ' }).issues.phone?.key).toBe(
      'signUp.validation.phoneRequired',
    );
    expect(refused({ ...filled, phone: '12345' }).issues.phone?.key).toBe(
      'signUp.validation.phoneInvalid',
    );
  });

  it('refuses a workspace address with characters the API would not accept', () => {
    const result = refused({ ...filled, customSlug: true, orgSlug: 'bad slug!' });
    expect(result.issues.orgSlug?.key).toBe('signUp.validation.orgSlug');
  });

  it('refuses a referral code with symbols, and an unticked terms box', () => {
    expect(refused({ ...filled, referral: 'AB-1' }).issues.referralCode?.key).toBe(
      'signUp.validation.referralCode',
    );
    expect(refused({ ...filled, acceptTerms: false }).issues.acceptTerms?.key).toBe(
      'signUp.validation.acceptTerms',
    );
  });

  it('refuses an email address that is not one', () => {
    expect(refused({ ...filled, email: 'asha@' }).issues.email?.key).toBe('auth.emailInvalid');
  });

  it('reports the first problem in screen order, whatever order they were found in', () => {
    const result = refused({ ...filled, phone: '1', confirmPassword: 'nope' });
    expect(result.firstInvalid).toBe('phone');
  });
});
