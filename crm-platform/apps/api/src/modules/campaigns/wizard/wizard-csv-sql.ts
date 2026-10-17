import { sql, type SQL } from 'drizzle-orm';
import { identifier } from '../../../common/sql/identifier';

/**
 * SQL over a stored CSV upload and the contacts its numbers belong to. A number matches a contact by the digits of the contact's
 * phone, or by the phone identity the CRM keeps for it (the key create, import and de-duplication all find a contact by).
 */

/** The digits of a phone column pair, for the alias a query gives `contacts`. */
const digitsOf = (alias: string) => {
  const a = identifier(alias);
  return sql.raw(`regexp_replace(coalesce(${a}.normalized_phone, ${a}.phone, ''), '\\D', '', 'g')`);
};

/** The valid numbers of one upload, as a `SELECT r.line, r.phone, r.digits, r.name ...` body. */
const validRows = (orgId: number, uploadId: number): SQL =>
  sql`FROM camp_wizard_csv_rows r WHERE r.org_id = ${orgId} AND r.upload_id = ${uploadId} AND r.kind = 'valid'`;

/** A condition over `contacts` (the audience's table): the contact owns one of the upload's valid numbers. */
export function csvContactsWhere(orgId: number, uploadId: number): SQL {
  return sql`(${digitsOf('contacts')} IN (SELECT r.digits ${validRows(orgId, uploadId)})
    OR contacts.id IN (SELECT ci.contact_id FROM contact_identities ci
        WHERE ci.org_id = ${orgId} AND ci.kind = 'phone' AND ci.value IN (SELECT r.phone ${validRows(orgId, uploadId)})))`;
}

/**
 * The lines of the upload's valid numbers that a contact (satisfying `contactCondition`, written over the alias `c`) already owns.
 * Uncorrelated `IN` lists, so the database hashes them: one pass over the contacts however long the file is.
 */
export function csvMatchedLines(orgId: number, uploadId: number, contactCondition: SQL): SQL {
  return sql`SELECT r.line ${validRows(orgId, uploadId)}
    AND (r.digits IN (SELECT ${digitsOf('c')} FROM contacts c WHERE c.org_id = ${orgId} AND ${contactCondition})
      OR r.phone IN (SELECT ci.value FROM contact_identities ci
            JOIN contacts c ON c.org_id = ci.org_id AND c.id = ci.contact_id
            WHERE ci.org_id = ${orgId} AND ci.kind = 'phone' AND ${contactCondition}))`;
}

/** The valid numbers no contact owns (archived ones count as owned: they are neither messaged nor created again). */
export function csvNewRowsWhere(orgId: number, uploadId: number): SQL {
  return sql`r.org_id = ${orgId} AND r.upload_id = ${uploadId} AND r.kind = 'valid'
    AND r.line NOT IN (${csvMatchedLines(orgId, uploadId, sql`true`)})`;
}
