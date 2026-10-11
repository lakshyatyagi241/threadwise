import type { NavItem } from '../_registry/types';

/**
 * One menu entry in the Automation group: the FAQ knowledge base (ADR-0021). New to the product (not a WaDesk screen), so there is no
 * planned placeholder to replace. Everything under /faq shares one sub-navigation; the entry lights up for all of it.
 */
export const nav: NavItem[] = [
  {
    id: 'faq',
    group: 'automation',
    labelKey: 'faq.nav.faq',
    href: '/faq',
    order: 6,
    icon: 'book',
    gates: { permission: 'faq.entries.read' },
  },
];
