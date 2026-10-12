import type { ContactResponse } from '@crm/contracts';
import type { TFunction } from 'i18next';

type Named = Pick<ContactResponse, 'name' | 'firstName' | 'lastName' | 'phone' | 'email'>;

/** What a contact is called on screen: the name, else first and last, else the phone, else the email, else "Unknown". */
export function displayName(contact: Named, t: TFunction): string {
  const full =
    contact.name?.trim() || `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim();
  return full || contact.phone || contact.email || t('contacts.unknown');
}

/** The line under the name: the phone, else the email. Null when the name already is the only thing known. */
export function contactLine(contact: Named): string | null {
  return contact.phone || contact.email || null;
}

/** A date for a card: "12 Oct 2026". Empty when the API has none. */
export function formatDate(iso: string | null | undefined, locale: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(locale, { dateStyle: 'medium' });
}

/** A moment for a card: date and time. */
export function formatMoment(iso: string | null | undefined, locale: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
}

/** A custom field value as text: numbers and words as they are, yes/no for booleans, a list joined, anything else as JSON. */
export function customValueText(value: unknown, yes: string, no: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value ? yes : no;
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map((v) => customValueText(v, yes, no) ?? '').join(', ');
  return JSON.stringify(value);
}
