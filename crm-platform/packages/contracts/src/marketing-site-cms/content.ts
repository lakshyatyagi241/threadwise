import { z } from 'zod';
import { CMS_PAGES, CMS_SCOPES } from './registry';

/**
 * The editable content store (TW-CMS-008, 018..026, 028). One row per key; a row carries the draft the editor works on
 * and the published value visitors read. `null` means "no value", an empty string means "use the shipped default".
 */

export const cmsEntryTypeSchema = z.enum(['text', 'longtext', 'richtext', 'link', 'color', 'json']);

export const cmsEntrySchema = z.object({
  key: z.string(),
  type: cmsEntryTypeSchema,
  draft: z.string().nullable(),
  published: z.string().nullable(),
  rowVersion: z.number().int(),
});
export type CmsEntry = z.infer<typeof cmsEntrySchema>;

/** Everything the editor needs in one read: every stored row, how many have unpublished changes, the homepage switch. */
export const operatorContentResponseSchema = z.object({
  entries: z.array(cmsEntrySchema),
  pending: z.number().int().nonnegative(),
  homepageEnabled: z.boolean(),
});
export type OperatorContentResponse = z.infer<typeof operatorContentResponseSchema>;

/** What a visitor's page needs: published values only, empty values already dropped, layout arrays parsed. */
export const publicContentResponseSchema = z.object({
  values: z.record(z.string()),
  hidden: z.record(z.array(z.string())),
  order: z.record(z.array(z.string())),
  homepageEnabled: z.boolean(),
  brandName: z.string(),
});
export type PublicContentResponse = z.infer<typeof publicContentResponseSchema>;

export const saveDraftRequestSchema = z.object({
  entries: z
    .array(
      z.object({
        key: z.string().min(1).max(191),
        value: z.string().max(20_000),
        /** When given, the save is refused (409) if the row moved since the editor read it. */
        rowVersion: z.number().int().positive().optional(),
      }),
    )
    .min(1)
    .max(200),
});
export type SaveDraftRequest = z.infer<typeof saveDraftRequestSchema>;

export const saveDraftResponseSchema = z.object({ entries: z.array(cmsEntrySchema) });
export type SaveDraftResponse = z.infer<typeof saveDraftResponseSchema>;

/** Hide and reorder (TW-CMS-022/023). At least one of the two arrays. */
export const saveLayoutRequestSchema = z
  .object({
    page: z.enum(CMS_PAGES),
    hidden: z.array(z.string().max(64)).max(50).optional(),
    order: z.array(z.string().max(64)).max(50).optional(),
  })
  .refine((v) => v.hidden !== undefined || v.order !== undefined, {
    message: 'Send hidden, order or both',
  });
export type SaveLayoutRequest = z.infer<typeof saveLayoutRequestSchema>;

export const saveLayoutResponseSchema = z.object({
  hidden: z.array(z.string()),
  order: z.array(z.string()),
});
export type SaveLayoutResponse = z.infer<typeof saveLayoutResponseSchema>;

export const scopeRequestSchema = z.object({ scope: z.enum(CMS_SCOPES).default('all') });
export type ScopeRequest = z.infer<typeof scopeRequestSchema>;

export const countResponseSchema = z.object({ count: z.number().int().nonnegative() });
export type CountResponse = z.infer<typeof countResponseSchema>;

/** Reset one key, or a whole scope. Drafts only: nothing changes for visitors until Publish. */
export const resetRequestSchema = z
  .object({
    key: z.string().min(1).max(191).optional(),
    scope: z.enum(CMS_SCOPES).optional(),
  })
  .refine((v) => (v.key === undefined) !== (v.scope === undefined), {
    message: 'Send either key or scope',
  });
export type ResetRequest = z.infer<typeof resetRequestSchema>;

export const applyPresetRequestSchema = z.object({ preset: z.string().min(1).max(32) });
export type ApplyPresetRequest = z.infer<typeof applyPresetRequestSchema>;

export const homepageSwitchRequestSchema = z.object({ enabled: z.boolean() });
export type HomepageSwitchRequest = z.infer<typeof homepageSwitchRequestSchema>;
export const homepageSwitchResponseSchema = z.object({ enabled: z.boolean() });
export type HomepageSwitchResponse = z.infer<typeof homepageSwitchResponseSchema>;

/** The editor's image upload (TW-CMS-027): at most 4 MB, as Reference's `max:4096`. */
export const CMS_UPLOAD_MAX_BYTES = 4096 * 1024;
export const cmsUploadKeySchema = z
  .string()
  .max(191)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/i);
export const cmsUploadResponseSchema = z.object({ ok: z.literal(true), url: z.string() });
export type CmsUploadResponse = z.infer<typeof cmsUploadResponseSchema>;
