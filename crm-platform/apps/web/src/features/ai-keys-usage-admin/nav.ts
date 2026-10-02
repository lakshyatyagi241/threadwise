import type { NavItem } from '../_registry/types';

export const nav: NavItem[] = [
  {
    id: 'ai-usage',
    group: 'automation',
    labelKey: 'ai-keys-usage-admin.nav.usage',
    href: '/ai-usage',
    order: 15,
    icon: 'analytics',
    gates: { permission: 'aiadm.usage.read' },
  },
];
