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
    // The number of conversations with unread messages, live on every page (provided by `InboxNavCounts`, mounted in the app layout).
    counter: 'inbox-unread',
    gates: { permission: 'inbox.conversation.read' },
  },
  {
    // Reached from a Settings tile and from the delivery log dialog, so the sidebar does not list it; the gate still closes the route.
    id: 'inbox-message-logs',
    group: 'inbox',
    labelKey: 'team-inbox-conversations.nav.messageLogs',
    href: '/inbox/message-logs',
    order: 1,
    icon: 'inbox',
    inMenu: false,
    gates: { permission: 'inbox.logs.export' },
  },
  {
    // Reached from the Settings tile and from the composer's picker; the gate closes the route for roles that cannot manage replies.
    id: 'inbox-saved-replies',
    group: 'inbox',
    labelKey: 'team-inbox-conversations.nav.savedReplies',
    href: '/inbox/saved-replies',
    order: 2,
    icon: 'inbox',
    inMenu: false,
    gates: { permission: 'inbox.savedreply.manage' },
  },
];
