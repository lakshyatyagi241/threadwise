import { sql, type SQL } from 'drizzle-orm';
import { defineHolder } from '../registry/define';
import { bigintArray, linkPredicate } from '../registry/sql';
import type { Link, ResolvedSubject } from '../registry/types';
import { BUYER_LINKS } from './sales';

/**
 * Derived convenience copies: files and summaries a feature builds FROM the records of truth (invoices, payments, contacts, deals).
 *
 * The legal reasoning behind the two holders in this file (owner decision, to be confirmed by counsel):
 *
 *  - A derived copy is not a record of truth. The records it was built from are kept or erased by their own manifests (invoices and
 *    payments are kept for the statutory period under tax and accounting law, `sales.ts`); the copy has no retention duty of its own, so
 *    GDPR Art. 17(1) (erasure without undue delay) applies to it in full and the Art. 17(3)(b) exemption (legal obligation) does not
 *    reach it. The same reading holds for DPDP Act s.8(7) (erase when the purpose is served) and the storage-limitation principle.
 *  - The copy is regenerable, so purging it costs the workspace nothing but a click. That is why the purge is broad where the copy
 *    does not record whom it covers (a revenue export lists payments and does not keep which buyers), instead of adding a heavy column
 *    only to keep a file nobody is owed.
 *  - Time limit: a revenue export lives 7 days (REVENUE_EXPORT_TTL_DAYS) and the daily sweep removes the file within 24 hours after
 *    that, so the copy never outlives the one-month "without undue delay" period of GDPR Art. 12(3). An erasure removes it at once.
 *  - `audit_log` rows are not touched by any of this: they are kept for security and legal obligations and pseudonymised by the
 *    existing rules (`privacy.ts`). The purge itself writes an audit row (a count, never a value).
 *
 * Both tables are tier `core`: a data request (all tiers) and a contact deleted in the CRM (core and history) run them, and so does
 * `PersonalDataErasureService.eraseStaff` for a staff member.
 */

const CONTACT: Link = { by: 'contact', column: 'contact_id' };

/**
 * A revenue export that could list the buyer: one that is not yet expired (queued, running or ready; a `ready` file is gone once the
 * daily sweep has run, a failed or expired row holds no file) in a workspace where the person has an invoice or a payment. The ledger
 * CSV names the buyer (contact name, company) and the summary and PDF are built from the same invoices, so an export can only include
 * a person who has one. The row records no buyer (its `filters` hold the window, grouping and owner/team/currency filters), so every
 * unexpired export of the workspace is purged: they are regenerable and all of them were generated before this erasure completed.
 * `queued` and `running` ones are removed too, so a worker that read the person's rows just before the erasure cannot store a file
 * after it (its `finish` finds no row and stores nothing).
 */
function buyerExports(s: ResolvedSubject): SQL {
  const bought = [
    sql`EXISTS (SELECT 1 FROM invoices WHERE org_id = ${s.orgId} AND (${linkPredicate(BUYER_LINKS, s)}))`,
    sql`EXISTS (SELECT 1 FROM payments WHERE org_id = ${s.orgId} AND (${linkPredicate(CONTACT, s)}))`,
  ];
  return sql`status IN ('queued', 'running', 'ready') AND (${sql.join(bought, sql` OR `)})`;
}

/** The briefs of the companies the person is linked to (`contacts.company_id`), whoever generated them. */
function linkedCompanyBriefs(s: ResolvedSubject): SQL {
  if (!s.contactIds.length) return sql`FALSE`;
  return sql`company_id IN (
    SELECT company_id FROM contacts
     WHERE org_id = ${s.orgId} AND id = ANY(${bigintArray(s.contactIds)}) AND company_id IS NOT NULL)`;
}

const USER_LINK: Link = { by: 'user', column: 'requested_by' };

export const revenueExports = defineHolder({
  key: 'revenue.exports',
  module: 'crm/revenue-report',
  description:
    'Prepared files of the revenue report (CSV, PDF): temporary derived copies of invoices and payments, kept 7 days.',
  subjects: ['user', 'contact'],
  tables: [
    {
      table: 'revenue_report_exports',
      link: [
        // Rows the staff member asked for, and rows the "your export is ready" mail went to their address.
        USER_LINK,
        { by: 'user_email', column: 'emailed_to' },
        // A buyer (contact) is erased: every unexpired export of the workspace goes (see `buyerExports`).
        { by: 'custom', column: 'status', predicate: buyerExports },
      ],
      // The staff member's own export rows (what they asked for and where it went), without the files: those are derived copies of
      // data already exported through invoices and payments. A buyer's export never lists other members' exports.
      exportLink: [USER_LINK, { by: 'user_email', column: 'emailed_to' }],
      exportOmit: ['file_gz'],
      disposition: 'delete',
      tier: 'core',
      // Before the invoices of a buyer are anonymised (their address and number are cleared), which this rule reads.
      order: 10,
      audited: true,
      categories: ['financial', 'identifier'],
      pii: ['emailed_to', 'file_gz'],
      retention:
        'Temporary derived copy, not a record of truth: the file (gzipped CSV or PDF, stored in the row itself in `file_gz`, no object storage) is unavailable after 7 days (REVENUE_EXPORT_TTL_DAYS) and the daily sweep (03:23) empties it within 24 hours after that, which is inside the one-month "without undue delay" period. The row then stays as `expired` without a file, with the address the mail went to, until its requester is erased. Deleted with its file when the staff member who asked for it, or the address it was mailed to, is erased (the foreign key to users cascades as well), and every unexpired export of the workspace is deleted when a buyer is erased. Invoices and payments are kept by their own manifest (statutory period).',
    },
  ],
});

export const companyBriefs = defineHolder({
  key: 'companies.briefs',
  module: 'company-briefs',
  description:
    'AI-written account briefs of a company, one per (company, staff member): derived, regenerable summaries.',
  subjects: ['user', 'contact'],
  tables: [
    {
      table: 'company_briefs',
      link: [
        // The per-person cache: all briefs the staff member generated.
        { by: 'user', column: 'user_id' },
        // A contact is erased: the briefs of the companies the contact is linked to, whoever generated them.
        { by: 'custom', column: 'company_id', predicate: linkedCompanyBriefs },
      ],
      // A staff member's own briefs. A contact's export never carries another member's briefs of their company.
      exportLink: { by: 'user', column: 'user_id' },
      disposition: 'delete',
      tier: 'core',
      audited: true,
      categories: ['ai_inference', 'content'],
      // `content` is model-written text (a summary and bullets) built from counts, dates, amounts and short masked texts (a company
      // name, deal and task titles, company property values; emails and long numbers are masked out before anything is sent). No
      // contact name, email, phone or message text is sent, but a title or a property value a user typed can still name a person
      // and the model can repeat it, so the column is treated as personal. `input_hash` is a digest of the facts (a hash, not
      // readable), `provider`, `model` and the token counts hold nothing about a person.
      pii: ['content'],
      retention:
        'Derived, regenerable AI summary, not a record of truth: kept as a cache (reused for a day, overwritten when regenerated), deleted when the staff member who generated it is erased (the foreign key to users cascades as well), when its company is deleted, and when a contact linked to the company is erased or deleted, so no derived profile of an erased person survives. Regenerating makes a new brief from the records that remain.',
    },
  ],
});
