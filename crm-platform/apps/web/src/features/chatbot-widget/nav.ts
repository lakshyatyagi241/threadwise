import type { NavItem } from '../_registry/types';

/** `id` matches the planned "chat-widget" entry, so the real item replaces the "coming soon" one. */
export const nav: NavItem[] = [
  {
    id: 'chat-widget',
    group: 'automation',
    labelKey: 'chatbotWidget.nav.title',
    href: '/chatbot-widgets',
    order: 40,
    icon: 'widget',
    gates: { permission: 'wgt.widgets.read' },
  },
];
