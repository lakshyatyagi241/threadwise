import type { NavItem } from '../_registry/types';

/**
 * "WhatsApp Forms" and "WhatsApp Links" in Reference's Automation group, next to Flows — both gated by the
 * `forms_and_links` plan feature (Reference's bundled name for both), split by their own permission keys.
 */
export const nav: NavItem[] = [
  {
    id: 'wa-forms',
    group: 'automation',
    labelKey: 'forms-links-groups.nav.forms',
    href: '/wa-forms',
    order: 10,
    icon: 'form',
    gates: { permission: 'wfl.forms.read', planFeature: 'forms_and_links' },
  },
  {
    id: 'wa-links',
    group: 'automation',
    labelKey: 'forms-links-groups.nav.links',
    href: '/wa-links',
    order: 11,
    icon: 'link',
    gates: { permission: 'wfl.links.read', planFeature: 'forms_and_links' },
  },
];
