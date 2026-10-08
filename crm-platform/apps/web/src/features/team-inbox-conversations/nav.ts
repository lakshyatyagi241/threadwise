import type { NavItem } from '../_registry/types';

/** The Team Inbox entry in Inbox & Chat (first in its group, as in WaDesk). Needs the right to read conversations. */
export const nav: NavItem[] = [
  {
    id: 'inbox',
    group: 'inbox',
    labelKey: 'team-inbox-conversations.nav.inbox',
    href: '/inbox',
    order: 0,
    icon: 'inbox',
    // The number of conversations with unread messages, live on every page (provided by `InboxNavCounts`, mounted in the app layout).
    counter: 'inbox-unread',
    gates: { permission: 'inbox.conversation.read' },
  },
];
