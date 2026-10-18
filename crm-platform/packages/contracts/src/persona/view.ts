import { z } from 'zod';
import { localeCodeSchema } from '../localization-translation/locale';
import { moduleIdSchema, visibilitySchema } from './module-ids';

/**
 * What the API tells the web about a workspace's persona: `org.persona` of `GET /v2/auth/session` (docs/specs/persona-profiles.md,
 * sections 7.1 and 7.3). Additive and optional: a session without it (or a client that ignores it) shows everything, which is what the
 * `generic` persona resolves to anyway.
 *
 * It carries the DECISION, never the layers: no operator note, no reason, no source. A workspace may learn that an item is "set by
 * your account team" (`locked`), nothing more (owner decision 10).
 */
/**
 * Not imported from `definition.ts` on purpose: `definition.ts` reads `session.ts`, and `session.ts` embeds this view, so importing it
 * here would close a cycle (the schema would be `undefined` when `sessionOrgSchema` is built).
 */
const viewNounForms = z.object({
  one: z.string().min(1).max(40),
  other: z.string().min(1).max(40),
});

export const personaViewSchema = z.object({
  key: z.string(),
  /** The persona version this view was resolved from (the one the workspace follows, or is pinned to). */
  version: z.number().int().positive(),
  /** Bumped by every change to the workspace's persona row: the cache key. */
  rev: z.number().int().positive(),
  /** One-seat simplification. In phase 0 this is only an explicit "on"; the seat count that drives `auto` arrives with onboarding. */
  solo: z.boolean(),
  /** The workspace turned on "Show more modules". */
  showAll: z.boolean(),
  /** What every module not in `modules` is. */
  defaultVisibility: visibilitySchema,
  /** The ids whose decision differs from `defaultVisibility`, or that the operator locked. */
  modules: z.record(moduleIdSchema, z.object({ visible: z.boolean(), locked: z.boolean() })),
  /**
   * Dynamic object naming (BL-310): the words the workspace uses instead of the product's, per language then per noun
   * (`{ en: { contact: { one: 'Patient', other: 'Patients' } } }`), already merged `workspace > operator > persona`. Left out when no
   * language has any, which is what the web reads as "the product's own wording". A label overlay only: no API field or enum is renamed.
   */
  nouns: z.record(localeCodeSchema, z.record(z.string(), viewNounForms)).optional(),
});
export type PersonaView = z.infer<typeof personaViewSchema>;
