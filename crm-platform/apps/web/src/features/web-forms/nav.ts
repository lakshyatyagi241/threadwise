import type { NavItem } from '../_registry/types';

/**
 * Forms is a paid first-party Marketplace app that grants `form_builder` (docs/specs/forms-builder-app.md, section 12), so the
 * `app` gate removes the entry and closes `/forms` (any depth) for a workspace that has not bought it. It sits in Campaigns next to
 * Broadcasts (decision D7): it is a lead and audience tool. The public pages (`/f/<key>`) are outside the shell and are gated by the API.
 */
export const nav: NavItem[] = [
  {
    id: 'forms',
    group: 'campaigns',
    labelKey: 'web-forms.nav.forms',
    href: '/forms',
    order: 15,
    icon: 'forms',
    gates: { permission: 'record.forms.read', app: 'form_builder' },
  },
];
