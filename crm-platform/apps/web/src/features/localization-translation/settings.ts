import { settingsTile } from '../_registry/settings-types';

/** Translation settings left the menu for Settings (Integrations and developer). */
export const settings = [
  settingsTile({
    id: 'i18n-translation',
    section: 'integrations',
    href: '/i18n/translation',
    icon: 'globe',
    order: 40,
    gates: { permission: 'i18n.translation_settings.read' },
  }),
];
