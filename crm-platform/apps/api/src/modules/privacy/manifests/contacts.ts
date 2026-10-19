import { defineHolder } from '../registry/define';
import type { Link } from '../registry/types';

/**
 * Personal-data holders of the contact card and everything the database removes with it. Wiring map keys: contacts.card,
 * contacts.attributes, contacts.notes_files, contacts.groups_tags, consent.ledger (docs/threadwise-port/wiring/privacy-and-data.md).
 */
const CONTACT: Link = { by: 'contact', column: 'contact_id' };

export const contactsCard = defineHolder({
  key: 'contacts.card',
  module: 'crm/contacts',
  description:
    'The contact card: name, phone, email, address, custom properties, identities and campaign attribution.',
  subjects: ['contact', 'lead'],
  tables: [
    {
      table: 'contacts',
      link: { by: 'self', column: 'id' },
      disposition: 'delete',
      tier: 'subject',
      order: 900,
      categories: ['identifier', 'contact'],
      pii: [
        'name',
        'first_name',
        'middle_name',
        'last_name',
        'email',
        'phone',
        'normalized_email',
        'normalized_phone',
        'fax_number',
        'title',
        'address',
        'date_of_birth',
        'image_url',
        'channel_uid',
        'subject',
        'message',
        'data',
        'lost_reason',
        'other_lost_reason',
      ],
      retention: 'Until the contact is deleted from the workspace.',
      exportOmit: ['search_vector'],
    },
    {
      table: 'contact_identities',
      link: CONTACT,
      disposition: 'cascade',
      parent: 'contacts',
      tier: 'core',
      categories: ['identifier'],
      pii: ['value'],
      retention: 'With the contact.',
    },
    {
      table: 'contact_attributions',
      link: CONTACT,
      disposition: 'cascade',
      parent: 'contacts',
      tier: 'core',
      categories: ['attribution'],
      pii: ['campaign', 'adset', 'ad', 'form', 'source_label', 'evidence'],
      retention: 'With the contact.',
    },
  ],
});

export const contactsNotesFiles = defineHolder({
  key: 'contacts.notes_files',
  module: 'crm/contact-notes, crm/contact-files, crm/contact-activities, crm/contact-meetings',
  description: 'Notes, files, the activity timeline and meetings of a contact.',
  subjects: ['contact'],
  tables: [
    {
      table: 'contact_notes',
      link: CONTACT,
      disposition: 'cascade',
      parent: 'contacts',
      tier: 'core',
      categories: ['content'],
      pii: ['body'],
      retention: 'With the contact.',
    },
    {
      table: 'contact_files',
      link: CONTACT,
      disposition: 'cascade',
      parent: 'contacts',
      tier: 'core',
      categories: ['content'],
      pii: ['file_name'],
      storage: [{ column: 'storage_key', note: 'the uploaded file' }],
      retention: 'With the contact; the stored file is queued for deletion with it.',
    },
    {
      table: 'contact_activities',
      link: CONTACT,
      disposition: 'cascade',
      parent: 'contacts',
      tier: 'core',
      categories: ['behaviour', 'content'],
      pii: ['title', 'body'],
      retention: 'With the contact.',
    },
    {
      table: 'contact_meetings',
      link: CONTACT,
      disposition: 'cascade',
      parent: 'contacts',
      tier: 'core',
      categories: ['content'],
      // join_url is the link that opens the call, copied from the booking's calendar event: whoever holds it can join.
      pii: ['title', 'location', 'join_url'],
      retention: 'With the contact.',
    },
    {
      // The outcome and notes of a completed meeting (Settings > Sales Activities). The note is free text a person wrote about the contact.
      table: 'contact_meeting_outcomes',
      link: CONTACT,
      disposition: 'cascade',
      parent: 'contacts',
      tier: 'core',
      categories: ['content'],
      pii: ['note'],
      retention: 'With the contact.',
    },
    {
      // The video link and calendar entry asked for on a typed-in meeting (BL-361, BL-362): the provider's ids of the room and the event.
      // The room and the event themselves live at Zoom, Teams, Google or Outlook and are removed by the worker when the meeting is deleted.
      table: 'contact_meeting_conferencing',
      link: {
        by: 'via',
        column: 'meeting_id',
        table: 'contact_meetings',
        key: 'id',
        link: CONTACT,
      },
      disposition: 'cascade',
      parent: 'contact_meetings',
      tier: 'core',
      categories: ['content'],
      pii: ['video_meeting_id', 'calendar_event_id'],
      retention: 'With the meeting.',
    },
  ],
});

export const contactsGroupsTags = defineHolder({
  key: 'contacts.groups_tags',
  module: 'crm/contact-groups, crm/tags, crm/segments',
  description: 'Which groups, tags and segment memberships a contact is in.',
  subjects: ['contact'],
  tables: [
    {
      table: 'contact_tags',
      link: CONTACT,
      disposition: 'cascade',
      parent: 'contacts',
      tier: 'core',
      categories: ['behaviour'],
      pii: [],
      retention: 'With the contact.',
    },
    {
      table: 'contact_group_members',
      link: CONTACT,
      disposition: 'cascade',
      parent: 'contacts',
      tier: 'core',
      categories: ['behaviour'],
      pii: [],
      retention: 'With the contact.',
    },
    {
      table: 'flow_segment_state',
      link: CONTACT,
      disposition: 'cascade',
      parent: 'contacts',
      tier: 'core',
      categories: ['behaviour'],
      pii: [],
      retention: 'With the contact.',
    },
  ],
});

export const consentLedger = defineHolder({
  key: 'consent.ledger',
  module: 'contact-consent',
  description:
    'Consent events (append-only proof) and the derived state per channel and purpose, the contact privacy flags (minor, guardian consent, Do Not Sell or Share) with their events, and the workspace Do-Not-Call list.',
  subjects: ['contact'],
  tables: [
    {
      table: 'contact_consent_events',
      link: CONTACT,
      disposition: 'fk_null',
      parent: 'contacts',
      reason:
        'Append-only proof of consent. The foreign key unlinks it from the contact when the contact is deleted; evidence holds ids and hashes, never an address, IP or message text.',
      tier: 'core',
      categories: ['behaviour'],
      pii: ['note'],
      retention: 'Kept as consent proof (legitimate interest), without a link to a person.',
    },
    {
      table: 'contact_consent_state',
      link: CONTACT,
      disposition: 'cascade',
      parent: 'contacts',
      tier: 'core',
      categories: ['behaviour'],
      pii: [],
      retention: 'With the contact.',
    },
    {
      table: 'contact_privacy_events',
      link: CONTACT,
      disposition: 'fk_null',
      parent: 'contacts',
      reason:
        'Append-only proof of a privacy flag change (minor, guardian consent, Do Not Sell or Share). The foreign key unlinks it from the contact when the contact is deleted; evidence holds ids and references, never an address, IP or message text.',
      tier: 'core',
      categories: ['behaviour', 'special_risk'],
      pii: ['note'],
      retention:
        'Kept as proof of the opt-out or the guardian consent, without a link to a person.',
    },
    {
      table: 'contact_privacy_flags',
      link: CONTACT,
      disposition: 'cascade',
      parent: 'contacts',
      tier: 'core',
      categories: ['special_risk'],
      pii: [],
      retention: 'With the contact.',
    },
    {
      table: 'dnc_entries',
      link: { by: 'phone', column: 'phone_digits' },
      disposition: 'retain',
      reason:
        'The Do-Not-Call list of the workspace is the suppression record that stops marketing calls and texts to a number. Erasing the person must not make the number callable again, so the entry stays (a number and a source, no name); a data request can still remove it on purpose.',
      tier: 'records',
      categories: ['identifier'],
      pii: ['phone', 'note'],
      retention: 'Until the workspace removes the number from its list.',
    },
  ],
});
