import { z } from 'zod';

/**
 * Quick access (TW-ASHELL-022): each person pins up to ten shortcuts, catalogue pages or their own links. They show as tiles
 * on the dashboard and in the edge drawer, and one editor changes both.
 */
export const QUICK_ACCESS_MAX = 10;
export const QUICK_ACCESS_LABEL_MAX = 40;
export const QUICK_ACCESS_URL_MAX = 255;

export interface QuickAccessCatalogEntry {
  key: string;
  label: string;
  desc: string;
  /** Where the page lives in this app. */
  url: string;
  icon: string;
}

/** The 20 pinnable pages, in Reference's order, pointing at this app's screens. */
export const QUICK_ACCESS_CATALOG: readonly QuickAccessCatalogEntry[] = [
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
    desc: 'Your audience and their details',
    url: '/contacts',
    icon: 'contacts',
  },
  {
    key: 'campaigns',
    label: 'Campaigns',
    desc: 'Plan and send campaigns',
    url: '/campaigns',
    icon: 'campaign',
  },
  {
    key: 'broadcasts',
    label: 'Broadcasts',
    desc: 'Send one message to many contacts',
    url: '/broadcasts',
    icon: 'broadcast',
  },
  {
    key: 'templates',
    label: 'Templates',
    desc: 'Approved message templates',
    url: '/templates',
    icon: 'template',
  },
  { key: 'flows', label: 'Flows', desc: 'Automate conversations', url: '/flows', icon: 'flow' },
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
    desc: 'Products you sell on WhatsApp',
    url: '/catalog',
    icon: 'catalog',
  },
  {
    key: 'store',
    label: 'Store',
    desc: 'Your storefront and orders',
    url: '/store',
    icon: 'store',
  },
  { key: 'deals', label: 'Sales Pipeline', desc: 'Deals by stage', url: '/deals', icon: 'deal' },
  {
    key: 'analytics',
    label: 'Analytics',
    desc: 'Delivery and response numbers',
    url: '/analytics',
    icon: 'analytics',
  },
  {
    key: 'auto-reply',
    label: 'Auto Reply',
    desc: 'Keyword and out-of-hours replies',
    url: '/auto-reply',
    icon: 'reply',
  },
  {
    key: 'devices',
    label: 'Devices',
    desc: 'Connected WhatsApp numbers',
    url: '/channels/whatsapp',
    icon: 'phone',
  },
  {
    key: 'chatbots',
    label: 'Chat Widgets',
    desc: 'Chat widget for your website',
    url: '/chatbot-widgets',
    icon: 'chat',
  },
  {
    key: 'ai',
    label: 'AI Assistants',
    desc: 'Assistants that answer for you',
    url: '/ai-assistants',
    icon: 'bot',
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
    desc: 'Send events to other systems',
    url: '/webhooks',
    icon: 'link',
  },
  {
    key: 'history',
    label: 'Message Log',
    desc: 'Every message sent and received',
    url: '/message-history',
    icon: 'history',
  },
  {
    key: 'account',
    label: 'Account',
    desc: 'Profile, plan and wallet',
    url: '/account/profile',
    icon: 'user',
  },
  { key: 'more', label: 'More apps', desc: 'Every tool in one page', url: '/more', icon: 'grid' },
];

/** What a person who never customised sees (Reference's ten). */
export const QUICK_ACCESS_DEFAULT_KEYS: readonly string[] = [
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
];

export type QuickAccessEntry = { key: string } | { label: string; url: string };

const CATALOG_KEYS = new Set(QUICK_ACCESS_CATALOG.map((c) => c.key));

/**
 * A custom link is an address inside this app (one leading slash) or an http(s) address. Reference also let `//host` through,
 * which is an external address wearing a path's clothes; it is refused here, as is `/\host`.
 */
export function isSafeShortcutUrl(url: string): boolean {
  if (/^https?:\/\/\S/i.test(url)) return true;
  // A browser drops tab, CR and LF from a URL before parsing it, so "/\n/evil.com" is "//evil.com".
  return url.startsWith('/') && !/^\/[\t\r\n]*[\\/]/.test(url);
}

/** Reference's sanitiser: anything that is not an array is empty; unknown keys and unsafe or blank links are dropped; ten at most. */
export function sanitizeQuickAccess(input: unknown): QuickAccessEntry[] {
  if (!Array.isArray(input)) return [];
  const out: QuickAccessEntry[] = [];
  for (const raw of input) {
    if (out.length >= QUICK_ACCESS_MAX) break;
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.key === 'string' && CATALOG_KEYS.has(r.key)) {
      out.push({ key: r.key });
      continue;
    }
    if (typeof r.label !== 'string' || typeof r.url !== 'string') continue;
    const label = r.label.trim().slice(0, QUICK_ACCESS_LABEL_MAX);
    const url = r.url.trim().slice(0, QUICK_ACCESS_URL_MAX);
    if (label && url && isSafeShortcutUrl(url)) out.push({ label, url });
  }
  return out;
}

export const quickAccessTileSchema = z.object({
  key: z.string().nullable(),
  label: z.string(),
  desc: z.string(),
  url: z.string(),
  icon: z.string(),
  custom: z.boolean(),
});
export type QuickAccessTile = z.infer<typeof quickAccessTileSchema>;

export const quickAccessResponseSchema = z.object({ tiles: z.array(quickAccessTileSchema) });
export type QuickAccessResponse = z.infer<typeof quickAccessResponseSchema>;

export const saveQuickAccessRequestSchema = z.object({ items: z.array(z.unknown()).max(200) });
export type SaveQuickAccessRequest = z.infer<typeof saveQuickAccessRequestSchema>;

/**
 * The tiles to draw. An empty or missing list is "not customised" and gives the ten defaults (Reference: nobody can end with
 * zero shortcuts). Saved entries that no longer resolve are skipped.
 */
export function resolveQuickAccess(saved: unknown): QuickAccessTile[] {
  const entries = sanitizeQuickAccess(saved);
  const list: QuickAccessEntry[] = entries.length
    ? entries
    : QUICK_ACCESS_DEFAULT_KEYS.map((key) => ({ key }));
  const byKey = new Map(QUICK_ACCESS_CATALOG.map((c) => [c.key, c]));
  const tiles: QuickAccessTile[] = [];
  for (const e of list) {
    if ('key' in e) {
      const c = byKey.get(e.key);
      if (c)
        tiles.push({
          key: c.key,
          label: c.label,
          desc: c.desc,
          url: c.url,
          icon: c.icon,
          custom: false,
        });
    } else {
      tiles.push({
        key: null,
        label: e.label,
        desc: e.url,
        url: e.url,
        icon: 'link',
        custom: true,
      });
    }
  }
  return tiles;
}
