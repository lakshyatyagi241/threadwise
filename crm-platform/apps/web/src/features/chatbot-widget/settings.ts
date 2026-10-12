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
  // Website chat bots built in the flow builder, beside the other channels (their widgets are listed here, not edited).
  settingsTile({
    id: 'web',
    section: 'channels',
    href: '/channels/web',
    icon: 'globe',
    order: 25,
    gates: { permission: 'flb.flows.read' },
  }),
];
