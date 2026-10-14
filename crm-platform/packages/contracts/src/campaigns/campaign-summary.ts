import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/**
 * The director summary of a sent campaign or broadcast: how many people were messaged, received it, read it, WROTE BACK and FILLED AN
 * APPLICATION FORM, in terms an admission head can read. Counts are distinct PEOPLE, never messages. "Wrote back" is worked out live from
 * the inbox (a customer message after the send, inside the window), not from the stored `responded_at`, which only some workspaces fill.
 */

export const SUMMARY_WINDOW_DAYS = [3, 7, 14] as const;
export const SUMMARY_WINDOW_DEFAULT = 7;
export const summaryWindowSchema = z.coerce
  .number()
  .int()
  .refine(
    (n) => (SUMMARY_WINDOW_DAYS as readonly number[]).includes(n),
    'window must be 3, 7 or 14 days',
  );

/** Which forms count as "an application": none picked = every web form and WhatsApp form of the workspace. */
export const summaryFormRefSchema = z.object({
  id: uuidSchema,
  kind: z.enum(['web', 'whatsapp']),
  name: z.string(),
});
export type SummaryFormRef = z.infer<typeof summaryFormRefSchema>;

export const campaignSummaryQuerySchema = z.object({
  cameBackDays: summaryWindowSchema.default(SUMMARY_WINDOW_DEFAULT),
  /** Comma-separated form ids (web or WhatsApp); empty = all forms. */
  formIds: z
    .string()
    .optional()
    .transform((v) =>
      (v ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    )
    .pipe(z.array(uuidSchema).max(50)),
});
export type CampaignSummaryQuery = z.infer<typeof campaignSummaryQuerySchema>;

/** Why a number is a floor: a code the screen turns into a plain sentence. */
export const SUMMARY_CAVEATS = [
  'recipients_without_contact',
  'contact_match_only',
  'opted_out_excluded',
  'counted_in_other_campaigns',
] as const;
export type SummaryCaveat = (typeof SUMMARY_CAVEATS)[number];

export const campaignSummarySchema = z.object({
  /** The campaign (or broadcast) uuid. */
  id: uuidSchema,
  kind: z.enum(['campaign', 'broadcast']),
  name: z.string(),
  status: z.string(),
  /** First message sent; null before any send. */
  sentAt: z.string().datetime().nullable(),
  window: z.object({
    days: z.number().int(),
    from: z.string().datetime().nullable(),
    to: z.string().datetime().nullable(),
  }),
  people: z.object({
    /** Recipients a message left for. */
    messaged: z.number().int(),
    delivered: z.number().int(),
    read: z.number().int(),
    failed: z.number().int(),
    /** Recipients we could not match to a contact, so "wrote back" and "filled a form" cannot be counted for them. */
    notTrackable: z.number().int(),
  }),
  cameBack: z.object({
    count: z.number().int(),
    /** Percent of messaged, one decimal. */
    pctOfMessaged: z.number(),
    pctOfDelivered: z.number(),
    /** Median hours from the send to the first reply; null when nobody wrote back. */
    medianHoursToReply: z.number().nullable(),
  }),
  /** Null when the viewer may not read form submissions. */
  filledForm: z
    .object({
      count: z.number().int(),
      pctOfMessaged: z.number(),
      /** Of those who filled a form, how many had also written back. */
      alsoWroteBack: z.number().int(),
      viaWebForm: z.number().int(),
      viaWhatsappForm: z.number().int(),
      /** The forms that were counted (all of them when none was picked). */
      formsCounted: z.array(summaryFormRefSchema).max(50),
      allForms: z.boolean(),
    })
    .nullable(),
  /** Daily count of people who wrote back, from the first send, so the screen can draw one quiet line. */
  cameBackByDay: z.array(z.object({ day: z.string(), count: z.number().int() })).max(31),
  caveats: z.array(z.enum(SUMMARY_CAVEATS)),
});
export type CampaignSummary = z.infer<typeof campaignSummarySchema>;

export const SUMMARY_PEOPLE_KINDS = ['came_back', 'filled_form', 'not_reached'] as const;
export const campaignSummaryPeopleQuerySchema = z.object({
  kind: z.enum(SUMMARY_PEOPLE_KINDS),
  cameBackDays: summaryWindowSchema.default(SUMMARY_WINDOW_DEFAULT),
  formIds: campaignSummaryQuerySchema.shape.formIds,
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type CampaignSummaryPeopleQuery = z.infer<typeof campaignSummaryPeopleQuerySchema>;

export const summaryPersonSchema = z.object({
  /** The contact; null for a recipient with no contact. */
  contactId: uuidSchema.nullable(),
  name: z.string().nullable(),
  phone: z.string().nullable(),
  /** When they wrote back / filled the form / (not reached) when the send failed. */
  at: z.string().datetime().nullable(),
  /** For filled_form: which form. */
  formName: z.string().nullable(),
});
export type SummaryPerson = z.infer<typeof summaryPersonSchema>;

export const campaignSummaryPeopleSchema = z.object({
  data: z.array(summaryPersonSchema),
  nextCursor: z.string().nullable(),
  total: z.number().int(),
});
export type CampaignSummaryPeople = z.infer<typeof campaignSummaryPeopleSchema>;

export const summaryFormsResponseSchema = z.object({
  data: z.array(summaryFormRefSchema).max(200),
});
export type SummaryFormsResponse = z.infer<typeof summaryFormsResponseSchema>;
