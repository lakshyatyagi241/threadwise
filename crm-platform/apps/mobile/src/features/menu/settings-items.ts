import type { Href } from 'expo-router';
import type { IconName } from '@/components/ui/icon';

/** The permission of a line every signed-in person may open (the team members list has no right of its own, as on the web). */
export const OPEN = '';

export interface SettingsItem {
  key: string;
  /** The text key of the line's name. */
  label:
    | 'settings.quickReplies.title'
    | 'inbox.filter.labels'
    | 'settings.businessHours.title'
    | 'settings.routing.title'
    | 'settings.members.title'
    | 'settings.teams.title';
  icon: IconName;
  href: Href;
  /** The right that opens it (`OPEN`: everyone). */
  permission: string;
}

/**
 * What the Settings page lists: the workspace's own setup. Each line opens with the right that manages it; the Settings row of the
 * menu is faded only when none of them opens.
 */
export const SETTINGS_ITEMS: readonly SettingsItem[] = [
  {
    key: 'savedReplies',
    label: 'settings.quickReplies.title',
    icon: 'arrow-undo-outline',
    href: '/quick-replies',
    permission: 'inbox.savedreply.manage',
  },
  {
    key: 'labels',
    label: 'inbox.filter.labels',
    icon: 'pricetag-outline',
    href: '/labels',
    permission: 'inbox.tag.manage',
  },
  {
    key: 'businessHours',
    label: 'settings.businessHours.title',
    icon: 'time-outline',
    href: '/business-hours',
    permission: 'inbox.settings.read',
  },
  {
    key: 'autoAssignment',
    label: 'settings.routing.title',
    icon: 'person-add-outline',
    href: '/auto-assignment',
    permission: 'inbox.settings.read',
  },
  {
    key: 'members',
    label: 'settings.members.title',
    icon: 'people-outline',
    href: '/members',
    permission: OPEN,
  },
  {
    key: 'teams',
    label: 'settings.teams.title',
    icon: 'people-circle-outline',
    href: '/teams',
    permission: OPEN,
  },
];
