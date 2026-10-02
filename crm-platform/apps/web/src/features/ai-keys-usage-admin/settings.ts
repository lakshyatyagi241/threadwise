import { settingsTile } from '../_registry/settings-types';

/** The workspace's own AI provider keys left the menu for Settings (AI usage stays a menu entry). */
export const settings = [
  settingsTile({
    id: 'ai-keys',
    section: 'automation',
    href: '/ai-keys',
    icon: 'bot',
    order: 0,
    gates: { permission: 'aiadm.keys.read' },
  }),
];
