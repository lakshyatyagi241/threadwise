import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { schema, type Tx } from '@crm/db';

const { contacts } = schema;

/**
 * The lifecycle stage and status values contacts hold right now, whether or not the workspace lists them in
 * `status_options`. The platform default stage `new` and a status that predates the workspace's own configuration have no
 * option row, yet contacts carry them: a filter or a segment rule on such a value is valid, and the dropdown must offer it.
 *
 * `among` narrows the lookup to the values a rule mentions (one indexed probe); `scope` is the caller's record scope.
 */
async function distinctValues(
  tx: Tx,
  orgId: number,
  column: typeof contacts.lifecycleStage | typeof contacts.status,
  among: readonly string[] | undefined,
  scope: SQL | undefined,
): Promise<string[]> {
  if (among && among.length === 0) return [];
  const rows = await tx
    .selectDistinct({ value: column })
    .from(contacts)
    .where(
      and(
        eq(contacts.orgId, orgId),
        sql`${column} IS NOT NULL AND btrim(${column}) <> ''`,
        among ? inArray(column, [...among]) : undefined,
        scope,
      ),
    )
    .orderBy(asc(column));
  return rows.map((r) => r.value).filter((v): v is string => v !== null);
}

export const stagesInUse = (tx: Tx, orgId: number, among?: readonly string[], scope?: SQL) =>
  distinctValues(tx, orgId, contacts.lifecycleStage, among, scope);

export const statusesInUse = (tx: Tx, orgId: number, among?: readonly string[], scope?: SQL) =>
  distinctValues(tx, orgId, contacts.status, among, scope);
