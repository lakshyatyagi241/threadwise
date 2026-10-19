import type { NavItem } from '../_registry/types';

/**
 * Call logs (TW-CALL-022) sit in the Inbox & Chat group where Reference's menu had them, between Quick chat and Team chat. The analytics
 * page is a tab of the same screen, so it has no entry of its own. Two gates: the log permission, and the voice (calling) feature of the
 * plan, `waba_calling`. A workspace without the feature does not see the entry and its routes are closed (`gates.app` removes the entry
 * and closes the address, it does not show a locked upsell); a missing permission removes it as before. This replaces BL-257, which
 * kept the screen open to workspaces that log calls by hand: the owner asked for the screen to follow the voice feature.
 */
export const nav: NavItem[] = [
  {
    id: 'call-logs',
    group: 'inbox',
    labelKey: 'calling-voice.nav.callLogs',
    href: '/call-logs',
    order: 20,
    icon: 'phone',
    gates: { permission: 'call.logs.read', app: 'waba_calling' },
  },
];
