import type { NavItem } from '../_registry/types';
import { WABA_CHANNEL } from './lib/channels';

/**
 * "Meta Groups" under Campaigns (WaDesk: tier admin, tagged `waba`): only while the workspace has a connected WhatsApp Business number
 * (`gates.channel`, filled by the app layout from the connected numbers), only with `waba.groups.read`, and locked with the upgrade mark
 * on a plan without `waba_groups` (owner decision 2026-10-08: a plan feature, not in every plan; WaDesk had no plan gate).
 * Spec: docs/specs/waba-groups-management.md section 14.
 */
export const nav: NavItem[] = [
  {
    id: 'waba-groups',
    group: 'campaigns',
    labelKey: 'whatsapp-cloud-api-waba.nav.groups',
    href: '/waba-groups',
    order: 50,
    icon: 'groups',
    gates: { permission: 'waba.groups.read', channel: WABA_CHANNEL, planFeature: 'waba_groups' },
  },
];
