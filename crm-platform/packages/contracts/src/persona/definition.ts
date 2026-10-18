import { z } from 'zod';
import { industrySchema, teamSizeSchema } from '../auth-registration-security/session';
import { localeCodeSchema } from '../localization-translation/locale';
import { moduleIdSchema, visibilitySchema, withinModuleLimit } from './module-ids';

/**
 * A persona definition: the JSON stored in `persona_versions.definition` (docs/specs/persona-profiles.md, section 4.3). One published
 * version is immutable; editing happens on one draft per persona and publishing makes version N+1.
 */

export const PERSONA_KEY_PATTERN = /^[a-z][a-z0-9_]{1,39}$/;
/** The persona every workspace has until it picks another: it shows exactly what the product shows today. */
export const GENERIC_PERSONA_KEY = 'generic';
export const personaKeySchema = z
  .string()
  .regex(
    PERSONA_KEY_PATTERN,
    'a persona key is 2-40 characters: a-z, 0-9, underscore, starting with a letter',
  );

/** Visible text from a persona or an override: rendered as plain text, so only the length is limited. */
const text = (max: number) => z.string().trim().min(1).max(max);

/** A text per locale. */
const perLocale = (max: number) => z.record(localeCodeSchema, text(max));

/** The nouns a persona may rename. A fixed list: a bound message key exists for each (spec section 7.4). */
export const PERSONA_NOUNS = [
  'contact',
  'deal',
  'appointment',
  'meeting',
  'company',
  'task',
  'pipeline',
  'lifecycleStage',
  'bookingType',
  'segment',
  'campaign',
] as const;
export type PersonaNoun = (typeof PERSONA_NOUNS)[number];
export const personaNounSchema = z.enum(PERSONA_NOUNS);

/** One noun in one locale: singular and plural. Both are needed for the locale to count as complete. */
export const nounFormsSchema = z.object({ one: text(40), other: text(40) });
export type NounForms = z.infer<typeof nounFormsSchema>;

/** noun -> locale -> forms. */
export const nounsSchema = z
  .record(z.string(), z.record(localeCodeSchema, nounFormsSchema))
  .superRefine((value, ctx) => {
    for (const key of Object.keys(value)) {
      if (!personaNounSchema.safeParse(key).success) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: 'not a persona noun' });
      }
    }
  });
export type PersonaNouns = z.infer<typeof nounsSchema>;

/** A message key bound to a phrase authored per locale ("Add patient"). */
const phraseKeySchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/);
export const phrasesSchema = z.record(phraseKeySchema, perLocale(120));
export type PersonaPhrases = z.infer<typeof phrasesSchema>;

export const personaModulesSchema = z.object({
  /** `show`: a module added to the product later appears (deny-list persona). `hide`: allow-list persona (clinics). */
  default: visibilitySchema,
  /** Explicit decisions. A module not listed follows `default`. */
  ids: z.record(moduleIdSchema, visibilitySchema).refine(withinModuleLimit, 'too many module ids'),
});
export type PersonaModules = z.infer<typeof personaModulesSchema>;

const presetKey = z.string().regex(/^[a-z][a-z0-9-]{1,63}$/);
const presetName = perLocale(80);

export const personaPresetsSchema = z.object({
  /** Marketplace listing slugs the persona suggests. Suggest only, it never activates anything. */
  addons: z
    .array(z.object({ slug: presetKey, level: z.enum(['required', 'suggested']) }))
    .max(20)
    .default([]),
  bookingTypes: z
    .array(
      z.object({
        key: presetKey,
        name: presetName,
        kind: z.enum(['appointment', 'meeting']),
        durationMinutes: z.number().int().min(5).max(1440),
        location: z.enum(['address', 'phone', 'virtual']),
      }),
    )
    .max(20)
    .default([]),
  lifecycleStages: z
    .array(
      z.object({ key: presetKey, name: presetName, color: z.string().regex(/^#[0-9a-fA-F]{6}$/) }),
    )
    .max(20)
    .default([]),
  pipelines: z
    .array(
      z.object({
        key: presetKey,
        name: presetName,
        stages: z.array(z.object({ key: presetKey, name: presetName })).max(20),
      }),
    )
    .max(10)
    .default([]),
  /** Always created as DRAFTS: the Meta approval of a WhatsApp template is a separate, human step. */
  templates: z
    .array(
      z.object({
        key: presetKey,
        channel: z.enum(['whatsapp', 'email', 'sms']),
        event: z.string().min(1).max(40),
        category: z.enum(['utility', 'marketing', 'authentication']),
        body: perLocale(1024),
      }),
    )
    .max(30)
    .default([]),
  /** A few typed workspace settings the persona starts with. The allow-list of keys is enforced at publish (phase 2). */
  settings: z.record(z.string().min(1).max(64), z.unknown()).default({}),
});
export type PersonaPresets = z.infer<typeof personaPresetsSchema>;

export const checklistStepSchema = z.object({
  key: presetKey,
  /** The screen the step opens; shown only while that module is visible. */
  moduleId: moduleIdSchema.optional(),
});

export const personaDefinitionSchema = z.object({
  schemaVersion: z.literal(1),
  /** `en` is required, the other locales are optional. */
  label: perLocale(60).refine((v) => v.en !== undefined, { message: 'en is required' }),
  summary: perLocale(160).refine((v) => v.en !== undefined, { message: 'en is required' }),
  icon: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
  /** Mirrors `organizations.settings.industry` for the analytics that read it. */
  industryHint: industrySchema.optional(),
  /** Team sizes offered at onboarding; the others stay selectable. */
  teamSizes: z.array(teamSizeSchema).max(5).default([]),
  vocabulary: z.object({ nouns: nounsSchema.default({}), phrases: phrasesSchema.default({}) }),
  modules: personaModulesSchema,
  presets: personaPresetsSchema,
  checklist: z.array(checklistStepSchema).max(12).default([]),
});
export type PersonaDefinition = z.infer<typeof personaDefinitionSchema>;

/**
 * The `generic` persona, version 1: today's product, byte for byte. Every module shown, today's wording, no presets, no checklist.
 * The migration seeds exactly this document (a test compares the two), and the resolver treats an unknown or missing persona as this.
 */
export const GENERIC_PERSONA_DEFINITION: PersonaDefinition = {
  schemaVersion: 1,
  label: { en: 'Generic' },
  summary: { en: 'Everything, with the wording the product uses today.' },
  icon: 'layers',
  teamSizes: [],
  vocabulary: { nouns: {}, phrases: {} },
  modules: { default: 'show', ids: {} },
  presets: {
    addons: [],
    bookingTypes: [],
    lifecycleStages: [],
    pipelines: [],
    templates: [],
    settings: {},
  },
  checklist: [],
};
