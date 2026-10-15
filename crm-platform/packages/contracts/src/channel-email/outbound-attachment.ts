import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/**
 * Composer uploads (TW-MAIL-027): `POST /v2/email/attachments/upload` (multipart, field `file`, optional field `conversationId`) stages one
 * file in the object store for the caller; the reply names it in `email.attachmentIds`. A staged file belongs to the uploader, expires
 * after `MAIL_OUTBOUND_ATTACHMENT_TTL_HOURS` hours if not sent, and may be sent once. Limits: `MAIL_ATTACHMENTS_MAX_COUNT`,
 * `MAIL_ATTACHMENT_MAX_BYTES`, `MAIL_ATTACHMENTS_TOTAL_MAX_BYTES` (email-meta.ts); the upload policy of the object store also refuses
 * executables.
 */
export const MAIL_OUTBOUND_ATTACHMENT_TTL_HOURS = 24;

export const mailOutboundAttachmentSchema = z.object({
  id: uuidSchema,
  name: z.string().max(255),
  mime: z.string().max(127),
  size: z.number().int().min(1),
  expiresAt: z.string().datetime(),
});
export type MailOutboundAttachment = z.infer<typeof mailOutboundAttachmentSchema>;

export const uploadMailAttachmentFieldsSchema = z.object({
  conversationId: uuidSchema.optional(),
});
export type UploadMailAttachmentFields = z.infer<typeof uploadMailAttachmentFieldsSchema>;
