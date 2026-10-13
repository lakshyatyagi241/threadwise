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
    gates: { permission: 'flb.flows.read', planFeature: 'automation' },
  },
];
