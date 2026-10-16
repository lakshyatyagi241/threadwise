import { and, eq, inArray } from 'drizzle-orm';
import { schema, type Tx } from '@crm/db';
import { fieldTypeSchema, type FieldType } from '@crm/contracts';
import { emptyRuleContext, type RuleContext, type RuleRefs } from './segment-compiler';

const { fields, statusOptions, tags, contactGroups, users } = schema;

/**
 * Looks up, in one batch, everything a set of rule trees points at. A uuid or value missing from the
 * result is a reference that was deleted (or never existed in this workspace: the same answer, so a
 * rule cannot probe another tenant's ids).
 */
export async function loadRuleContext(tx: Tx, orgId: number, refs: RuleRefs): Promise<RuleContext> {
  const rc = emptyRuleContext();

  if (refs.tagUuids.size > 0) {
    const rows = await tx
      .select({ id: tags.id, uuid: tags.uuid })
      .from(tags)
      .where(and(eq(tags.orgId, orgId), inArray(tags.uuid, [...refs.tagUuids])));
    for (const r of rows) rc.tags.set(r.uuid, r.id);
  }
  if (refs.groupUuids.size > 0) {
    const rows = await tx
      .select({ id: contactGroups.id, uuid: contactGroups.uuid })
      .from(contactGroups)
      .where(
        and(eq(contactGroups.orgId, orgId), inArray(contactGroups.uuid, [...refs.groupUuids])),
      );
    for (const r of rows) rc.groups.set(r.uuid, r.id);
  }
  if (refs.userUuids.size > 0) {
    const rows = await tx
      .select({ id: users.id, uuid: users.uuid })
      .from(users)
      .where(and(eq(users.orgId, orgId), inArray(users.uuid, [...refs.userUuids])));
    for (const r of rows) rc.users.set(r.uuid, r.id);
  }
  if (refs.stageValues.size > 0) {
    const rows = await tx
      .select({ value: statusOptions.value })
      .from(statusOptions)
      .where(
        and(
          eq(statusOptions.orgId, orgId),
          eq(statusOptions.moduleKey, 'contacts'),
          eq(statusOptions.optionGroup, 'lifecycle_stage'),
          inArray(statusOptions.value, [...refs.stageValues]),
        ),
      );
    for (const r of rows) rc.stages.add(r.value);
  }
  if (refs.statusValues.size > 0) {
    const rows = await tx
      .select({ value: statusOptions.value })
      .from(statusOptions)
      .where(
        and(
          eq(statusOptions.orgId, orgId),
          eq(statusOptions.moduleKey, 'contacts'),
          inArray(statusOptions.optionGroup, ['status', 'contact_status']),
          inArray(statusOptions.value, [...refs.statusValues]),
        ),
      );
    for (const r of rows) rc.statuses.add(r.value);
  }
  if (refs.fieldKeys.size > 0) {
    // A deleted property is deactivated, not removed (contacts.data still has the key): inactive = gone for a rule.
    const rows = await tx
      .select({ key: fields.key, type: fields.fieldType })
      .from(fields)
      .where(
        and(
          eq(fields.orgId, orgId),
          eq(fields.moduleKey, 'contacts'),
          eq(fields.isActive, true),
          inArray(fields.key, [...refs.fieldKeys]),
        ),
      );
    for (const r of rows) {
      const type = fieldTypeSchema.safeParse(r.type);
      if (type.success) rc.fields.set(r.key, { type: type.data as FieldType });
    }
  }
  if (refs.companyFieldKeys.size > 0) {
    // The same rule for company properties: deactivated = gone.
    const rows = await tx
      .select({ key: fields.key, type: fields.fieldType })
      .from(fields)
      .where(
        and(
          eq(fields.orgId, orgId),
          eq(fields.moduleKey, 'companies'),
          eq(fields.isActive, true),
          inArray(fields.key, [...refs.companyFieldKeys]),
        ),
      );
    for (const r of rows) {
      const type = fieldTypeSchema.safeParse(r.type);
      if (type.success) rc.companyFields.set(r.key, { type: type.data as FieldType });
    }
  }
  return rc;
}
