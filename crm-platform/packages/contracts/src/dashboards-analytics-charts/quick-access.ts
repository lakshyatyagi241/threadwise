import { z } from 'zod';

/**
 * Quick-access shortcut tiles (TW-DASH-009): up to 10 per user, chosen from a fixed catalog of app pages plus optional custom links.
 * Stored on `user_settings.quick_access`; order is catalog order for ticked pages, then the custom rows (Reference has no reordering).
 */
export const DASH_QUICK_ACCESS_MAX = 10;

export const DASH_QUICK_ACCESS_CATALOG = [
  {
    key: 'inbox',
    label: 'Unified Inbox',
    desc: 'Every conversation in one place',
    url: '/inbox',
    icon: 'inbox',
  },
  {
    key: 'contacts',
    label: 'Contacts',
    desc: 'People, tags and groups',
    url: '/contacts',
    icon: 'users',
  },
  {
    key: 'campaigns',
    label: 'Campaigns',
    desc: 'Template campaigns and their results',
    url: '/campaigns',
    icon: 'megaphone',
  },
  {
    key: 'broadcasts',
    label: 'Broadcasts',
    desc: 'Send one message to many contacts',
    url: '/broadcasts',
    icon: 'send',
  },
  {
    key: 'templates',
    label: 'Templates',
    desc: 'Approved WhatsApp message templates',
    url: '/templates',
    icon: 'file-text',
  },
  { key: 'flows', label: 'Flows', desc: 'Automation flows', url: '/flows', icon: 'workflow' },
  {
    key: 'scheduled',
    label: 'Scheduled',
    desc: 'Messages waiting to go out',
    url: '/scheduled',
    icon: 'clock',
  },
  {
    key: 'catalog',
    label: 'Catalog',
    desc: 'Products you can share in chat',
    url: '/catalog',
    icon: 'package',
  },
  { key: 'store', label: 'Store', desc: 'Your WhatsApp storefront', url: '/store', icon: 'store' },
  { key: 'deals', label: 'Sales Pipeline', desc: 'Deals by stage', url: '/deals', icon: 'kanban' },
  {
    key: 'analytics',
    label: 'Analytics',
    desc: 'Volume, delivery and engagement',
    url: '/analytics',
    icon: 'bar-chart',
  },
  {
    key: 'auto-reply',
    label: 'Auto-reply',
    desc: 'Keyword and away replies',
    url: '/auto-reply',
    icon: 'reply',
  },
  {
    key: 'devices',
    label: 'Devices',
    desc: 'Connected WhatsApp numbers',
    url: '/channels',
    icon: 'smartphone',
  },
  {
    key: 'chatbots',
    label: 'Chat Widgets',
    desc: 'Website chat widgets',
    url: '/chatbot-widgets',
    icon: 'message-circle',
  },
  {
    key: 'ai',
    label: 'AI Assistants',
    desc: 'Assistants that answer for you',
    url: '/ai-assistants',
    icon: 'sparkles',
  },
  {
    key: 'appointments',
    label: 'Appointments',
    desc: 'Bookings and availability',
    url: '/appointments',
    icon: 'calendar',
  },
  {
    key: 'webhooks',
    label: 'Webhooks',
    desc: 'Send events to your own systems',
    url: '/webhooks',
    icon: 'webhook',
  },
  {
    key: 'history',
    label: 'Message Log',
    desc: 'Every message sent and received',
    url: '/message-history',
    icon: 'list',
  },
  {
    key: 'account',
    label: 'Account',
    desc: 'Profile, plan and billing',
    url: '/account',
    icon: 'user',
  },
  {
    key: 'more',
    label: 'More apps',
    desc: 'Everything else in the workspace',
    url: '/more',
    icon: 'grid',
  },
] as const;

/** What a user who never customised sees. */
export const DASH_QUICK_ACCESS_DEFAULT_KEYS = [
  'inbox',
  'contacts',
  'campaigns',
  'broadcasts',
  'templates',
  'flows',
  'scheduled',
  'catalog',
  'deals',
  'analytics',
] as const;

export const quickAccessItemSchema = z.union([
  z.object({ key: z.string() }),
  z.object({ label: z.string(), url: z.string() }),
]);
export type QuickAccessItem = z.infer<typeof quickAccessItemSchema>;

/** The write body is deliberately lax: the server sanitises, as Reference does (a non-array becomes an empty list). */
export const quickAccessUpdateSchema = z.object({ items: z.unknown().optional() });
export type QuickAccessUpdate = z.infer<typeof quickAccessUpdateSchema>;

export const dashQuickAccessTileSchema = z.object({
  key: z.string().nullable(),
  label: z.string(),
  desc: z.string(),
  url: z.string(),
  icon: z.string(),
  custom: z.boolean(),
});
export type DashQuickAccessTile = z.infer<typeof dashQuickAccessTileSchema>;

export const dashQuickAccessResponseSchema = z.object({
  /** The saved selection, or the defaults when nothing (or an empty list) is saved. */
  items: z.array(quickAccessItemSchema),
  tiles: z.array(dashQuickAccessTileSchema),
});
export type DashQuickAccessResponse = z.infer<typeof dashQuickAccessResponseSchema>;
