import type { NavItem } from '../_registry/types';

/**
 * One menu entry in Inbox & Chat (TW-TCHAT-030). Reference showed it to the manager tier and up; here any staff user is a chat
 * member, so every role holds `tchat.chat.use` (migration 20270203090100). The key exists so a workspace can be configured without the
 * menu entry: a migrated Waboo workspace never had team chat and is denied it (tools/migration access/module-ceiling.ts, team-chat).
 */
export const nav: NavItem[] = [
  {
    id: 'team-chat',
    group: 'inbox',
    labelKey: 'team-chat.nav.teamChat',
    href: '/team-chat',
    order: 30,
    icon: 'team-chat',
    gates: { permission: 'tchat.chat.use' },
  },
];
