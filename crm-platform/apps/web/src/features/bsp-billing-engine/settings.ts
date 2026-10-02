import { settingsTile } from '../_registry/settings-types';

/** The workspace's own choice of who bills its messages: left the menu for Settings (Business and billing). */
export const settings = [
  settingsTile({
    id: 'bsp-billing-mode',
    section: 'business',
    href: '/billing-mode',
    icon: 'message-billing',
    order: 35,
    gates: { permission: 'bsp.billing.read' },
  }),
];
