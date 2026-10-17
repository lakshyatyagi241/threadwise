/**
 * Which Marketplace listing sells each plan feature that an app owns (the listing's `grantsPlanFeatures`). The lock screens use it to send a
 * workspace that lacks the feature straight to the app's page, where it can subscribe and install, instead of to the Marketplace home.
 *
 * It lists only listings that exist in the catalogue (migrations 20261023090200, 20261031100200, 20261118100100, 20261228090000 and
 * 20261228090100); the listing itself decides whether the workspace can see, buy or install it.
 */
export const APP_LISTING_BY_FEATURE: Readonly<Record<string, string>> = {
  appointment_booking: 'appointments',
  form_builder: 'forms',
  email_channel: 'email',
  lead_scoring: 'lead-scoring',
  ai_crm_copilot: 'ai-crm-copilot',
  chatbot_widgets: 'chatbot-widget',
  help_agent: 'help-assistant',
  wa_storefront: 'whatsapp-catalog',
  waba_groups: 'whatsapp-groups',
  sms: 'sms',
};

/** The Marketplace page of the app that owns the plan feature, or null when no app does. */
export function listingPathFor(feature: string): string | null {
  const slug = APP_LISTING_BY_FEATURE[feature];
  return slug ? `/marketplace/app/${slug}` : null;
}
