import type { NavItem } from '../_registry/types';

/**
 * Call logs (TW-CALL-022) sit in the Inbox & Chat group where Reference's menu had them, between Quick chat and Team chat. The analytics
 * page is a tab of the same screen, so it has no entry of its own. A missing plan feature keeps the entry visible but locked (Reference's
 * rule); a missing permission removes it.
 */
export const nav: NavItem[] = [
  {
    id: 'call-logs',
    group: 'inbox',
    labelKey: 'calling-voice.nav.callLogs',
    href: '/call-logs',
    order: 20,
    icon: 'phone',
    gates: { permission: 'call.logs.read', planFeature: 'waba_calling' },
  },
];
