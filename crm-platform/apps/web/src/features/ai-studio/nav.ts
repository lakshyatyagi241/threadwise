import type { NavItem } from '../_registry/types';

/** The AI Studio landing: one place to start an AI agent, a chatbot or a workflow. First entry of the Automation group. */
export const nav: NavItem[] = [
  {
    id: 'ai-studio',
    group: 'automation',
    labelKey: 'aiStudio.nav.studio',
    href: '/ai-studio',
    order: -1,
    icon: 'bot',
    // its own key (a migrated Waboo workspace never had this page and is denied it); Flows keeps `flb.flows.read`
    gates: { permission: 'flb.ai_studio.read', planFeature: 'automation' },
  },
];
