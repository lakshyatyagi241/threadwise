import { settingsTile } from '../_registry/settings-types';

/** The list of results a person picks when completing a task ("Interested", "Left message", ...) is a Settings tile. */
export const settings = [
  settingsTile({
    id: 'task-outcomes',
    shortcutFrom: ['/tasks'],
    section: 'data',
    href: '/tasks/outcomes',
    icon: 'tasks',
    order: 40,
    gates: { permission: 'settings.task_outcomes.manage' },
  }),
];
