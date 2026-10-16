import { defineHolder } from '../registry/define';
import type { Link } from '../registry/types';

/**
 * Business records that point at a person: leads and their intake, deals, tasks, projects, forms, appointments, growth/AI output.
 * These are `records` tier: a data request anonymises them (the row and its dates stay for reporting); deleting a contact in the CRM
 * leaves them as they are today (the foreign key unlinks them).
 */
const CONTACT: Link = { by: 'contact', column: 'contact_id' };

export const leadsRecords = defineHolder({
  key: 'leads.records',
  module: 'leads, lead-scoring, marketplace (lead pipeline)',
  description:
    'Leads (found or submitted), their intake events and the webhook bodies that created them, lead scoring runs.',
  subjects: ['lead', 'contact'],
  tables: [
    {
      table: 'leads',
      link: [
        { by: 'lead', column: 'id' },
        CONTACT,
        { by: 'phone', column: 'phone_e164' },
        { by: 'email', column: 'email' },
      ],
      disposition: 'anonymise',
      set: {
        name: 'tombstone',
        phone: 'null',
        phone_e164: 'null',
        email: 'null',
        website: 'null',
        address: 'null',
        lat: 'null',
        lng: 'null',
        raw: 'null',
      },
      tier: 'records',
      categories: ['identifier', 'contact', 'location', 'attribution'],
      pii: ['name', 'phone', 'phone_e164', 'email', 'website', 'address', 'lat', 'lng', 'raw'],
      retention: 'Forever; the row keeps its source, category and dates for reporting.',
    },
    {
      table: 'lead_events',
      link: CONTACT,
      disposition: 'anonymise',
      set: { payload: 'null', error: 'null' },
      tier: 'records',
      categories: ['contact', 'attribution'],
      pii: ['payload', 'error'],
      retention: 'The raw payload is purged on its own schedule (payload_expires_at).',
    },
    {
      table: 'incoming_webhook_events',
      link: { by: 'contact', column: 'lead_contact_id' },
      disposition: 'anonymise',
      set: { payload: 'null', headers: 'null', source_ip: 'null', forward_error: 'null' },
      tier: 'records',
      categories: ['contact', 'identifier'],
      pii: ['payload', 'headers', 'source_ip', 'forward_error'],
      retention: 'Forever today; delivery metadata (status, time) is kept.',
    },
    {
      table: 'lead_scoring_runs',
      link: CONTACT,
      disposition: 'delete',
      tier: 'records',
      categories: ['ai_inference', 'identifier'],
      pii: ['contact_name', 'reasons'],
      retention:
        'AI scoring log; no foreign key to the contact (the id is stored as a plain number).',
    },
    {
      table: 'lead_chat_digests',
      link: CONTACT,
      disposition: 'cascade',
      parent: 'contacts',
      tier: 'core',
      categories: ['ai_inference', 'content'],
      pii: ['summary', 'signals', 'intent', 'evidence', 'reasons', 'issue'],
      retention: 'With the contact.',
    },
    {
      table: 'lifecycle_stage_suggestions',
      link: CONTACT,
      disposition: 'cascade',
      parent: 'contacts',
      tier: 'core',
      categories: ['ai_inference'],
      pii: ['reasons'],
      retention: 'With the contact.',
    },
    {
      table: 'growth_actions',
      link: CONTACT,
      disposition: 'cascade',
      parent: 'contacts',
      tier: 'core',
      categories: ['ai_inference', 'content'],
      pii: ['title', 'detail', 'payload'],
      retention: 'With the contact.',
    },
    {
      table: 'contact_propensity',
      link: CONTACT,
      disposition: 'cascade',
      parent: 'contacts',
      tier: 'core',
      categories: ['ai_inference', 'behaviour'],
      pii: ['features'],
      retention: 'With the contact.',
    },
    {
      table: 'contact_enrichment',
      link: CONTACT,
      disposition: 'cascade',
      parent: 'contacts',
      tier: 'core',
      categories: ['contact', 'ai_inference'],
      pii: ['data'],
      retention: 'With the contact.',
    },
    {
      table: 'partner_agent_leads',
      link: CONTACT,
      disposition: 'cascade',
      parent: 'contacts',
      tier: 'core',
      categories: ['contact', 'attribution'],
      pii: ['submitted_payload', 'college_tag'],
      retention: 'With the contact.',
    },
  ],
});

export const crmRecords = defineHolder({
  key: 'crm.records',
  module: 'crm/deals, crm/tasks, crm/companies (projects)',
  description:
    'Deals, tasks and projects linked to a person. Titles and notes often carry the name, so a data request clears them.',
  subjects: ['contact'],
  tables: [
    {
      table: 'deals',
      link: CONTACT,
      disposition: 'anonymise',
      set: { title: 'tombstone', notes: 'null', meta: 'null', lost_reason: 'null' },
      tier: 'records',
      categories: ['contact', 'content'],
      pii: ['title', 'notes', 'meta', 'lost_reason'],
      retention: 'Forever; value, stage and dates stay for reporting.',
    },
    {
      table: 'tasks',
      link: CONTACT,
      disposition: 'anonymise',
      set: { title: 'tombstone', notes: 'null' },
      tier: 'records',
      categories: ['content'],
      pii: ['title', 'notes'],
      retention: 'Forever; status and dates stay.',
    },
    {
      table: 'projects',
      link: CONTACT,
      disposition: 'anonymise',
      set: { name: 'tombstone', description: 'null' },
      tier: 'records',
      categories: ['content'],
      pii: ['name', 'description'],
      retention: 'Forever; status and dates stay.',
    },
    {
      table: 'keyword_replies',
      link: { by: 'contact', column: 'target_contact_id' },
      disposition: 'fk_null',
      parent: 'contacts',
      reason:
        'An automation rule that targets one contact. It holds the keyword and reply, no personal value of the contact; the foreign key unlinks it.',
      tier: 'core',
      categories: ['behaviour'],
      pii: [],
      retention: 'Until the workspace deletes the rule.',
    },
  ],
});

export const formsSubmissions = defineHolder({
  key: 'forms.submissions',
  module: 'forms-builder, whatsapp flows forms',
  description:
    'Answers submitted through web forms and WhatsApp flow forms, and the consent line shown with them.',
  subjects: ['contact', 'lead'],
  tables: [
    {
      table: 'web_form_submissions',
      link: CONTACT,
      disposition: 'anonymise',
      set: {
        answers: 'empty_object',
        ip_hash: 'null',
        user_agent: 'null',
        referrer: 'null',
        page_url: 'null',
        error: 'null',
        erased_at: 'now',
        payload_purged_at: 'now',
      },
      tier: 'records',
      categories: ['contact', 'content', 'attribution', 'special_risk'],
      pii: ['answers', 'ip_hash', 'user_agent', 'referrer', 'page_url', 'error'],
      retention:
        "Answers are purged on the form's own schedule (answers_expires_at); the consent proof of the submission stays.",
    },
    {
      table: 'wa_form_submissions',
      link: [
        CONTACT,
        { by: 'phone', column: 'caller_phone' },
        { by: 'conversation', column: 'conversation_id' },
      ],
      disposition: 'anonymise',
      set: { caller_phone: 'null', answers_json: 'null', meta_payload: 'null', flow_token: 'null' },
      tier: 'records',
      categories: ['contact', 'content', 'special_risk'],
      pii: ['caller_phone', 'answers_json', 'meta_payload', 'flow_token'],
      retention: 'Forever today.',
    },
  ],
});

export const appointmentsHolder = defineHolder({
  key: 'appointments',
  module: 'appointments-booking',
  description: 'Bookings: who booked, how to reach them, what they answered.',
  subjects: ['contact'],
  tables: [
    {
      table: 'appointments',
      link: [
        CONTACT,
        { by: 'phone', column: 'invitee_phone' },
        { by: 'email', column: 'invitee_email' },
        { by: 'conversation', column: 'conversation_id' },
      ],
      disposition: 'anonymise',
      set: {
        invitee_name: 'null',
        invitee_email: 'null',
        invitee_phone: 'null',
        notes: 'null',
        description: 'null',
        answers: 'null',
        meet_url: 'null',
        manage_token_hash: 'null',
        manage_token_cipher: 'null',
      },
      tier: 'records',
      categories: ['identifier', 'contact', 'content', 'special_risk'],
      pii: [
        'invitee_name',
        'invitee_email',
        'invitee_phone',
        'notes',
        'description',
        'answers',
        'meet_url',
      ],
      retention: 'Forever; time, status and price stay for reporting.',
    },
  ],
});

export const growthEnrichment = defineHolder({
  key: 'growth.enrichment',
  module: 'growth-pilot, wa-commerce customer profile',
  description: 'Customer profile built from WhatsApp commerce and group membership.',
  subjects: ['contact'],
  tables: [
    {
      table: 'wa_customer_profiles',
      link: [CONTACT, { by: 'phone', column: 'phone' }],
      disposition: 'delete',
      tier: 'records',
      categories: ['identifier', 'contact'],
      pii: ['phone', 'name', 'company', 'address'],
      retention: 'Forever today.',
    },
    {
      table: 'wa_group_members',
      link: { by: 'phone', column: 'phone' },
      disposition: 'delete',
      tier: 'records',
      categories: ['identifier'],
      pii: ['phone'],
      retention: 'Synced from the WhatsApp group; re-created if the person is still in the group.',
    },
  ],
});
