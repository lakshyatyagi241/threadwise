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
    // the hub starts AI agents, chatbots and workflows; it shows only on a plan with AI assistants (a WhatsApp-only plan keeps Flows)
    gates: { permission: 'flb.flows.read', planFeature: 'ai_assistants' },
  },
];
