import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { speedToLeadSchema } from './speed-to-lead';

/**
 * Lead sources: the doors into the lead pipeline (docs/specs/email-channel-and-social-leads.md, L-01..L-12). A source says where leads
 * come from, how its payload maps onto a contact, and what happens to a lead on arrival (owner, deal, notification). Today the only
 * door a workspace creates is the generic webhook; `kind` already names the ones that follow (Meta lead forms, TikTok, LinkedIn,
 * Google Ads) and `connector` for a marketplace portal.
 *
 * Secrets are write-only: the URL token is returned once (create, rotate), the shared secret never.
 */

export const LEAD_SOURCE_KINDS = [
  'webhook',
  'meta_lead_ads',
  'tiktok',
  'linkedin',
  'google_ads',
  'connector',
] as const;
export const leadSourceKindSchema = z.enum(LEAD_SOURCE_KINDS);
export type LeadSourceKind = z.infer<typeof leadSourceKindSchema>;

export const LEAD_SOURCE_STATUSES = ['active', 'paused'] as const;
export const leadSourceStatusSchema = z.enum(LEAD_SOURCE_STATUSES);
export type LeadSourceStatus = z.infer<typeof leadSourceStatusSchema>;

/** Raw payloads are kept this long by default, then purged by the worker (spec open question 9). */
export const LEAD_RAW_RETENTION_DEFAULT_DAYS = 30;
export const LEAD_RAW_RETENTION_MAX_DAYS = 365;

/** The header a sender puts the optional shared secret in. */
export const LEAD_HOOK_SECRET_HEADER = 'x-webhook-secret';
/** Where a source's URL lives, below the API's own origin. The token is the last segment. */
export const LEAD_HOOK_PATH_PREFIX = '/v2/public/lead-hooks/';
/** A body above this is refused 413 by the door (the platform's own parser limit may be tighter). */
export const LEAD_HOOK_MAX_BODY_BYTES = 1_048_576;

/** A path into the payload: a key (`phone_number`, `Full Name`) or a dotted/indexed path (`lead.contact.phone`, `answers[0].value`). */
const payloadPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is refused
  .refine((v) => !/[\u0000-\u001f]/.test(v), 'must not contain control characters');

/** The key of a custom contact property (the same keys `/fields` hands out). */
const propertyKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,63}$/, 'must be a contact property key such as "budget"');

export const leadFieldMappingSchema = z
  .object({
    name: payloadPathSchema.optional(),
    firstName: payloadPathSchema.optional(),
    lastName: payloadPathSchema.optional(),
    email: payloadPathSchema.optional(),
    phone: payloadPathSchema.optional(),
    /** Contact property key -> payload path. Only active contact properties are accepted. */
    customFields: z
      .record(propertyKeySchema, payloadPathSchema)
      .refine((v) => Object.keys(v).length <= 40, {
        message: 'at most 40 custom fields',
      })
      .optional(),
    /** Where each attribution value lives in the payload; anything unmapped is looked for under its own name (`campaign`, `utm_campaign`). */
    attribution: z
      .object({
        platform: payloadPathSchema.optional(),
        campaign: payloadPathSchema.optional(),
        adset: payloadPathSchema.optional(),
        ad: payloadPathSchema.optional(),
        form: payloadPathSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type LeadFieldMapping = z.infer<typeof leadFieldMappingSchema>;

export const LEAD_OWNER_MODES = ['unassigned', 'fixed', 'round_robin'] as const;
export const leadOwnerModeSchema = z.enum(LEAD_OWNER_MODES);
export type LeadOwnerMode = z.infer<typeof leadOwnerModeSchema>;

export const leadOwnerRuleSchema = z
  .object({
    mode: leadOwnerModeSchema.default('unassigned'),
    /** The user (fixed) or the users taken in turn (round robin), as uuids. A user who is no longer active is skipped. */
    userIds: z.array(uuidSchema).max(50).default([]),
  })
  .superRefine((v, ctx) => {
    if (v.mode === 'fixed' && v.userIds.length !== 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['userIds'],
        message: 'a fixed owner is exactly one user',
      });
    }
    if (v.mode === 'round_robin' && v.userIds.length < 2) {
      ctx.addIssue({
        code: 'custom',
        path: ['userIds'],
        message: 'round robin needs at least two users',
      });
    }
    if (v.mode === 'unassigned' && v.userIds.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['userIds'],
        message: 'no users for an unassigned rule',
      });
    }
  });
export type LeadOwnerRule = z.infer<typeof leadOwnerRuleSchema>;

export const leadDealRuleSchema = z.object({
  /** Off until the admin turns it on (spec open question 11). */
  enabled: z.boolean().default(false),
  /** Omit for the workspace's default pipeline. */
  pipelineId: uuidSchema.nullish(),
  /** Omit for the pipeline's first stage. */
  stageId: uuidSchema.nullish(),
  /** `{{name}}`, `{{source}}`, `{{campaign}}` are filled from the lead. */
  title: z.string().trim().max(160).default('{{name}} ({{source}})'),
});
export type LeadDealRule = z.infer<typeof leadDealRuleSchema>;

export const leadNotifyRuleSchema = z.object({
  /** Tell the contact's owner (the person the lead was assigned to). */
  owner: z.boolean().default(true),
  /** Also tell these users (uuids), for example the sales manager. */
  userIds: z.array(uuidSchema).max(20).default([]),
});
export type LeadNotifyRule = z.infer<typeof leadNotifyRuleSchema>;

export const leadSourceDefaultsSchema = z.object({
  /** Dial code digits added to a local number ("91"). Without one a number must carry its own (`+`, `00` or 11+ digits). */
  countryCode: z
    .string()
    .trim()
    .regex(/^\+?\d{1,4}$/, 'a dial code such as 91 or +44')
    .nullish(),
  /** The platform label of this source: what `contacts.source` and the attribution say ("Facebook", "IndiaMART"). */
  platform: z.string().trim().min(1).max(60).nullish(),
  /** The stage a new contact of this source starts in. Omit for the workspace default. */
  lifecycleStage: z.string().trim().min(1).max(60).nullish(),
  /** A tag put on the contact (Reference tags every webhook lead "Lead"). `null` for none. */
  tag: z.string().trim().min(1).max(60).nullish(),
  /**
   * A flow every lead of this source is put into (Reference's "enroll the captured lead in a flow": a welcome or qualifying chat). It
   * must be one of the workspace's flows and switched on when the lead arrives; publishing is not required. A returning lead is not put
   * into it again (a contact is in a flow once). `null` for none.
   */
  flowId: uuidSchema.nullish(),
  owner: leadOwnerRuleSchema.default({ mode: 'unassigned', userIds: [] }),
  deal: leadDealRuleSchema.default({ enabled: false, title: '{{name}} ({{source}})' }),
  notify: leadNotifyRuleSchema.default({ owner: true, userIds: [] }),
  /** An automatic first message to a new lead (BL-014, L-16). Off by default. */
  speedToLead: speedToLeadSchema.default({}),
});
export type LeadSourceDefaults = z.infer<typeof leadSourceDefaultsSchema>;

export const leadSourceNameSchema = z.string().trim().min(1).max(120);
const sharedSecretSchema = z.string().min(12).max(200);

export const createLeadSourceSchema = z.object({
  name: leadSourceNameSchema,
  /** Only the webhook is created through this API today; the other kinds arrive with their own doors. */
  kind: z.literal('webhook').default('webhook'),
  /** Shown as the platform of leads that do not name one. Defaults to the source's `defaults.platform`, else "Webhook". */
  providerKey: z.string().trim().min(1).max(60).nullish(),
  /** Optional: when set, a sender must send it in the `X-Webhook-Secret` header. */
  secret: sharedSecretSchema.nullish(),
  /** Where the sender's own id for a lead lives in the payload (`lead.id`). Without it a hash of the body is the id. */
  externalIdPath: payloadPathSchema.nullish(),
  mapping: leadFieldMappingSchema.default({}),
  defaults: leadSourceDefaultsSchema.default({}),
  rawRetentionDays: z
    .number()
    .int()
    .min(1)
    .max(LEAD_RAW_RETENTION_MAX_DAYS)
    .default(LEAD_RAW_RETENTION_DEFAULT_DAYS),
});
export type CreateLeadSourceInput = z.infer<typeof createLeadSourceSchema>;

export const updateLeadSourceSchema = z.object({
  /** The optimistic lock: the `rowVersion` the editor loaded. */
  rowVersion: z.number().int().min(1),
  name: leadSourceNameSchema.optional(),
  status: leadSourceStatusSchema.optional(),
  providerKey: z.string().trim().min(1).max(60).nullish(),
  /** A string sets the secret, `null` clears it, absent keeps it. */
  secret: sharedSecretSchema.nullish(),
  externalIdPath: payloadPathSchema.nullish(),
  mapping: leadFieldMappingSchema.optional(),
  defaults: leadSourceDefaultsSchema.optional(),
  rawRetentionDays: z.number().int().min(1).max(LEAD_RAW_RETENTION_MAX_DAYS).optional(),
});
export type UpdateLeadSourceInput = z.infer<typeof updateLeadSourceSchema>;

export const leadSourceResponseSchema = z.object({
  id: uuidSchema,
  kind: leadSourceKindSchema,
  providerKey: z.string().nullable(),
  name: z.string(),
  status: leadSourceStatusSchema,
  /** The last characters of the URL token, "ends in ####". The token itself is never returned again. */
  tokenHint: z.string().nullable(),
  tokenRotatedAt: z.string().datetime().nullable(),
  /** Whether a shared secret is set. The secret is never returned. */
  hasSecret: z.boolean(),
  externalIdPath: z.string().nullable(),
  mapping: leadFieldMappingSchema,
  defaults: leadSourceDefaultsSchema,
  rawRetentionDays: z.number().int(),
  lastEventAt: z.string().datetime().nullable(),
  /** Events that are `needs_review` or `failed`: the "Needs attention" badge. */
  needsAttention: z.number().int().min(0),
  rowVersion: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type LeadSourceResponse = z.infer<typeof leadSourceResponseSchema>;

/**
 * Why the server cannot give a complete webhook address (BL-061). The address is built from the platform's configured public API
 * address (`APP_URL`); when that is missing or points at a machine the ad platforms cannot reach, the server says so instead of
 * handing out a wrong address, and the screen tells the person to ask whoever runs the platform to fix the setting.
 */
export const LEAD_HOOK_BASE_PROBLEMS = ['base_url_not_configured', 'base_url_not_public'] as const;
export const leadHookBaseProblemSchema = z.enum(LEAD_HOOK_BASE_PROBLEMS);
export type LeadHookBaseProblem = z.infer<typeof leadHookBaseProblemSchema>;

/** The public origin of the API as the server knows it. `baseUrl` is null exactly when `problem` is set. */
export const leadHookAddressSchema = z.object({
  baseUrl: z.string().nullable(),
  problem: leadHookBaseProblemSchema.nullable(),
});
export type LeadHookAddress = z.infer<typeof leadHookAddressSchema>;

export const leadSourceListResponseSchema = z.object({
  data: z.array(leadSourceResponseSchema),
  /** Whether a complete webhook address can be built at all, so the screen warns before a source is created. */
  hookAddress: leadHookAddressSchema,
});
export type LeadSourceListResponse = z.infer<typeof leadSourceListResponseSchema>;

/**
 * Create and rotate: the one time the token is shown. `hookPath` is `LEAD_HOOK_PATH_PREFIX + token`; `hookUrl` is the complete public
 * address (the configured API origin in front of it), or null with `hookUrlProblem` saying why the server could not build it.
 */
export const leadSourceSecretsResponseSchema = z.object({
  token: z.string(),
  hookPath: z.string(),
  hookUrl: z.string().nullable(),
  hookUrlProblem: leadHookBaseProblemSchema.nullable(),
});
export type LeadSourceSecretsResponse = z.infer<typeof leadSourceSecretsResponseSchema>;

export const createLeadSourceResponseSchema = leadSourceResponseSchema.merge(
  leadSourceSecretsResponseSchema,
);
export type CreateLeadSourceResponse = z.infer<typeof createLeadSourceResponseSchema>;

export const rotateLeadSourceTokenResponseSchema = leadSourceResponseSchema.merge(
  leadSourceSecretsResponseSchema,
);
export type RotateLeadSourceTokenResponse = z.infer<typeof rotateLeadSourceTokenResponseSchema>;

// --- mapping preview ----------------------------------------------------------------------------------------------------

/** A JSON object a sender could post. Bounded: it is only ever shown back and mapped, never stored by the preview. */
export const leadPayloadSchema = z
  .record(z.unknown())
  .refine((v) => JSON.stringify(v).length <= 64 * 1024, { message: 'payload is too large' });

export const previewLeadMappingSchema = z.object({
  /** An unsaved draft of the mapping; omit to preview the saved one. */
  mapping: leadFieldMappingSchema.optional(),
  defaults: leadSourceDefaultsSchema.optional(),
  externalIdPath: payloadPathSchema.nullish(),
  /** The payload to map. Omit for the last real payload the source received (and still holds). */
  payload: leadPayloadSchema.optional(),
  /** Or a specific event whose stored payload is used. */
  eventId: uuidSchema.optional(),
});
export type PreviewLeadMappingInput = z.infer<typeof previewLeadMappingSchema>;

export const leadMappingPreviewResponseSchema = z.object({
  /** Where the payload came from: the posted one, a stored event, or none (nothing received yet). */
  basedOn: z.enum(['payload', 'event', 'none']),
  eventId: uuidSchema.nullable(),
  externalId: z.string().nullable(),
  contact: z.object({
    name: z.string().nullable(),
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
    email: z.string().nullable(),
    /** What the payload said, before normalisation. */
    phoneRaw: z.string().nullable(),
    /** E.164 after the source's default country code is applied; null when it cannot be read as a number. */
    phone: z.string().nullable(),
  }),
  customFields: z.record(z.unknown()),
  attribution: z.object({
    platform: z.string().nullable(),
    campaign: z.string().nullable(),
    adset: z.string().nullable(),
    ad: z.string().nullable(),
    form: z.string().nullable(),
  }),
  /** The payload's own keys, flattened (`lead.phone`), so the mapping screen can offer them. */
  availablePaths: z.array(z.string()),
  /** `true` when the lead would be processed; otherwise `reasons` says why it would need review. */
  usable: z.boolean(),
  reasons: z.array(z.string()),
});
export type LeadMappingPreviewResponse = z.infer<typeof leadMappingPreviewResponseSchema>;

// --- test lead ----------------------------------------------------------------------------------------------------------

export const sendTestLeadSchema = z.object({
  /** Omit for a sample built from the mapping (every mapped field filled with a recognisable value). */
  payload: leadPayloadSchema.optional(),
});
export type SendTestLeadInput = z.infer<typeof sendTestLeadSchema>;
