import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { pageInfoSchema } from '../common/pagination';
import { isSafeLink } from './registry';

/** Marquee announcements (WD-CMS-017, 039..041): the public ticker and the in-app bar. */

export const ANNOUNCEMENT_TONES = ['info', 'promo', 'warning', 'success'] as const;
export const announcementToneSchema = z.enum(ANNOUNCEMENT_TONES);
export type AnnouncementTone = z.infer<typeof announcementToneSchema>;

/** Computed by the database clock, never stored: a disabled row is `disabled` whatever its window says. */
export const ANNOUNCEMENT_STATUSES = ['live', 'scheduled', 'expired', 'disabled'] as const;
export const announcementStatusSchema = z.enum(ANNOUNCEMENT_STATUSES);
export type AnnouncementStatus = z.infer<typeof announcementStatusSchema>;

export const announcementSchema = z.object({
  id: uuidSchema,
  text: z.string(),
  linkUrl: z.string().nullable(),
  linkLabel: z.string().nullable(),
  tone: announcementToneSchema,
  isActive: z.boolean(),
  dismissible: z.boolean(),
  sortOrder: z.number().int(),
  startsAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime().nullable(),
  status: announcementStatusSchema,
  rowVersion: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Announcement = z.infer<typeof announcementSchema>;

/** WaDesk's four pills: All, Live now (`active`), Disabled (`inactive`), Expired. */
export const ANNOUNCEMENT_FILTERS = ['all', 'active', 'inactive', 'expired'] as const;

export const announcementListQuerySchema = z.object({
  status: z.enum(ANNOUNCEMENT_FILTERS).catch('all').default('all'),
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(12),
  cursor: z.string().min(1).max(512).optional(),
});
export type AnnouncementListQuery = z.infer<typeof announcementListQuerySchema>;

export const announcementListResponseSchema = z.object({
  data: z.array(announcementSchema),
  page: pageInfoSchema,
  /** The four tiles, plus the sidebar badge (rows switched on, whatever their window). */
  summary: z.object({
    total: z.number().int(),
    live: z.number().int(),
    scheduled: z.number().int(),
    expired: z.number().int(),
    switchedOn: z.number().int(),
  }),
});
export type AnnouncementListResponse = z.infer<typeof announcementListResponseSchema>;

const linkUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === '' || (isSafeLink(v) && !/^(mailto|tel):/i.test(v)), {
    message: 'Use an https:// address or a path starting with /',
  });

const fields = {
  text: z.string().trim().min(1).max(500),
  linkUrl: linkUrl.nullish(),
  linkLabel: z.string().trim().max(64).nullish(),
  tone: announcementToneSchema.default('info'),
  isActive: z.boolean().default(true),
  dismissible: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(9999).default(0),
  /** Instants. The editor converts a wall-clock time in the chosen zone before it sends. */
  startsAt: z.string().datetime({ offset: true }).nullish(),
  expiresAt: z.string().datetime({ offset: true }).nullish(),
};

const windowOk = (v: { startsAt?: string | null; expiresAt?: string | null }) =>
  !v.startsAt || !v.expiresAt || new Date(v.expiresAt) >= new Date(v.startsAt);
const windowIssue = { message: 'Expires must be on or after Starts', path: ['expiresAt'] };

export const createAnnouncementRequestSchema = z.object(fields).refine(windowOk, windowIssue);
export type CreateAnnouncementRequest = z.infer<typeof createAnnouncementRequestSchema>;

export const updateAnnouncementRequestSchema = z
  .object({ ...fields, rowVersion: z.number().int().positive() })
  .refine(windowOk, windowIssue);
export type UpdateAnnouncementRequest = z.infer<typeof updateAnnouncementRequestSchema>;

export const toggleAnnouncementRequestSchema = z.object({
  rowVersion: z.number().int().positive().optional(),
});
export type ToggleAnnouncementRequest = z.infer<typeof toggleAnnouncementRequestSchema>;

/** What a bar needs; the set of ids is the dismissal key. */
export const liveAnnouncementSchema = z.object({
  id: uuidSchema,
  text: z.string(),
  linkUrl: z.string().nullable(),
  linkLabel: z.string().nullable(),
  tone: announcementToneSchema,
  dismissible: z.boolean(),
});
export type LiveAnnouncement = z.infer<typeof liveAnnouncementSchema>;

export const liveAnnouncementsResponseSchema = z.object({ data: z.array(liveAnnouncementSchema) });
export type LiveAnnouncementsResponse = z.infer<typeof liveAnnouncementsResponseSchema>;
