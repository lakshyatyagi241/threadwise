import { settingsTile, type SettingsSection, type SettingsTile } from './settings-types';

/**
 * Settings screens Reference has (or a small business needs) that this app has not built yet. They show as disabled "Soon"
 * tiles so the shape of the product is visible from day one. This file is the one place they are listed.
 *
 * To switch one on: build the screen, declare a `SettingsTile` with the same `id` in your domain's `settings.ts` (the label,
 * description and gates are then yours), and delete the entry here. Until you delete it, the real tile already wins (see
 * `mergePlanned`), so the two never both show.
 *
 * Copy lives in `messages/<locale>/settings.json` under `settings.tiles.<id>`, in the Settings area's own namespace, because
 * no domain owns these screens yet. `icon` names are defined in `features/settings-hub/settings-icons.tsx`.
 */
const tile = (
  section: SettingsSection,
  id: string,
  href: string,
  icon: string,
  order: number,
): SettingsTile => settingsTile({ id, section, href, icon, order });

export const PLANNED_SETTINGS: readonly SettingsTile[] = [
  // Channels (these were the menu's Channels group)
  tile('channels', 'channels', '/channels', 'channels', 0),
  tile('channels', 'tiktok', '/channels/tiktok', 'tiktok', 50),
  tile('channels', 'line', '/line', 'chat', 80),
  tile('channels', 'viber', '/viber', 'phone', 90),
  tile('channels', 'wechat', '/wechat', 'team-chat', 100),
  tile('channels', 'wa-links', '/wa-links', 'link', 110),

  // Data and customization
  tile('data', 'tags', '/tags', 'tag', 40),
  tile('data', 'saved-replies', '/saved-replies', 'reply', 50),

  // Automation and AI
  tile('automation', 'auto-reply', '/auto-reply', 'reply', 20),

  // Integrations and developer (these were the menu's Developer group)
  // Integrations is now the Marketplace tile (features/marketplace/settings.ts).

  // Data and security
  tile('security', 'activity-log', '/activity-log', 'history', 20),
  tile('security', 'privacy', '/privacy', 'lock', 40),
];
