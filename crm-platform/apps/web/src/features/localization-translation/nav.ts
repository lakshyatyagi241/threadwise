import type { NavItem } from '../_registry/types';

export const nav: NavItem[] = [
  {
    id: 'i18n-translation',
    group: 'settings',
    labelKey: 'localization-translation.nav.translation',
    href: '/i18n/translation',
    order: 91,
    icon: 'settings',
    gates: { permission: 'i18n.translation_settings.read' },
  },
];
