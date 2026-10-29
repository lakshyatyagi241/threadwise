import type { SQL } from 'drizzle-orm';
import { creatorLimit, creatorScopeSql } from '../../common/record-scope/creator-scope';

/**
 * Record scope of a template key (BL-430): "Global" (`all`) sees every template of the workspace, "Restricted" (`own`) only the
 * ones its own user created (`wa_templates.user_id`; a template imported by a sync belongs to whoever ran the sync). A team
 * scope is narrower than global and a template has no team, so it reads as restricted. A caller with no grant map (a worker) is
 * not narrowed. `tpl.templates.create` is the key that edits a template, so its scope is the edit scope.
 */
export type TemplateScopeKey =
  'tpl.templates.read' | 'tpl.templates.create' | 'tpl.templates.delete' | 'tpl.templates.sync';

/** The creator the caller is limited to under this key, or null when the caller sees every template. */
export function templateCreatorLimit(key: TemplateScopeKey): number | null {
  return creatorLimit(key);
}

/** `AND t.user_id = me` for a restricted caller, nothing for a global one. */
export function templateScopeSql(key: TemplateScopeKey, alias = 't'): SQL {
  return creatorScopeSql(key, alias, 'user_id');
}
