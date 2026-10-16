import { defineHolder } from '../registry/define';
import type { Link } from '../registry/types';

/**
 * Analytics events (docs/superpowers/specs/2026-10-16-event-based-analytics-design.md). They hold ids and numbers, never message text,
 * phone numbers or emails; the one link to a person is `contact_id`, which an erase removes while the counts stay. The archive left
 * after the 60 day hot window omits that column, so nothing in object storage needs rewriting.
 */
const CONTACT: Link = { by: 'contact', column: 'contact_id' };

export const analyticsEvents = defineHolder({
  key: 'analytics.events',
  module: 'analytics',
  description:
    'The event stream behind the analytics screens: counts of what happened, with the contact it concerned.',
  subjects: ['contact'],
  tables: [
    {
      table: 'an_events',
      link: CONTACT,
      disposition: 'anonymise',
      set: { contact_id: 'null' },
      tier: 'history',
      categories: ['behaviour'],
      pii: ['contact_id'],
      retention:
        'Raw events are kept 60 days, then archived without the contact link. An erase removes the link; the counts stay.',
    },
  ],
});
