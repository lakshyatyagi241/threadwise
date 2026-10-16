import type { RowView } from './row-view';

/**
 * What the quick-action cluster beside a contact's name can do, decided once so the table, the grid and the tests
 * agree. A link is `null` when the contact lacks the data: the button is then drawn disabled, never hidden, so the
 * cluster keeps its width and rows line up.
 */
export interface QuickActions {
  /** `tel:` link. */
  call: string | null;
  /** `https://wa.me/<digits>` link. */
  whatsapp: string | null;
  /** `mailto:` link. */
  email: string | null;
}

/**
 * Whether a phone string is the server's masked display form (apps/api/src/modules/crm/contacts/phone-mask.ts),
 * not the real number. A real phone number never contains a letter; the API's mask only ever inserts literal
 * `x` placeholders for the digits a caller without `contacts.phone.reveal` may not see — so a bare `/x/i` test
 * is a cheap, unambiguous signal, with no need to parse the masking shape itself.
 */
export function isMaskedPhone(phone: string): boolean {
  return /x/i.test(phone);
}

/**
 * Digits (and a leading +) of a phone number as typed or formatted; empty when there are none, and empty for a
 * masked number too — a `tel:`/`wa.me` link built from `xxxxxxxx0025` would dial a wrong, meaningless target
 * instead of the real contact, which is worse than disabling the action.
 */
export function phoneDigits(phone: string): string {
  if (isMaskedPhone(phone)) return '';
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';
  return trimmed.startsWith('+') ? `+${digits}` : digits;
}

export function quickActions(row: Pick<RowView, 'phone' | 'email'>): QuickActions {
  const phone = phoneDigits(row.phone);
  const email = row.email.trim();
  return {
    call: phone ? `tel:${phone}` : null,
    // wa.me wants the number without the plus sign.
    whatsapp: phone ? `https://wa.me/${phone.replace(/^\+/, '')}` : null,
    email: email ? `mailto:${email}` : null,
  };
}

export type MenuAction = 'view' | 'edit' | 'group' | 'tag' | 'delete';

/** The items of the "..." menu, in order, for what the viewer may do. View is always there. */
export function menuActions(can: { edit: boolean; delete: boolean }): MenuAction[] {
  return [
    'view',
    ...(can.edit ? (['edit', 'group', 'tag'] as const) : []),
    ...(can.delete ? (['delete'] as const) : []),
  ];
}
