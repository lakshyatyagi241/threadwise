import { normalisePhone, validateContact } from './contact-validation';

const values = (over: Partial<Parameters<typeof validateContact>[0]>) => ({
  name: '',
  phone: '',
  email: '',
  ...over,
});

describe('contact validation', () => {
  it('needs a phone or an email', () => {
    expect(validateContact(values({ name: 'Aarav' }))).toEqual({
      phone: 'contacts.form.needPhoneOrEmail',
    });
    expect(validateContact(values({ phone: '+919812345678' }))).toEqual({});
    expect(validateContact(values({ email: 'a@b.co' }))).toEqual({});
  });

  it('reads a phone as the API does: international, digits only after the plus', () => {
    expect(normalisePhone('+91 (98123) 45-678')).toBe('+919812345678');
    expect(validateContact(values({ phone: '+91 98123 45678' }))).toEqual({});
    expect(validateContact(values({ phone: '9812345678' }))).toEqual({
      phone: 'contacts.form.phoneInvalid',
    });
  });

  it('refuses an email the API would refuse', () => {
    expect(validateContact(values({ email: 'nope' }))).toEqual({
      email: 'contacts.form.emailInvalid',
    });
  });
});
