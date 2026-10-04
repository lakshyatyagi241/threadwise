import type { NavItem } from '../_registry/types';

/**
 * One menu entry in Inbox & Chat (WD-TCHAT-030). WaDesk showed it to the manager tier and up; here any staff user is a chat
 * member, so it carries no permission gate (the tier was a menu rule only: the route itself had no role check).
 */
export const nav: NavItem[] = [
  {
    id: 'team-chat',
    group: 'inbox',
    labelKey: 'team-chat.nav.teamChat',
    href: '/team-chat',
    order: 30,
    icon: 'team-chat',
  },
];
