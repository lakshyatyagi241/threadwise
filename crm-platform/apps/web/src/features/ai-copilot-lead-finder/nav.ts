import type { NavItem } from '../_registry/types';

/** "AI CRM Copilot" in Reference's AI group. Lead Finder, the domain's other feature, already has its own
 * "coming soon" entry in `_registry/planned.ts` and is not duplicated here. */
export const nav: NavItem[] = [
  {
    id: 'ai-crm',
    group: 'sales',
    labelKey: 'ai-copilot-lead-finder.nav.aiCrm',
    href: '/ai-crm',
    order: 10,
    icon: 'bot',
    gates: { permission: 'aicrm.copilot.use', planFeature: 'ai_crm_copilot' },
  },
];
