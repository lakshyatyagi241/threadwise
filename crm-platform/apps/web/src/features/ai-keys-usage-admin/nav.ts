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
  {
    id: 'ai-keys',
    group: 'settings',
    labelKey: 'ai-keys-usage-admin.nav.keys',
    href: '/ai-keys',
    order: 40,
    icon: 'settings',
    gates: { permission: 'aiadm.keys.read' },
  },
];
