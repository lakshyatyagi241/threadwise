import { z } from 'zod';
import { receiptStatusSchema } from '@crm/contracts';

/**
 * What travels on the `webhook-ingest` queue for a channel: one inbound message or one delivery receipt, already normalised by the
 * adapter. A webhook controller (or the dev simulator) enqueues these and answers at once; the worker stores them. Dates are ISO
 * strings because the payload is JSON in Redis.
 *
 * Duplicates are expected (providers retry, the simulator sends the same message three times on request). The job id is only an
 * optimisation: the ledger's unique key is the authority that makes a second delivery a no-op.
 */
export const CHANNEL_INGEST_JOB = 'channel.ingest';

const inboundSchema = z.object({
  providerMessageId: z.string(),
  peerKey: z.string(),
  peerName: z.string().optional(),
  kind: z.enum(['text', 'media', 'location', 'contact', 'reaction', 'interactive', 'unsupported']),
  body: z.string().optional(),
  media: z
    .object({
      providerMediaId: z.string(),
      mediaKind: z.enum(['image', 'video', 'audio', 'document', 'sticker']),
      mime: z.string(),
      name: z.string().optional(),
      sizeBytes: z.number().optional(),
      sha256: z.string().optional(),
      voice: z.boolean().optional(),
    })
    .optional(),
  location: z
    .object({
      latitude: z.number(),
      longitude: z.number(),
      name: z.string().optional(),
      address: z.string().optional(),
    })
    .optional(),
  replyToProviderMessageId: z.string().optional(),
  reactionEmoji: z.string().optional(),
  meta: z.record(z.unknown()).optional(),
  providerTimestamp: z.string().datetime(),
  group: z
    .object({
      title: z.string().optional(),
      participant: z.string(),
      participantName: z.string().optional(),
    })
    .optional(),
  history: z.object({ direction: z.enum(['in', 'out']) }).optional(),
});

const receiptSchema = z.object({
  providerMessageId: z.string(),
  status: receiptStatusSchema,
  at: z.string().datetime(),
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
});

export const channelIngestJobSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('inbound'),
    orgId: z.number().int().positive(),
    channelUuid: z.string().uuid(),
    message: inboundSchema,
  }),
  z.object({
    type: z.literal('receipt'),
    orgId: z.number().int().positive(),
    channelUuid: z.string().uuid(),
    receipt: receiptSchema,
  }),
]);
export type ChannelIngestJob = z.infer<typeof channelIngestJobSchema>;
