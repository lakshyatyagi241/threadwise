import type { MarketInstallStatus } from '@crm/contracts';

/**
 * Where an installed app lives in the product: the screen its Open link goes to. The listing is data in the catalogue; the screen is
 * code in this app, so the map is here, next to the Marketplace screens that use it. An app that is not listed has no screen of its own
 * (the Chrome extension lives in the browser, a lead portal feeds the lead sources): it gets no Open link, only Manage.
 *
 * The link is a convenience, not a gate. The screen applies its own gates (permission, plan feature, `gates.app`) when it opens.
 */
export const APP_HOME: Readonly<Record<string, string>> = {
  appointments: '/appointments',
  forms: '/forms',
  email: '/email',
  sms: '/sms',
  'lead-scoring': '/lead-scoring',
  'ai-crm-copilot': '/ai-crm',
  'chatbot-widget': '/chatbot-widgets',
  'help-assistant': '/settings/help-assistant',
  'whatsapp-catalog': '/catalog',
  'whatsapp-groups': '/waba-groups',
  'whatsapp-devices': '/devices',
  'meta-lead-forms': '/lead-sources',
  'google-sheets': '/google-sheets-addon',
};

/** The screen of an installed app, or null when it has none or the installation is not running (a paused or killed app is not opened). */
export function appHomeFor(slug: string, status: MarketInstallStatus): string | null {
  return status === 'active' ? (APP_HOME[slug] ?? null) : null;
}
