import type { NavItem } from '../_registry/types';

/**
 * Call logs (TW-CALL-022) sit in the Inbox & Chat group where Reference's menu had them, between Quick chat and Team chat. The analytics
 * page is a tab of the same screen, so it has no entry of its own. Only the permission gates it (BL-257): the log holds every call, not
 * only WhatsApp calls, so a workspace without the plan feature `waba_calling` that logs calls by hand, from the mobile app or from a
 * telephony provider still opens it (the screen leaves out what is WhatsApp's). A missing permission removes the entry. The route
 * guard follows: the paywall sheet reads its gates from this list, so a plan feature here would lock the screen as well.
 */
export const nav: NavItem[] = [
  {
    id: 'call-logs',
    group: 'inbox',
    labelKey: 'calling-voice.nav.callLogs',
    href: '/call-logs',
    order: 20,
    icon: 'phone',
    gates: { permission: 'call.logs.read' },
  },
];
