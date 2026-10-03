import { z } from 'zod';

/** A file uploaded for a message that goes out to many people (a broadcast, a campaign, a Telegram broadcast, a Facebook post). */
export const MARKETING_MEDIA_MAX_BYTES = 20 * 1024 * 1024;

export const marketingMediaSchema = z.object({
  /** An address the provider can fetch; a private bucket with no CDN gets a signed link that lasts seven days. */
  url: z.string().url(),
  name: z.string(),
  mime: z.string(),
  kind: z.enum(['image', 'video', 'audio', 'document']),
  size: z.number().int().nonnegative(),
});
export type MarketingMedia = z.infer<typeof marketingMediaSchema>;
