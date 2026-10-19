/**
 * The surfaces where a workspace's own nouns are shown (BL-310, docs/specs/persona-profiles.md 7.4 "bindings registry"). A binding is a
 * message-key prefix: every string under it is run through the noun rewrite (`localize.ts`) when the workspace has named a noun for the
 * person's language. A string with none of the product's words in it is left exactly as it was, so a prefix can be broad.
 *
 * What is NOT here is on purpose, and listed in docs/api/persona-vocabulary.md ("Coverage"): sentences in dialogs of other features,
 * errors, notification text, emails and WhatsApp messages sent to customers, CSV headers, API fields, Help guides, Settings pages for
 * contact stages and properties. Add a surface by adding its prefix here; the tests hold each prefix to the English messages and the
 * result to the same arguments and tags as the original.
 *
 * A prefix is dotted message-key path ("contacts-attributes-tags.list" binds every key below it, or one key if it is a leaf).
 * Keep customer-facing text (templates, outgoing messages) out: those must say what the business means in the customer's language.
 */
export interface BoundSurface {
  /** A short name for the docs and the test names. */
  id: string;
  prefixes: readonly string[];
}

export const BOUND_SURFACES: readonly BoundSurface[] = [
  {
    id: 'contacts-menu',
    prefixes: ['contacts-attributes-tags.nav', 'shell.nav.appointments'],
  },
  {
    // The list: title, subtitle, "Add contact", search, empty states, first run, column heads, banners, selection, bulk actions, views.
    id: 'contacts-list',
    prefixes: [
      'contacts-attributes-tags.list',
      'contacts-attributes-tags.bulk',
      'contacts-attributes-tags.kanban',
      'contacts-attributes-tags.views',
      'contacts-attributes-tags.form',
    ],
  },
  {
    // Quick view, the record page (title, tabs, actions, cards, summaries), its meetings, deals and notes sections.
    id: 'contact-record',
    prefixes: [
      'contacts-attributes-tags.detail',
      'contacts-attributes-tags.contact.quick',
      'contacts-attributes-tags.contact.header',
      'contacts-attributes-tags.contact.record',
      'contacts-attributes-tags.contact.nav',
      'contacts-attributes-tags.contact.actions',
      'contacts-attributes-tags.contact.tabs',
      'contacts-attributes-tags.contact.details',
      'contacts-attributes-tags.contact.meetings',
      'contacts-attributes-tags.contact.deals',
      'contacts-attributes-tags.contact.notes',
    ],
  },
  {
    // The Appointments hub: title, tabs, toolbar, table, rows, drawer, calendar, status, toasts, reschedule.
    id: 'appointments',
    prefixes: [
      'appointments.nav',
      'appointments.hub',
      'appointments.tabs',
      'appointments.toolbar',
      'appointments.table',
      'appointments.row',
      'appointments.calendar',
      'appointments.status',
      'appointments.drawer',
      'appointments.toast',
      'appointments.reschedule',
    ],
  },
  {
    // Reminders and follow-ups of a booking type (BL-283): the card on Appointment settings, the editor's Messaging step and the drawer's
    // list. Written with the default nouns (appointment, contact) so a workspace that says Visit or Patient reads its own words.
    id: 'reminders',
    prefixes: ['appointments.reminders', 'appointments.channels', 'appointments.templates'],
  },
  {
    // The staff screens that style the customer's booking page (BL-355): written with the default nouns. The sample text of its preview
    // names no noun, because the preview shows what a customer sees.
    id: 'booking-page-appearance',
    prefixes: ['appointments.appearance'],
  },
  {
    // The video link and calendar fields of the Add meeting form, the status line of a meeting, and the Video meetings page (BL-360).
    // Written with the default nouns (meeting, contact) so a workspace that says Visit or Patient reads its own words.
    id: 'meeting-conferencing',
    prefixes: [
      'meeting-conferencing.form',
      'meeting-conferencing.row',
      'meeting-conferencing.page',
    ],
  },
  {
    id: 'deals',
    prefixes: [
      'deals-pipelines.nav',
      'deals-pipelines.board',
      'deals-pipelines.toolbar',
      'deals-pipelines.list',
      'deals-pipelines.card',
      'deals-pipelines.form',
      'deals-pipelines.drawer',
    ],
  },
];

/** Every bound prefix, flat. */
export const BOUND_PREFIXES: readonly string[] = BOUND_SURFACES.flatMap((s) => s.prefixes);

/**
 * Remaining surfaces: places that still say the product's word. docs/api/persona-vocabulary.md lists the same lines and
 * `bindings.test.ts` fails when the two drift apart.
 */
export const NOT_YET_BOUND: readonly string[] = [
  'Contact stages, Contact properties, Attributes, Import / export (Settings screens)',
  'Contact groups and Segments screens, the contact filter panel, applied-filter chips',
  'Inbox: conversation header, assign-to and "new contact" prompts, the right-hand contact panel',
  'Campaigns, broadcasts, flows and forms: audience pickers, "send to contacts" steps, node names',
  'Companies, Tasks, Proposals, Estimates and invoices that mention a contact, deal or appointment',
  'Dashboard cards, reports and analytics titles',
  'Notifications, the activity log, emails and WhatsApp messages the product sends',
  'Appointment booking types editor, public booking page, reminder templates',
  'Help center guides and the Help assistant',
  'Platform console (operator) screens',
  'Page title metadata (the browser tab) and any text rendered by a server component with getTranslations',
];
