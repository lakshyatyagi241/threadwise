import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/**
 * Email signatures (TW-MAIL-027): `/v2/email/signatures`. A signature is the shared one of a mailbox (`mailbox`) or an agent's own
 * (`user`). Which one a reply gets: the one the composer names (`signatureId`), else the replying user's default `user` signature, else the
 * default `mailbox` signature of the mailbox it goes out from, else none; `signature: false` on the reply sends none.
 * `mailbox` signatures need `mail.signatures.manage` plus `mail.mailboxes.manage` for a shared mailbox (or ownership of a personal one);
 * `user` signatures need only `mail.signatures.manage` and are always the caller's own.
 */
export const MAIL_SIGNATURE_SCOPES = ['mailbox', 'user'] as const;
export const mailSignatureScopeSchema = z.enum(MAIL_SIGNATURE_SCOPES);
export type MailSignatureScope = z.infer<typeof mailSignatureScopeSchema>;

export const MAIL_SIGNATURE_HTML_MAX = 20_000;
export const MAIL_SIGNATURE_TEXT_MAX = 5_000;

export const mailSignatureResponseSchema = z.object({
  id: uuidSchema,
  scope: mailSignatureScopeSchema,
  /** scope `mailbox`: which mailbox. */
  mailboxId: uuidSchema.nullable(),
  /** scope `user`: whose. */
  userId: uuidSchema.nullable(),
  name: z.string(),
  /** Sanitised on write (the same allow-list as inbound mail, no remote content). */
  bodyHtml: z.string(),
  bodyText: z.string(),
  isDefault: z.boolean(),
  rowVersion: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type MailSignatureResponse = z.infer<typeof mailSignatureResponseSchema>;

export const mailSignatureListResponseSchema = z.object({
  data: z.array(mailSignatureResponseSchema),
});
export type MailSignatureListResponse = z.infer<typeof mailSignatureListResponseSchema>;

/** `GET /v2/email/signatures?mailboxId=&scope=` */
export const listMailSignaturesQuerySchema = z.object({
  mailboxId: uuidSchema.optional(),
  scope: mailSignatureScopeSchema.optional(),
});
export type ListMailSignaturesQuery = z.infer<typeof listMailSignaturesQuerySchema>;

const body = {
  name: z.string().trim().min(1).max(80),
  bodyHtml: z.string().max(MAIL_SIGNATURE_HTML_MAX).default(''),
  /** Empty = derived from the HTML by the server. */
  bodyText: z.string().max(MAIL_SIGNATURE_TEXT_MAX).default(''),
  isDefault: z.boolean().default(false),
};

export const createMailSignatureSchema = z
  .object({
    scope: mailSignatureScopeSchema,
    /** Required for scope `mailbox`; forbidden for `user`. */
    mailboxId: uuidSchema.optional(),
    ...body,
  })
  .refine((v) => (v.scope === 'mailbox') === (v.mailboxId !== undefined), {
    message: 'mailboxId is required for a mailbox signature and not allowed for a user signature',
    path: ['mailboxId'],
  });
export type CreateMailSignatureInput = z.infer<typeof createMailSignatureSchema>;

export const updateMailSignatureSchema = z.object({
  name: body.name.optional(),
  bodyHtml: z.string().max(MAIL_SIGNATURE_HTML_MAX).optional(),
  bodyText: z.string().max(MAIL_SIGNATURE_TEXT_MAX).optional(),
  isDefault: z.boolean().optional(),
  rowVersion: z.number().int(),
});
export type UpdateMailSignatureInput = z.infer<typeof updateMailSignatureSchema>;
