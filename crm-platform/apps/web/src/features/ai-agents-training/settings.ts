import { settingsTile } from '../_registry/settings-types';

/** AI Training (trained chat assistants and their knowledge) is reached from Settings, Automation and AI. */
export const settings = [
  settingsTile({
    id: 'ai-training',
    section: 'automation',
    href: '/ai-training',
    icon: 'bot',
    order: 5,
    gates: { permission: 'aiag.training.read', planFeature: 'ai_assistants' },
  }),
];
