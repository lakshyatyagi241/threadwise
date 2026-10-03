/**
 * @crm/contracts — the single source of truth for every shape that crosses the
 * network boundary.
 *
 * Rules:
 *  - Zod schema first, TypeScript type inferred from it. Never the reverse.
 *  - API payloads are camelCase; the database is snake_case. The mapping lives
 *    in the API repository layer, not here.
 *  - Internal bigint ids never appear. Every identifier on the wire is a uuid.
 */
export * from './common/ids';
export * from './common/pagination';
export * from './common/errors';
export * from './common/enums';
export * from './common/dates';
export * from './crm/contact';
export * from './crm/contact-activity';
export * from './crm/contact-file';
export * from './crm/contact-meeting';
export * from './crm/contact-note';
export * from './crm/contact-view';
export * from './crm/field-metadata';
export * from './crm/tag';
export * from './partner/partner-agent';
export * from './public/lead-read';
export * from './admin/user';
export * from './admin/role';
export * from './auth-registration-security';
export * from './plans-subscriptions-trials';
export * from './contacts-attributes-tags';
export * from './broadcasts';
export * from './channel-telegram';
export * from './channel-facebook';
export * from './channel-instagram';
export * from './shopify-woocommerce';
export * from './deals-pipelines';
export * from './tasks';
export * from './companies';
export * from './platform-settings-branding-storage';
export * from './localization-translation';
export * from './install-update-licensing';
// Settings and the installer each define isValidTimezone; the installer's also checks the name's shape and length.
export { isValidTimezone } from './install-update-licensing';
export * from './addons-extension-registry';
export * from './platform-support-desk';
export * from './ai-keys-usage-admin';
export * from './marketing-site-cms';
export * from './admin-console-shell';
export * from './dashboards-analytics-charts';
export * from './platform-payment-gateways';
export * from './bsp-billing-engine';
export * from './wallet-message-billing';
export * from './team-chat';
export * from './segments';
export * from './sales-docs';
export * from './invoicing';
export * from './appointments';
export * from './notifications-activity-audit';
export * from './chatbot-widget';
export * from './roles-permissions';
export * from './whatsapp-cloud-api-waba';
export * from './message-templates';
export * from './node-bridge-runtime';
export * from './realtime';
export * from './chat-conversations';
export * from './team-inbox-conversations';
export * from './team-inbox-routing-sla';
export * from './campaigns';
export * from './workspaces-teams-tenancy';
export * from './whatsapp-providers';
export * from './coupons-credits-referral-currency';
export * from './catalog-products';
export * from './storefront-builder';
export * from './calling-voice';
export * from './flow-runtime-engine';
export * from './scheduled-queue-warmer';
export * from './marketplace';
export * from './leads';
