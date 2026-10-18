import { z } from 'zod';
import { localeCodeSchema } from '../localization-translation/locale';
import { nounFormsSchema } from './definition';

/**
 * Dynamic object naming ("P5-lite", backlog BL-310; docs/specs/persona-profiles.md, sections 7.4 and 8.2): a workspace may call a contact a
 * Patient, Client, Lead or Member, an appointment a Visit, a deal an Admission. It is a LABEL overlay on the web UI. The API, the data
 * model, the public API, webhooks, exports and the CSV headers keep the canonical names; nothing here renames a concept.
 *
 * The persona and operator layers already carry nouns (`personaDefinitionSchema.vocabulary.nouns`, `operatorOverridesSchema.vocab`); this file
 * is the workspace's own layer: what its admin may type in Settings, and the two routes that read and write it.
 */

/**
 * The nouns a workspace admin can rename from Settings. A subset of `PERSONA_NOUNS`: the ones the web has bound message keys for (the
 * others can still arrive from a persona or the operator, they just have nothing to change until their keys are bound).
 */
export const WORKSPACE_VOCAB_NOUNS = ['contact', 'appointment', 'deal', 'meeting'] as const;
export type WorkspaceVocabNoun = (typeof WORKSPACE_VOCAB_NOUNS)[number];
export const workspaceVocabNounSchema = z.enum(WORKSPACE_VOCAB_NOUNS);

/**
 * What a noun may contain. The text is dropped into translated messages that are parsed as ICU MessageFormat, so the characters that
 * mean something there (`{ } < > #`) and anything that could smuggle markup or a backslash escape are refused. Letters of any script,
 * marks, digits, spaces and a few joiners (`- ’ . & / ( )`) are enough for every real noun. An ASCII apostrophe is allowed only inside a
 * word (it starts a quote in ICU when it touches a brace). Rendered as plain text, never as HTML.
 */
export const MAX_NOUN_LENGTH = 40;
const NOUN_CHARS = /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} \-’.&/()']*$/u;
const LOOSE_APOSTROPHE = /(?<![\p{L}\p{N}])'|'(?![\p{L}\p{M}\p{N}])/u;

export function isSafeNoun(value: string): boolean {
  if (value.length < 1 || value.length > MAX_NOUN_LENGTH) return false;
  if (!NOUN_CHARS.test(value)) return false;
  if (LOOSE_APOSTROPHE.test(value)) return false;
  return !/[ \-&/(]$/.test(value);
}

const nounText = z
  .string()
  .trim()
  .min(1, 'a name is required')
  .max(MAX_NOUN_LENGTH, `at most ${MAX_NOUN_LENGTH} characters`)
  .refine(isSafeNoun, 'letters, numbers, spaces and - . & / ( ) only');

/** One noun in one language: the singular ("Patient") and the plural ("Patients"). Both are needed. */
export const workspaceNounFormsSchema = z.object({ one: nounText, other: nounText });
export type WorkspaceNounForms = z.infer<typeof workspaceNounFormsSchema>;

/** Where the wording a person sees for a noun comes from. `default` = the product's own word. */
export const vocabSourceSchema = z.enum(['workspace', 'operator', 'persona', 'default']);
export type VocabSource = z.infer<typeof vocabSourceSchema>;

export const vocabNounRowSchema = z.object({
  noun: workspaceVocabNounSchema,
  /**
   * What is shown now in the asked language (the winning layer), or `null` for the product's own wording. The product's own words are
   * not sent: the web has them in its messages (`vocab.defaults`).
   */
  effective: nounFormsSchema.nullable(),
  source: vocabSourceSchema,
  /** The workspace's OWN override in the asked language, if any. */
  workspace: nounFormsSchema.nullable(),
  /** The languages in which the workspace has set its own wording for this noun. */
  workspaceLocales: z.array(localeCodeSchema),
});
export type VocabNounRow = z.infer<typeof vocabNounRowSchema>;

/** `GET /v2/persona/vocabulary?locale=hi` */
export const workspaceVocabularyResponseSchema = z.object({
  locale: localeCodeSchema,
  /** The workspace persona's `rev`: send it back on save (a stale value is a 409). */
  rev: z.number().int().positive(),
  personaKey: z.string(),
  nouns: z.array(vocabNounRowSchema),
});
export type WorkspaceVocabularyResponse = z.infer<typeof workspaceVocabularyResponseSchema>;

/**
 * `PUT /v2/persona/vocabulary`. Per noun:
 *  - a map of languages: each `{ one, other }` sets that language, each `null` removes that language; the languages not named are kept;
 *  - `null`: removes every language of that noun (back to the business type's or the product's wording);
 *  - a noun left out is not touched.
 */
export const saveWorkspaceVocabularySchema = z.object({
  rev: z.number().int().positive(),
  nouns: z
    .record(
      workspaceVocabNounSchema,
      z.union([z.null(), z.record(localeCodeSchema, workspaceNounFormsSchema.nullable())]),
    )
    .refine((v) => Object.keys(v).length > 0, 'nothing to save'),
});
export type SaveWorkspaceVocabularyInput = z.infer<typeof saveWorkspaceVocabularySchema>;
