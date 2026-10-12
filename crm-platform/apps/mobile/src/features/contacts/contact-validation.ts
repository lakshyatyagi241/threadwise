import { emailSchema, phoneSchema } from '@crm/contracts';

export interface ContactFormValues {
  name: string;
  phone: string;
  email: string;
}

export type ContactField = keyof ContactFormValues;
export type ContactFormErrorKey =
  'contacts.form.needPhoneOrEmail' | 'contacts.form.phoneInvalid' | 'contacts.form.emailInvalid';

/** A phone as people type it ("+91 98765-43210") becomes the digits the API takes ("+919876543210"). */
export const normalisePhone = (raw: string): string => raw.replace(/[\s().-]/g, '');

/**
 * The same rules as the API's `createContactSchema`, using its own email and phone schemas: one of phone or email, each in the
 * shape the API takes. Anything finer (is it a real number, does it belong to another contact) is the server's answer, shown
 * under the field by the form.
 */
export function validateContact(
  values: ContactFormValues,
): Partial<Record<ContactField, ContactFormErrorKey>> {
  const errors: Partial<Record<ContactField, ContactFormErrorKey>> = {};
  const phone = normalisePhone(values.phone);
  const email = values.email.trim();
  if (!phone && !email) errors.phone = 'contacts.form.needPhoneOrEmail';
  if (phone && !phoneSchema.safeParse(phone).success) errors.phone = 'contacts.form.phoneInvalid';
  if (email && !emailSchema.safeParse(email).success) errors.email = 'contacts.form.emailInvalid';
  return errors;
}
