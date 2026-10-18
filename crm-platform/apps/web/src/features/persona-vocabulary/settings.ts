import { settingsTile } from '../_registry/settings-types';

/**
 * Words we use (BL-310, dynamic object naming; a product extension, no Reference screen): the names this workspace gives a contact, an
 * appointment, a deal and a meeting. A tile under Business for people who may manage workspace settings. Copy lives in
 * `messages/<locale>/persona-vocabulary.json` under `persona-vocabulary.tile`.
 */
export const settings = [
  settingsTile({
    id: 'workspace-words',
    section: 'business',
    href: '/workspace-words',
    icon: 'tag',
    order: 20,
    labelKey: 'persona-vocabulary.tile.label',
    descriptionKey: 'persona-vocabulary.tile.description',
    keywordsKey: 'persona-vocabulary.tile.keywords',
    gates: { permission: 'admin.settings.manage' },
  }),
];
