import type { ModuleKey } from '@crm/contracts';

/**
 * moduleKey -> permission-key segment for the field-metadata registry
 * (field_sections, fields, field_options, field_dependencies,
 * status_options). One registry, two permission surfaces — a grant to
 * contact-properties must not also unlock company-properties, or vice versa.
 *
 * These keys are built from this template, not written as literal strings —
 * adr-compliance-review's scan.sh greps for literal
 * `@RequirePermission('record.x.y')` calls to catch a permission key with no
 * matching `permission_defs` migration, and can't see a key assembled at
 * runtime. Checked by hand instead: `record.contact-properties.*` is
 * 0011_add_contact_properties_permissions.sql,
 * `record.company-properties.*` is 0018_add_company_properties_permissions.sql.
 * If a third moduleKey is ever added here, its migration is on you to add too
 * — the scanner won't remind you.
 */
const MODULE_PROPERTY_PERMISSION: Record<ModuleKey, string> = {
  contacts: 'contact-properties',
  companies: 'company-properties',
};

export type PropertyAction = 'read' | 'create' | 'update' | 'delete';

export function propertyPermissionKey(moduleKey: ModuleKey, action: PropertyAction): string {
  return `record.${MODULE_PROPERTY_PERMISSION[moduleKey]}.${action}`;
}

/**
 * Every moduleKey's key for one action — the coarse, route-level gate
 * (@RequirePermission is static metadata and can't see the request body, so
 * it can only check "has SOME properties permission for this action"). The
 * precise per-moduleKey check happens in the service, against the row's
 * actual moduleKey, via propertyPermissionKey() + RbacService.can().
 */
export function anyPropertyPermission(action: PropertyAction): string[] {
  return (Object.keys(MODULE_PROPERTY_PERMISSION) as ModuleKey[]).map((moduleKey) =>
    propertyPermissionKey(moduleKey, action),
  );
}
