import { WSP_CHAT_LIMIT_MAX, wspChatLimitSchema, wspMemberPhoneSchema } from '@crm/contracts';

export type DetailsError = 'invalid';
export type DetailsErrors = Partial<Record<'phone' | 'chatLimit', DetailsError>>;

/** What the invite and change dialogs edit as text. */
export interface DetailsText {
  phone: string;
  /** Digits, or empty for no limit. */
  chatLimit: string;
}

/**
 * Phone as typed ("+91 98765-43210", "(+91) 98765 43210", "0091 98765 43210") to the E.164 form the API stores. Spaces, dashes,
 * dots and brackets are dropped and a leading 00 is read as +. Empty = no phone (null). `undefined` = not a valid number.
 */
export function parsePhone(raw: string): string | null | undefined {
  const text = raw.trim();
  if (text === '') return null;
  const compact = text.replace(/[\s\-.()]/g, '');
  const withPlus = compact.startsWith('00') ? `+${compact.slice(2)}` : compact;
  const parsed = wspMemberPhoneSchema.safeParse(withPlus);
  return parsed.success ? (parsed.data as string | null) : undefined;
}

/** Chat limit as typed: empty = no limit (null), a whole number from 1 to the maximum, else `undefined`. */
export function parseChatLimit(raw: string): number | null | undefined {
  const text = raw.trim();
  if (text === '') return null;
  if (!/^\d{1,5}$/.test(text)) return undefined;
  const parsed = wspChatLimitSchema.safeParse(Number(text));
  return parsed.success ? parsed.data : undefined;
}

export function validateDetails(
  form: DetailsText,
): { phone: string | null; chatLimit: number | null } | { errors: DetailsErrors } {
  const phone = parsePhone(form.phone);
  const chatLimit = parseChatLimit(form.chatLimit);
  const errors: DetailsErrors = {};
  if (phone === undefined) errors.phone = 'invalid';
  if (chatLimit === undefined) errors.chatLimit = 'invalid';
  if (phone === undefined || chatLimit === undefined) return { errors };
  return { phone, chatLimit };
}

export { WSP_CHAT_LIMIT_MAX };
