import { sql } from 'drizzle-orm';
import { defineHolder } from '../registry/define';

/**
 * The rights service's own rows, and the audit trail of the person's record.
 *
 * `privacy_requests` points at the contact and the lead it was made for; both links are unlinked by the foreign key when the person is
 * deleted, so the request, its proof and its history survive the erasure they document. The row holds a masked label only.
 *
 * `audit_log` keeps who changed what and when. For a contact the `delta` holds the old and new values of the fields that changed
 * (names, numbers), so the delta is cleared on erasure; the row (actor, action, time, record id) stays as the accountability trail.
 */
export const privacyRequestsHolder = defineHolder({
  key: 'privacy.requests',
  module: 'privacy',
  description: 'Data requests about a person, their proof of erasure, and the audit trail of the contact record.',
  subjects: ['contact', 'lead'],
  tables: [
    {
      table: 'privacy_requests',
      link: { by: 'contact', column: 'contact_id' },
      disposition: 'fk_null',
      parent: 'contacts',
      reason:
        'The request and its proof of erasure outlive the person. The row holds a masked label, counts and hashes, never a personal value; the sealed identifier of a free-text subject is removed when the request completes.',
      tier: 'core',
      categories: ['identifier'],
      pii: ['subject_label', 'internal_note'],
      exportOmit: ['subject_identifier_cipher'],
      retention: 'Kept as the record of the request (accountability), without a link to the person.',
    },
    {
      table: 'audit_log',
      link: {
        by: 'custom',
        column: 'record_id',
        predicate: (s) =>
          s.contactIds.length
            ? sql`module = 'contacts' AND record_id = ANY(${`{${s.contactIds.join(',')}}`}::bigint[])`
            : sql`FALSE`,
      },
      disposition: 'anonymise',
      set: { delta: 'null' },
      tier: 'core',
      categories: ['identifier', 'contact', 'behaviour'],
      pii: ['delta'],
      retention: 'The audit row stays (actor, action, time, record id); the changed values are cleared.',
    },
  ],
});
