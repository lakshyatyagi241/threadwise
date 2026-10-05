import { z } from 'zod';

/**
 * One job on `media-fetch` per inbound message whose file still has to be copied from the provider. The job carries ids only: the worker
 * re-reads the message (which holds the provider's media id, mime and checksum in `meta.mediaFetch`), so a job can never act on stale
 * data, and a message that is already finished, failed, or on a newer generation is simply skipped.
 */
export const MEDIA_FETCH_JOB = 'media.fetch';

export const mediaFetchJobSchema = z.object({
  orgId: z.number().int().positive(),
  messageUuid: z.string().uuid(),
  /** 1 for the first run, +1 per manual Retry of a failed file (so it gets a job id the earlier run's finished job does not hold). */
  generation: z.number().int().positive(),
});
export type MediaFetchJob = z.infer<typeof mediaFetchJobSchema>;

/**
 * Attempts and backoff of a download: 6 attempts, 15 s doubling (15, 30, 60, 120, 240 s: about 8 minutes in all). Long enough to ride out a
 * short Meta outage, short enough that an agent is not left looking at a placeholder for an hour; after that the file is marked failed
 * and a Retry is one click. (Meta's own download address lives only minutes, so every attempt asks for a fresh one.)
 */
export const MEDIA_FETCH_JOB_OPTIONS = {
  attempts: 6,
  backoff: { type: 'exponential' as const, delay: 15_000 },
};

/** `:` is reserved by BullMQ. */
export const mediaFetchJobId = (messageUuid: string, generation: number): string =>
  `media-${messageUuid}-${generation}`;

/** What the ingest step stores under `meta.mediaFetch`: the provider's handle for the file and what is known about it. */
export const mediaFetchRequestSchema = z.object({
  providerMediaId: z.string().min(1),
  mediaKind: z.enum(['image', 'video', 'audio', 'document', 'sticker']),
  mime: z.string(),
  sha256: z.string().optional(),
  name: z.string().optional(),
  sizeBytes: z.number().optional(),
});
export type MediaFetchRequest = z.infer<typeof mediaFetchRequestSchema>;
