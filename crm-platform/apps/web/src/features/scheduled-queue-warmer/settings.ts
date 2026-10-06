import { settingsTile } from '../_registry/settings-types';

/** The warmer prepares a WhatsApp number for sending, so it sits with the channels instead of in the Campaigns group (see `nav.ts`). */
export const settings = [
  settingsTile({
    id: 'warmer',
    section: 'channels',
    href: '/warmer',
    icon: 'whatsapp',
    order: 15,
    gates: { permission: 'sched.warmer.manage', app: 'unofficial_whatsapp' },
  }),
];
