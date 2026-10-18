import { z } from 'zod';

/**
 * Persona profiles (docs/specs/persona-profiles.md, section 3): a module id is a stable string for something a workspace can see or
 * not see. Five kinds, the same convention the Help center uses to say which screens a guide documents:
 *
 *   nav:<id>                    a menu entry (`features/<domain>/nav.ts`)
 *   tile:<id>                   a Settings tile (`features/<domain>/settings.ts`)
 *   section:contact.<id>        a tab of the contact page
 *   card:dashboard.<id>         a card of the dashboard
 *   action:contact.<id>         a button of the contact action bar
 *
 * The ids of the first two come from the registries themselves, so adding a screen adds its id with no second list to keep. The
 * catalog that lists every id the app has is generated in the web app (`scripts/gen-registry.mjs`); this file only fixes the shape.
 * A persona never lists an id that is not in the catalog (checked at publish and by a test), and the resolver ignores an unknown id
 * instead of throwing, so a renamed screen cannot break a workspace.
 */
export const MODULE_KINDS = ['nav', 'tile', 'section', 'card', 'action'] as const;
export type ModuleKind = (typeof MODULE_KINDS)[number];
export const moduleKindSchema = z.enum(MODULE_KINDS);

/** Kinds whose name is `<area>.<name>` rather than a bare registry id, and the one area each has today. */
export const MODULE_AREAS: Readonly<Partial<Record<ModuleKind, string>>> = {
  section: 'contact',
  card: 'dashboard',
  action: 'contact',
};

const NAME = '[a-z0-9][a-z0-9-]{0,63}';
const MODULE_ID = new RegExp(`^(?:(?:nav|tile):${NAME}|(?:section|card|action):[a-z]+\\.${NAME})$`);

/** `nav:inbox`, `tile:booking-types`, `section:contact.meetings`, `card:dashboard.inbox`, `action:contact.meeting`. */
export const moduleIdSchema = z
  .string()
  .max(96)
  .regex(MODULE_ID, 'not a module id (kind:name, for example nav:inbox)')
  .refine(
    (id) => {
      const kind = id.slice(0, id.indexOf(':')) as ModuleKind;
      const area = MODULE_AREAS[kind];
      return area === undefined || id.startsWith(`${kind}:${area}.`);
    },
    { message: 'unknown area for this module kind' },
  );
export type ModuleId = string;

/** `moduleId('nav', 'inbox')` is `nav:inbox`; `moduleId('section', 'meetings')` is `section:contact.meetings`. */
export function moduleId(kind: ModuleKind, name: string): ModuleId {
  const area = MODULE_AREAS[kind];
  return area ? `${kind}:${area}.${name}` : `${kind}:${name}`;
}

/** The kind of a well-formed id, or null. */
export function moduleKindOf(id: string): ModuleKind | null {
  const kind = id.slice(0, Math.max(0, id.indexOf(':')));
  return (MODULE_KINDS as readonly string[]).includes(kind) ? (kind as ModuleKind) : null;
}

/**
 * The most module ids one document may name. The catalog has a few hundred; a larger map is a mistake or an attack, and the view that
 * rides on every session carries these ids, so the size is bounded where the document is read.
 */
export const MAX_MODULE_ENTRIES = 600;
export const withinModuleLimit = (value: Record<string, unknown>): boolean =>
  Object.keys(value).length <= MAX_MODULE_ENTRIES;

/** What a persona or an override says about a module. Silence (no entry) is "inherit". */
export const visibilitySchema = z.enum(['show', 'hide']);
export type Visibility = z.infer<typeof visibilitySchema>;

/** One line of the generated catalog: an id the app has and where it comes from (for the console's module tree). */
export const moduleCatalogEntrySchema = z.object({
  id: moduleIdSchema,
  kind: moduleKindSchema,
  /** Menu group, Settings section, or the contact/dashboard area: how the console groups the tree. */
  group: z.string(),
  /** `planned` = listed as "coming soon" in the menu or Settings; a persona may already mention it. */
  planned: z.boolean(),
});
export type ModuleCatalogEntry = z.infer<typeof moduleCatalogEntrySchema>;
