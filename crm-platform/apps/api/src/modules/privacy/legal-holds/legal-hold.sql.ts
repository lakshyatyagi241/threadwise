import { sql, type SQL } from 'drizzle-orm';

/**
 * SQL fragments for the purge paths that cannot loop over rows (a sweep that runs one statement over every workspace). They call the
 * database function `is_subject_held` (migration 20261231090200), the same question the application guard asks, so a nightly job and a
 * delete button can never disagree about what is held. Docs: docs/specs/legal-hold.md section 5.
 *
 * The column arguments are SQL text written in our own code (`w.org_id`, `w.contact_id`), never user input; they are checked against a
 * strict pattern anyway so a careless caller cannot splice something else in.
 */
const COLUMN = /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/;

function column(name: string): SQL {
  if (!COLUMN.test(name)) throw new Error(`not a column reference: ${name}`);
  return sql.raw(name);
}

/** `NOT is_subject_held(org, 'contact', contact)`: keeps the rows of people who are NOT under a hold. A NULL contact is held only by a workspace hold. */
export function sqlContactNotHeld(orgColumn: string, contactColumn: string): SQL {
  return sql`NOT is_subject_held(${column(orgColumn)}, 'contact', ${column(contactColumn)})`;
}

/** The same for a lead. */
export function sqlLeadNotHeld(orgColumn: string, leadColumn: string): SQL {
  return sql`NOT is_subject_held(${column(orgColumn)}, 'lead', ${column(leadColumn)})`;
}

/** `NOT org_has_active_legal_hold(org)`: for wholesale wipes of a workspace, and for report files that may be evidence under a workspace hold. */
export function sqlOrgHasNoHold(orgColumn: string): SQL {
  return sql`NOT org_has_active_legal_hold(${column(orgColumn)})`;
}

/**
 * `NOT is_subject_held(org, 'contact', NULL)`: true unless the workspace is held as a whole. For files and rows that carry no person
 * (an export file, a report) and are kept only while a workspace-wide hold is active.
 */
export function sqlWorkspaceNotHeld(orgColumn: string): SQL {
  return sql`NOT is_subject_held(${column(orgColumn)}, 'contact', NULL)`;
}
