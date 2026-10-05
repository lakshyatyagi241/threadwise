import { settingsTile } from '../_registry/settings-types';

/** Geta publishing credentials (an addition beyond WaDesk): Publish in the flow builder also pushes the bot live on the Geta console. */
export const settings = [
  settingsTile({
    id: 'geta-publishing',
    section: 'integrations',
    href: '/flows/geta-publishing',
    icon: 'key',
    order: 40,
    gates: { permission: 'flb.geta.manage', planFeature: 'automation' },
  }),
];
