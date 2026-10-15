import { z } from 'zod';
import { intakeChannelSchema, type IntakeChannel } from './intake';

/**
 * The consent notice of an intake point (BL-167): the wording a person sees next to a tick box (the website chat widget's pre-chat
 * form, a booking page) or that a store's marketing checkbox stands for (Shopify, WooCommerce). One notice per (scope, ref), versioned:
 * a change to the text, the link or the on/off state appends a new version, so the ledger can name the exact version a person agreed
 * to (`noticeVersion`) and the wording can be reconstructed. A grant is written only when the person ticked the box
 * (docs/specs/privacy-and-data-governance.md section 4.3.2).
 */
/**
 * `workspace` is the workspace's default wording (BL-179): one notice per language, `ref` is the language code (`en`, `hi`...). Forms and
 * the other editors are offered it; the DPDP profile asks for English plus an Indian language.
 */
export const CONSENT_NOTICE_SCOPES = ['widget', 'booking', 'commerce', 'workspace'] as const;
export const consentNoticeScopeSchema = z.enum(CONSENT_NOTICE_SCOPES);
export type ConsentNoticeScope = z.infer<typeof consentNoticeScopeSchema>;

export const CONSENT_NOTICE_TEXT_MAX = 1000;

/** What the settings screens send. An enabled notice needs its wording; a disabled one keeps it for next time. */
export const saveConsentNoticeSchema = z
  .object({
    enabled: z.boolean(),
    text: z.string().trim().max(CONSENT_NOTICE_TEXT_MAX),
    /** The privacy policy or terms the wording points to. https only. */
    url: z
      .string()
      .trim()
      .max(500)
      .regex(/^https:\/\/\S+$/i, 'The link must start with https://')
      .nullish()
      .transform((v) => (v ? v : null)),
    /** The terms the wording points to, next to the privacy link above (BL-175). Optional; https only. */
    termsUrl: z
      .string()
      .trim()
      .max(500)
      .regex(/^https:\/\/\S+$/i, 'The link must start with https://')
      .nullish()
      .transform((v) => (v ? v : null)),
    /**
     * Stores only: the extra channel the store's marketing checkbox is worded to cover. `whatsapp` makes a customer's marketing consent
     * in the store count for WhatsApp too (the store's own flags cover email and SMS). Ignored by the widget and the booking page,
     * which grant on the channels the person gave.
     */
    channels: z.array(intakeChannelSchema).max(3).default([]),
  })
  .refine((v) => !v.enabled || v.text !== '', {
    message: 'Write the wording the person agrees to before switching the consent line on.',
    path: ['text'],
  });
export type SaveConsentNoticeInput = z.infer<typeof saveConsentNoticeSchema>;

/** The current notice of an intake point. `version` is 0 and `text` empty until one is saved. */
export const consentNoticeSchema = z.object({
  scope: consentNoticeScopeSchema,
  ref: z.string(),
  enabled: z.boolean(),
  text: z.string(),
  url: z.string().nullable(),
  termsUrl: z.string().nullable(),
  channels: z.array(intakeChannelSchema),
  version: z.number().int().min(0),
  updatedAt: z.string().nullable(),
});
export type ConsentNotice = z.infer<typeof consentNoticeSchema>;

/** What a public page gets: only an enabled notice, nothing else. */
export const publicConsentNoticeSchema = z.object({
  text: z.string(),
  version: z.number().int().min(1),
  url: z.string().nullable(),
  /** Optional so an older client that does not know it keeps parsing. */
  termsUrl: z.string().nullable().optional(),
  channels: z.array(intakeChannelSchema),
});
export type PublicConsentNotice = z.infer<typeof publicConsentNoticeSchema>;

/**
 * The channels a ticked consent line grants on at the widget and the booking page. The notice names the channels its wording covers;
 * a channel is granted only when the person gave what it needs (WhatsApp and SMS a phone, email an address). A notice saved before the
 * choice existed has none: it keeps the old rule (WhatsApp for a phone, email for an address, never SMS).
 */
export function noticeGrantChannels(
  notice: Pick<PublicConsentNotice, 'channels'>,
  reachable: { phone: boolean; email: boolean },
): IntakeChannel[] {
  const chosen: readonly IntakeChannel[] =
    notice.channels.length > 0 ? notice.channels : ['whatsapp', 'email'];
  return (['whatsapp', 'sms', 'email'] as const).filter(
    (ch) => chosen.includes(ch) && (ch === 'email' ? reachable.email : reachable.phone),
  );
}
