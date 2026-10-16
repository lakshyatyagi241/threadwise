/**
 * The one table of template button spellings, shared by the API (send path, overrides, inbox, channels) and the web (override panel):
 * Meta's (`URL`, `QUICK_REPLY`, `FLOW`, `OTP`...), our template form's and Reference's (`visit_website`, `call_phone`, `copy_text`).
 */
export type TemplateButtonKind =
  | 'url'
  | 'quick_reply'
  | 'phone'
  | 'copy_code'
  | 'voice_call'
  | 'catalog'
  | 'flow'
  | 'otp'
  | 'mpm'
  | 'spm'
  | 'other';

const ALIASES: Record<string, TemplateButtonKind> = {
  url: 'url',
  visit_website: 'url',
  cta_url: 'url',
  quick_reply_url: 'url',
  quick_reply: 'quick_reply',
  phone_number: 'phone',
  call_phone: 'phone',
  call: 'phone',
  phone: 'phone',
  cta_call: 'phone',
  copy_code: 'copy_code',
  copy_text: 'copy_code',
  coupon_code: 'copy_code',
  voice_call: 'voice_call',
  catalog: 'catalog',
  flow: 'flow',
  otp: 'otp',
  otp_one_tap: 'otp',
  otp_copy: 'otp',
  mpm: 'mpm',
  spm: 'spm',
};

/** The kind of a stored button type, in any spelling and case. A type nobody knows is `other`. */
export function templateButtonKindOf(type: unknown): TemplateButtonKind {
  const t = (typeof type === 'string' ? type : '').trim().toLowerCase();
  return ALIASES[t] ?? 'other';
}
