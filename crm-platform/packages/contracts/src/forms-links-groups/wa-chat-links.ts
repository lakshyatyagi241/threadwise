/**
 * WhatsApp Link Generator (WFL; Reference `/wa-links` + public `/l/{slug}`): a trackable click-to-chat short link.
 * See docs/threadwise-port/inventory/forms-links-groups.md TW-WFL-012..018. Engine-agnostic (works regardless of which
 * WhatsApp engine the workspace uses) — unrelated to the generic broadcast/campaign click tracker.
 */
import { z } from 'zod';
import { PHONE_MAX_DIGITS, PHONE_MIN_DIGITS } from '../contacts-attributes-tags/phone';

export const WA_CHAT_LINK_NAME_MAX = 140;
export const WA_CHAT_LINK_COUNTRY_CODE_MAX = 8;
export const WA_CHAT_LINK_PHONE_MAX = 24;
export const WA_CHAT_LINK_WELCOME_MESSAGE_MAX = 4000;
export const WA_CHAT_LINK_SLUG_MAX = 64;
export const WA_CHAT_LINK_UTM_MAX = 80;
/** E.164: combined country code + number digits must be 7–15 (TW-WFL-014) — the same rule `canonicalizePhone` enforces. */
export const WA_CHAT_LINK_DIGITS_MIN = PHONE_MIN_DIGITS;
export const WA_CHAT_LINK_DIGITS_MAX = PHONE_MAX_DIGITS;

export const WA_CHAT_LINK_STATUSES = ['active', 'paused'] as const;
export const waChatLinkStatusSchema = z.enum(WA_CHAT_LINK_STATUSES);
export type WaChatLinkStatus = z.infer<typeof waChatLinkStatusSchema>;

export const waChatLinkSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  countryCode: z.string(),
  phoneNumber: z.string(),
  welcomeMessage: z.string().nullable(),
  utmSource: z.string().nullable(),
  utmMedium: z.string().nullable(),
  utmCampaign: z.string().nullable(),
  clickCount: z.number().int(),
  lastClickedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  status: waChatLinkStatusSchema,
  /** Derived: status === 'active' && (no expiry or expiry in the future). */
  isLive: z.boolean(),
  /** `https://wa.me/<digits>?text=<urlencoded>` — never includes the UTM fields (WhatsApp would ignore them). */
  waUrl: z.string(),
  /** `/l/<slug>`, relative — the frontend renders it against the current origin. */
  shortPath: z.string(),
  createdAt: z.string(),
  rowVersion: z.number().int(),
});
export type WaChatLink = z.infer<typeof waChatLinkSchema>;

export const waChatLinkStatsSchema = z.object({
  all: z.number().int(),
  live: z.number().int(),
  totalClicks: z.number().int(),
  avgClicksPerLink: z.number(),
});
export type WaChatLinkStats = z.infer<typeof waChatLinkStatsSchema>;

export const waChatLinkListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).max(200).optional(),
  /** `live` and `paused` are server-filtered (TW-WFL-018); omitted/`all` returns everything. */
  status: z.enum(['all', 'live', 'paused']).default('all'),
});
export type WaChatLinkListQuery = z.infer<typeof waChatLinkListQuerySchema>;

export const waChatLinkListSchema = z.object({
  items: z.array(waChatLinkSchema),
  stats: waChatLinkStatsSchema,
  page: z.object({
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
    limit: z.number().int(),
  }),
});
export type WaChatLinkList = z.infer<typeof waChatLinkListSchema>;

/**
 * `POST /v2/wa-links` (create) or `PATCH /v2/wa-links/:id` (update). Phone digits must combine to 7–15 (E.164);
 * a blank slug mints a random one. UTM fields are stored for reporting only, never appended to `waUrl`.
 */
export const saveWaChatLinkInputSchema = z.object({
  name: z.string().trim().min(1).max(WA_CHAT_LINK_NAME_MAX),
  countryCode: z.string().trim().min(1).max(WA_CHAT_LINK_COUNTRY_CODE_MAX),
  phoneNumber: z.string().trim().min(1).max(WA_CHAT_LINK_PHONE_MAX),
  welcomeMessage: z.string().trim().max(WA_CHAT_LINK_WELCOME_MESSAGE_MAX).optional(),
  slug: z
    .string()
    .trim()
    .max(WA_CHAT_LINK_SLUG_MAX)
    .regex(/^[a-z0-9-]*$/, 'Use lowercase letters, numbers and hyphens only')
    .optional(),
  utmSource: z.string().trim().max(WA_CHAT_LINK_UTM_MAX).optional(),
  utmMedium: z.string().trim().max(WA_CHAT_LINK_UTM_MAX).optional(),
  utmCampaign: z.string().trim().max(WA_CHAT_LINK_UTM_MAX).optional(),
  expiresAt: z.string().datetime().optional(),
  status: waChatLinkStatusSchema.default('active'),
  rowVersion: z.number().int().optional(),
});
export type SaveWaChatLinkInput = z.infer<typeof saveWaChatLinkInputSchema>;
