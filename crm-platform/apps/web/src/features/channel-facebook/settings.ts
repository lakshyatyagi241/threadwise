import { settingsTile } from '../_registry/settings-types';

/** Facebook is a channel: Pages are connected from Settings > Channels, not from the main menu. */
export const settings = [
  settingsTile({
    id: 'facebook',
    section: 'channels',
    href: '/facebook',
    icon: 'facebook',
    order: 20,
    gates: { permission: 'fb.pages.read' },
  }),
];
