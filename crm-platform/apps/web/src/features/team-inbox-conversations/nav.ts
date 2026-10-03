import type { NavItem } from '../_registry/types';

/** The Team Inbox entry in Inbox & Chat (first in its group, as in Reference). Needs the right to read conversations. */
export const nav: NavItem[] = [
  {
    id: 'inbox',
    group: 'inbox',
    labelKey: 'team-inbox-conversations.nav.inbox',
    href: '/inbox',
    order: 0,
    icon: 'inbox',
    fullWidth: true,
    gates: { permission: 'inbox.conversation.read' },
  },
];
