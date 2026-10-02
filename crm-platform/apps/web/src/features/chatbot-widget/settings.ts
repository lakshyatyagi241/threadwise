import { settingsTile } from '../_registry/settings-types';

/** The website chat widget (web chat) left the menu for Settings (Automation and AI). */
export const settings = [
  settingsTile({
    id: 'chat-widget',
    section: 'automation',
    href: '/chatbot-widgets',
    icon: 'widget',
    order: 30,
    gates: { permission: 'wgt.widgets.read' },
  }),
];
