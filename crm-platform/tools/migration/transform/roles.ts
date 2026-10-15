import { mapPermissions } from '../access/policy';
import { docKeys, isDeleted, type Doc } from '../util';
import { c, times, TS_COLS } from './common';
import type { Ctx, HandlerSpec, Outcome, Soft } from './types';

const ROLE_FIELDS = {
  _id: 'id',
  id: 'id (registered in id_map: users reference a role by this string)',
  name: 'col:name (label wins; collisions with a preset name or another role are renamed)',
  label: 'col:name',
  created_time: 'col:created_at',
  modified_time: 'col:updated_at',
  is_deleted: 'drop:soft-delete flag; deleted roles are excluded and counted',
  deleted_time: 'drop:soft-delete timestamp',
  permission_config:
    'derived:role_grants (only through the REVIEWED permission map; an unmapped permission grants nothing)',
  menu_items:
    'drop:sidebar layout of the old app (8 arrays, ~27 KB per role); the new menu is derived from grants and plan. Kept in the archive',
};

/** Waboo roles. A role the role-map points at a preset adopts that preset row; every other role becomes a custom role. */
export const roles: HandlerSpec = {
  handler: 'roles',
  collection: 'roles',
  mapCollection: 'roles',
  fields: ROLE_FIELDS,
  tables: {
    roles: {
      columns: [c('name', 'text'), ...TS_COLS],
      fp: ['name'],
      // never a system_key, never locked: only the five presets are either
      constants: { system_key: null, is_locked: false, row_version: 1 },
    },
    role_grants: {
      keyless: { parent: 'roles', parentCol: 'role_id' },
      columns: [
        c('role_id', 'bigint'),
        c('permission_key', 'text'),
        c('effect', 'perm_effect'),
        c('record_scope', 'record_scope'),
      ],
    },
  },
  transform(doc: Doc, ctx: Ctx): Outcome {
    if (isDeleted(doc))
      return { kind: 'exclude', code: 'SOFT_DELETED', reason: 'is_deleted or deleted_time is set' };
    const acc = ctx.access;
    const plan = acc?.roles.get(docKeys(doc)[0]!.key);
    if (!acc || !plan)
      return {
        kind: 'quarantine',
        code: 'ACCESS_NOT_READY',
        reason: 'no role plan for this document',
      };

    if (plan.target !== 'custom') {
      // the preset's own grants apply; the approver in role-map.json answers for them
      return { kind: 'adopt', table: 'roles', column: 'system_key', value: plan.target };
    }

    const soft: Soft[] = [];
    const t = times(doc, ctx.fallbackAt);
    soft.push(...t.soft);
    if (plan.noName)
      soft.push({
        code: 'ROLE_NAME_MISSING',
        reason: 'the role has no name or label; it is named after its id',
      });
    if (plan.renamedFrom)
      soft.push({
        code: 'ROLE_NAME_COLLISION',
        reason: 'the name equals a preset role or another role; it was renamed',
        detail: { from: plan.renamedFrom, to: plan.name },
      });
    const res = mapPermissions({
      permissionConfig: doc.permission_config,
      map: acc.config.permissionMap,
      defs: acc.defs,
      featureOpen: acc.featureOpen,
      allowAdminClass: Boolean(plan.entry?.allowAdminClass && plan.entry.approvedBy),
    });
    if (res.unmapped.length)
      soft.push({
        code: 'PERM_UNMAPPED',
        reason: 'accessible in Waboo but not mapped (or not reviewed yet): grants nothing',
        detail: {
          count: res.unmapped.length,
          permissions: res.unmapped,
          unreviewed: res.unreviewed,
        },
      });
    if (res.unknownKeys.length)
      soft.push({
        code: 'PERM_KEY_UNKNOWN',
        reason: 'the permission map names a key that permission_defs does not have',
        detail: res.unknownKeys,
      });
    if (res.planLocked.length)
      soft.push({
        code: 'PERM_PLAN_LOCKED',
        reason: 'the key belongs to a plan feature or app this organization does not have',
        detail: res.planLocked,
      });
    if (res.adminWithheld.length)
      soft.push({
        code: 'PERM_ADMIN_CLASS_WITHHELD',
        reason:
          'admin-class keys are only granted with allowAdminClass and an approver in role-map.json',
        detail: res.adminWithheld,
      });
    return {
      kind: 'rows',
      soft,
      rows: [
        {
          table: 'roles',
          sub: '',
          row: { name: plan.name, created_at: t.created, updated_at: t.updated },
        },
        ...res.grants.map((g) => ({
          table: 'role_grants',
          sub: `#grant:${g.key}`,
          row: { permission_key: g.key, effect: 'allow', record_scope: g.scope },
        })),
      ],
    };
  },
};
