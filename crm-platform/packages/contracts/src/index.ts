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
export * from './crm/contact-timezone';
export * from './crm/contact-assignment';
export * from './crm/crm-dashboard';
export * from './crm/revenue-report';
export * from './crm/contact-activity';
export * from './crm/contact-file';
export * from './crm/contact-meeting';
export * from './crm/contact-note';
export * from './crm/contact-store-order';
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
export * from './channel-line';
export * from './channel-viber';
export * from './channel-sms';
export * from './help-agent';
export * from './channel-email';
export * from './email-templates';
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
export * from './ai-agents-training';
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
export * from './webhook-fanout';
export * from './whatsapp-cloud-api-waba';
export * from './message-templates';
export * from './node-bridge-runtime';
export * from './whatsapp-devices-baileys';
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
export * from './checkout-orders-merchant-payments';
export * from './calling-voice';
export * from './flow-runtime-engine';
export * from './flow-builder-editor';
export * from './scheduled-queue-warmer';
export * from './marketplace';
export * from './leads';
export * from './meta-lead-ads';
export * from './developer-rest-api-v1';
export * from './outbound-webhooks';
export * from './forms-builder';
export * from './forms-links-groups';
export * from './ai-copilot-lead-finder';
export * from './chrome-extension-sheets-addon';
export * from './google-account';
export * from './api-library';
export * from './faq-knowledge';
export * from './lead-scoring';
export * from './growth';
export * from './contact-consent';
export * from './privacy';
export * from './compliance';
export * from './waboo-migration';
export * from './channel-wechat';
