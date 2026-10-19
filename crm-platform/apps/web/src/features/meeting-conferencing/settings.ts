import { settingsTile } from '../_registry/settings-types';

/**
 * Video meetings (BL-360): where a person connects their own Zoom or Microsoft Teams account, once the workspace has installed the
 * integration from the Marketplace. A tile under Integrations, shown in the Marketplace's Integrations tab like the Google account. The
 * page needs the key the Add meeting form needs, `record.contacts.update`, because the connection exists to make links for meetings.
 * Copy lives in `messages/<locale>/meeting-conferencing.json` under `settings.tiles.video-meetings`.
 */
export const settings = [
  settingsTile({
    id: 'video-meetings',
    section: 'integrations',
    href: '/settings/video-meetings',
    icon: 'calendar',
    order: 59,
    gates: { permission: 'record.contacts.update' },
  }),
];
