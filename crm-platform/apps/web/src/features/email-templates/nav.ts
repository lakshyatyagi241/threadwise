import type { NavItem } from '../_registry/types';

/** One menu entry, in Reference's CRM group after Companies (see `planned.ts` for the sequence). */
export const nav: NavItem[] = [
  {
    id: 'email-templates',
    group: 'audience',
    labelKey: 'emailTemplates.nav.emailTemplates',
    href: '/email-templates',
    order: 80,
    icon: 'mail',
    gates: { permission: 'mail.templates.read', planFeature: 'email_channel' },
  },
];
