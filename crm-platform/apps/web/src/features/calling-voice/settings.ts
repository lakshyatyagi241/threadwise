import { settingsTile } from '../_registry/settings-types';

/**
 * Calling is a per-number switch, so it is a Settings tile (Channels) rather than a menu entry, like the other configuration
 * screens (the shell's menu keeps only screens people work in). Reference had it as a card on the WABA health page.
 */
export const settings = [
  settingsTile({
    id: 'calling',
    section: 'channels',
    href: '/calling',
    icon: 'phone',
    order: 15,
    labelKey: 'calling-voice.nav.title',
    descriptionKey: 'calling-voice.nav.description',
    keywordsKey: 'calling-voice.nav.keywords',
    gates: { permission: 'call.calls.use', planFeature: 'waba_calling' },
  }),
];
