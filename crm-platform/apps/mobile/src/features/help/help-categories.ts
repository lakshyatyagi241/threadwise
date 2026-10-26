import type { IconName } from '@/components/ui/icon';
import type { HelpCategory } from './help-data';

/** The name of each group of guides, as an app message key (the menu's own words are reused where the group is a screen). */
export const CATEGORY_TITLE = {
  'getting-started': 'help.categories.gettingStarted',
  dashboard: 'menu.dashboard',
  inbox: 'menu.inbox',
  contacts: 'menu.contacts',
  settings: 'menu.settings',
  account: 'menu.sectionAccount',
  troubleshooting: 'help.categories.troubleshooting',
} as const satisfies Record<HelpCategory, string>;

export const CATEGORY_ICON = {
  'getting-started': 'rocket-outline',
  dashboard: 'grid-outline',
  inbox: 'chatbubbles-outline',
  contacts: 'people-outline',
  settings: 'settings-outline',
  account: 'person-circle-outline',
  troubleshooting: 'build-outline',
} as const satisfies Record<HelpCategory, IconName>;
