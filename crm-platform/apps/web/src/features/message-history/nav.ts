import type { NavItem } from '../_registry/types';

/**
 * Message History is campaign work (Reference lists it under Campaigns as "History", `/message-history`). It was a planned entry; the
 * real one takes its id and address, so `planned.ts` no longer lists it. Reference let only managers and above in
 * (`workspace.role:manager`); here that is the key `msg.history.read`, held by the Manager preset and above. There is no plan gate:
 * Reference had none either.
 */
export const nav: NavItem[] = [
  {
    id: 'history',
    group: 'campaigns',
    labelKey: 'message-history.nav.history',
    href: '/message-history',
    order: 40,
    icon: 'history',
    gates: { permission: 'msg.history.read' },
  },
];
