import { z } from 'zod';
import { localeCodeSchema } from '../localization-translation/locale';
import { nounFormsSchema, personaNounSchema } from './definition';
import { moduleIdSchema, visibilitySchema, withinModuleLimit } from './module-ids';

/**
 * The two override layers on top of a persona (docs/specs/persona-profiles.md, section 4.4): `operator_overrides` (the platform admin,
 * for one workspace) and `workspace_overrides` (the workspace admin). Both are stored as `{ v: 1, ... }` documents. They share one shape,
 * except that only the operator may lock an item and the operator must always say why.
 */

const addonSlug = z.string().regex(/^[a-z][a-z0-9-]{1,63}$/);
const presetKey = z.string().regex(/^[a-z][a-z0-9-]{1,63}$/);

const moduleEntryBase = {
  state: visibilitySchema,
  reason: z.string().trim().min(5).max(280),
};

/** An operator decision on one module. `locked` makes it win over the workspace layer and over "Show more modules". */
export const operatorModuleOverrideSchema = z
  .object({ ...moduleEntryBase, locked: z.boolean().default(false) })
  .strict();
/** A workspace decision. It carries no `locked`: a workspace cannot lock itself. */
export const workspaceModuleOverrideSchema = z
  .object({ ...moduleEntryBase, reason: moduleEntryBase.reason.optional() })
  .strict();

const overrideBody = {
  v: z.literal(1),
  vocab: z.record(z.string(), z.record(localeCodeSchema, nounFormsSchema)).default({}),
  addons: z.record(addonSlug, z.enum(['suggest', 'unsuggest'])).default({}),
  presets: z.record(presetKey, z.enum(['include', 'exclude'])).default({}),
  settings: z.record(z.string().min(1).max(64), z.unknown()).default({}),
};

const nounKeysOnly = (value: Record<string, unknown>, ctx: z.RefinementCtx) => {
  for (const key of Object.keys(value)) {
    if (!personaNounSchema.safeParse(key).success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['vocab', key],
        message: 'not a persona noun',
      });
    }
  }
};

export const operatorOverridesSchema = z
  .object({
    ...overrideBody,
    modules: z
      .record(moduleIdSchema, operatorModuleOverrideSchema)
      .refine(withinModuleLimit, 'too many module ids')
      .default({}),
  })
  .superRefine((v, ctx) => nounKeysOnly(v.vocab, ctx));
export type OperatorOverrides = z.infer<typeof operatorOverridesSchema>;

export const workspaceOverridesSchema = z
  .object({
    ...overrideBody,
    modules: z
      .record(moduleIdSchema, workspaceModuleOverrideSchema)
      .refine(withinModuleLimit, 'too many module ids')
      .default({}),
  })
  .superRefine((v, ctx) => nounKeysOnly(v.vocab, ctx));
export type WorkspaceOverrides = z.infer<typeof workspaceOverridesSchema>;

/** What a row holds before anyone overrides anything: the column default `'{}'` also parses to this. */
export const EMPTY_OVERRIDES = {
  v: 1,
  modules: {},
  vocab: {},
  addons: {},
  presets: {},
  settings: {},
} as const;

/**
 * Reads a stored overrides document. A document that fails the schema (written by a newer or a buggy writer) is treated as empty,
 * never as an error: the layer is silent and the workspace keeps seeing the persona (spec section 7.3, "unknown means show everything").
 */
export function parseOperatorOverrides(raw: unknown): OperatorOverrides {
  const parsed = operatorOverridesSchema.safeParse(isEmptyDocument(raw) ? EMPTY_OVERRIDES : raw);
  return parsed.success ? parsed.data : operatorOverridesSchema.parse(EMPTY_OVERRIDES);
}
export function parseWorkspaceOverrides(raw: unknown): WorkspaceOverrides {
  const parsed = workspaceOverridesSchema.safeParse(isEmptyDocument(raw) ? EMPTY_OVERRIDES : raw);
  return parsed.success ? parsed.data : workspaceOverridesSchema.parse(EMPTY_OVERRIDES);
}

/** The column default is `{}` (no `v`), which means "nothing set". */
function isEmptyDocument(raw: unknown): boolean {
  return (
    raw === null ||
    raw === undefined ||
    (typeof raw === 'object' && Object.keys(raw as object).length === 0)
  );
}
