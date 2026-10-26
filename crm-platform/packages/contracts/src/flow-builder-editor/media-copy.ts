import { z } from 'zod';

/**
 * A builder asks the server to keep its own copy of a picture found at a web address (a carousel card's picture). The copy is
 * served from this server, so a visitor's chat loads it without asking the picture's own host.
 */
export const flbMediaFromUrlRequest = z.object({
  url: z.string().trim().min(1).max(2048),
});
export type FlbMediaFromUrlRequest = z.infer<typeof flbMediaFromUrlRequest>;

/** The stored copy: the same shape as an upload's answer. */
export interface FlbMediaCopy {
  url: string;
  filename: string;
  type: 'image';
  mimeType: string;
}
