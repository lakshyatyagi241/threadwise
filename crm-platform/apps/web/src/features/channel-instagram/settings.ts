import { settingsTile } from '../_registry/settings-types';

/**
 * Reference showed Instagram accounts among the channels on the devices screen and had no entry of its own. The port gives the channel
 * a hub where accounts are linked and unlinked (the same rows and dialog), listed in Settings > Channels.
 */
export const settings = [
  settingsTile({
    id: 'instagram',
    section: 'channels',
    href: '/instagram',
    icon: 'instagram',
    order: 30,
    gates: { permission: 'ig.accounts.read', planFeature: 'extra_channels' },
  }),
];
