import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/**
 * What an email message carries beside its text body (TW-MAIL-025, 026): kept in the message `meta.email` block. The text body is
 * the plain text (search, previews); `html` is the sanitised HTML shown in the thread (remote images blocked until the agent asks).
 */
export const EMAIL_HTML_MAX = 65536;

/** Outbound attachment rules (TW-MAIL-027): at most this many files, each at most this big, all together at most the total. */
export const MAIL_ATTACHMENTS_MAX_COUNT = 10;
export const MAIL_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const MAIL_ATTACHMENTS_TOTAL_MAX_BYTES = 20 * 1024 * 1024;

export const emailAddressSchema = z.object({
  name: z.string().max(200).nullable(),
  address: z.string().max(320),
});
export type EmailAddress = z.infer<typeof emailAddressSchema>;

export const emailAttachmentSchema = z.object({
  /** Opaque id the attachment download route takes. */
  id: z.string().max(128),
  name: z.string().max(255),
  mime: z.string().max(127),
  size: z.number().int().min(0),
  /** Shown inside the HTML body rather than as a file. */
  inline: z.boolean().default(false),
  /** Over the size cap: not stored, shown as a note. */
  tooLarge: z.boolean().default(false),
});
export type EmailAttachment = z.infer<typeof emailAttachmentSchema>;

/** Why a sent mail came back (TW-MAIL-032): a hard bounce is permanent (no such mailbox), a soft one may pass (mailbox full). */
export const emailBounceSchema = z.object({
  kind: z.enum(['hard', 'soft']),
  /** The server's reason in short, never raw provider text beyond 300 characters. */
  reason: z.string().max(300),
  failedRecipient: z.string().max(320),
});
export type EmailBounce = z.infer<typeof emailBounceSchema>;

/** Where an outbound mail stands: handed to the provider, refused for good, or sent and then bounced. */
export const EMAIL_DELIVERY_STATES = ['sent', 'failed', 'bounced'] as const;
export const emailDeliverySchema = z.enum(EMAIL_DELIVERY_STATES);
export type EmailDelivery = z.infer<typeof emailDeliverySchema>;

export const emailMetaSchema = z.object({
  subject: z.string().max(998),
  from: emailAddressSchema,
  to: z.array(emailAddressSchema).max(100),
  cc: z.array(emailAddressSchema).max(100).default([]),
  bcc: z.array(emailAddressSchema).max(100).default([]),
  /** RFC 5322 Message-ID, without angle brackets. */
  messageId: z.string().max(998),
  inReplyTo: z.string().max(998).nullable().default(null),
  references: z.array(z.string().max(998)).max(100).default([]),
  /** Sanitised HTML, at most {@link EMAIL_HTML_MAX} characters. */
  html: z.string().max(EMAIL_HTML_MAX).nullable().default(null),
  /** The HTML was longer than the cap and cut. */
  htmlTruncated: z.boolean().default(false),
  /** The mailbox's own provider thread id (Gmail threadId). */
  threadId: z.string().max(128),
  attachments: z.array(emailAttachmentSchema).max(50).default([]),
  /** Auto-reply, bounce or list mail: stored but never opens a ticket loop. */
  automated: z.boolean().default(false),
  /** Set on the message that reports a bounce, or on the sent message that bounced (TW-MAIL-032). */
  bounce: emailBounceSchema.optional(),
  /** Outbound messages only. */
  delivery: emailDeliverySchema.optional(),
});
export type EmailMeta = z.infer<typeof emailMetaSchema>;

/** What the composer adds to a reply on an email conversation. */
export const emailReplyExtrasSchema = z.object({
  cc: z.array(z.string().trim().email().max(320)).max(20).default([]),
  bcc: z.array(z.string().trim().email().max(320)).max(20).default([]),
  /** Overrides the default `Re: <subject>`. */
  subject: z.string().trim().min(1).max(998).optional(),
  /** Staged composer uploads (`POST /v2/email/attachments/upload`) sent with this reply (TW-MAIL-027). */
  attachmentIds: z.array(uuidSchema).max(MAIL_ATTACHMENTS_MAX_COUNT).optional(),
  /** A specific signature to append. Absent = the default one for the sender and mailbox. */
  signatureId: uuidSchema.optional(),
  /** `false` sends without any signature (the composer's "remove signature"). */
  signature: z.boolean().optional(),
});
export type EmailReplyExtras = z.infer<typeof emailReplyExtrasSchema>;
