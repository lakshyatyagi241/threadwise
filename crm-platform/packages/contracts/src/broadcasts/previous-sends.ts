import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/**
 * Target a previous send (Reference's Scheduled composer offers "Previous broadcast" as the recipients; here every audience can, and a
 * send can be a broadcast or a campaign, including a run of a recurring broadcast): the contacts it went to, optionally only those who
 * reacted a certain way, the way marketing re-targets "everyone who did not read it".
 *
 *   all            everyone the message was meant for (opted-out and skipped rows are not recipients)
 *   delivered      it reached their phone (delivered or read)
 *   read           they read it
 *   not_read       it was sent to them and they did not read it
 *   replied        they replied (campaigns only: a broadcast keeps no replies)
 *   not_replied    it was sent to them and they did not reply (campaigns only)
 *   clicked        they clicked a tracked link (campaigns only)
 *   failed         it could not be delivered to them
 */
export const PREVIOUS_SEND_OUTCOMES = [
  'all',
  'delivered',
  'read',
  'not_read',
  'replied',
  'not_replied',
  'clicked',
  'failed',
] as const;
export type PreviousSendOutcome = (typeof PREVIOUS_SEND_OUTCOMES)[number];

export const PREVIOUS_SEND_KINDS = ['broadcast', 'campaign'] as const;
export type PreviousSendKind = (typeof PREVIOUS_SEND_KINDS)[number];

/** A broadcast records delivery and reading only. */
export const BROADCAST_OUTCOMES: readonly PreviousSendOutcome[] = [
  'all',
  'delivered',
  'read',
  'not_read',
  'failed',
];

/** Whether a send of this kind can be filtered by that outcome. */
export const previousOutcomeAllowed = (
  kind: PreviousSendKind,
  outcome: PreviousSendOutcome,
): boolean => kind === 'campaign' || BROADCAST_OUTCOMES.includes(outcome);

export const PREVIOUS_SENDS_MAX = 20;
export const previousSendRefSchema = z.object({
  kind: z.enum(PREVIOUS_SEND_KINDS),
  id: uuidSchema,
});
export type PreviousSendRef = z.infer<typeof previousSendRefSchema>;

/** The audience source: these sends, narrowed by one outcome. A contact in several is one recipient. */
export const previousSendsAudienceSchema = z
  .object({
    sends: z.array(previousSendRefSchema).max(PREVIOUS_SENDS_MAX).default([]),
    outcome: z.enum(PREVIOUS_SEND_OUTCOMES).default('all'),
  })
  .superRefine((v, ctx) => {
    // A broadcast keeps no replies or clicks, so it cannot be narrowed by them (it would silently match nobody).
    if (v.sends.some((s) => !previousOutcomeAllowed(s.kind, v.outcome))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['outcome'],
        message: 'previous_outcome_unsupported',
      });
    }
  });
export type PreviousSendsAudience = z.infer<typeof previousSendsAudienceSchema>;

/** Whether the source names any send. */
export const hasPreviousSends = (p: PreviousSendsAudience | null | undefined): boolean =>
  (p?.sends.length ?? 0) > 0;

/** One earlier send in the picker, with how many people each outcome holds (null when that send does not record it). */
export const previousSendOptionSchema = z.object({
  kind: z.enum(PREVIOUS_SEND_KINDS),
  id: uuidSchema,
  name: z.string(),
  /** When it went out (or was last worked), ISO; null when unknown. */
  at: z.string().datetime().nullable(),
  recipients: z.number().int(),
  delivered: z.number().int(),
  read: z.number().int(),
  replied: z.number().int().nullable(),
  clicked: z.number().int().nullable(),
  failed: z.number().int(),
});
export type PreviousSendOption = z.infer<typeof previousSendOptionSchema>;
