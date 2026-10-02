import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { pageInfoSchema } from '../common/pagination';

/** The public contact form and the operator's inbox (TW-CMS-005/006/042/043). */

export const CMS_CONTACT_TOPICS = ['sales', 'support', 'partnership', 'other'] as const;
export const cmsContactTopicSchema = z.enum(CMS_CONTACT_TOPICS);

export const cmsContactSubmitRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(190),
  company: z.string().trim().max(160).nullish(),
  topic: cmsContactTopicSchema.nullish(),
  message: z.string().trim().min(1).max(5000),
  /** Honeypot: a person never sees this field. Anything in it gets a silent success and no row. */
  website: z.string().max(500).optional(),
  captchaToken: z.string().max(4000).optional(),
});
export type CmsContactSubmitRequest = z.infer<typeof cmsContactSubmitRequestSchema>;

export const cmsContactSubmitResponseSchema = z.object({ ok: z.literal(true) });
export type CmsContactSubmitResponse = z.infer<typeof cmsContactSubmitResponseSchema>;

export const cmsContactMessageSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  email: z.string(),
  company: z.string().nullable(),
  topic: z.string().nullable(),
  message: z.string(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  isRead: z.boolean(),
  createdAt: z.string().datetime(),
  rowVersion: z.number().int(),
});
export type CmsContactMessage = z.infer<typeof cmsContactMessageSchema>;

export const cmsContactListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(['unread', 'read']).optional().catch(undefined),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).max(512).optional(),
});
export type CmsContactListQuery = z.infer<typeof cmsContactListQuerySchema>;

export const cmsContactListResponseSchema = z.object({
  data: z.array(cmsContactMessageSchema),
  page: pageInfoSchema,
  summary: z.object({ total: z.number().int(), unread: z.number().int() }),
});
export type CmsContactListResponse = z.infer<typeof cmsContactListResponseSchema>;

export const setCmsContactReadRequestSchema = z.object({ isRead: z.boolean() });
export type SetCmsContactReadRequest = z.infer<typeof setCmsContactReadRequestSchema>;
