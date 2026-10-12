import { settingsTile } from '../_registry/settings-types';

/**
 * The workspace switch of the Help assistant (docs/specs/help-agent-assistant.md section 6.1). Needs the plan feature (locked without it)
 * and the `help.agent.manage` permission (hidden without it).
 */
export const settings = [
  settingsTile({
    id: 'help-assistant',
    section: 'automation',
    href: '/settings/help-assistant',
    icon: 'sliders',
    order: 70,
    gates: { permission: 'help.agent.manage', planFeature: 'help_agent' },
  }),
];
