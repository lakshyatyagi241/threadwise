import { buildZip } from './zip-writer';
import { CAPTURE_JS, PLUGIN_PHP, README_TXT } from './woo-plugin.template';

export const DEFAULT_CART_DELAY_MINUTES = 30;
const MIN_DELAY = 5;
const MAX_DELAY = 1440;

export interface WooPluginSettings {
  /** The brand shown in the plugin's name, header and texts. */
  brandName: string;
  /** This store's webhook address (it already carries the store's secret in its path). */
  webhookUrl: string;
  /** The store's webhook secret: the key the plugin signs every delivery with. */
  webhookSecret: string;
  /** How long a cart sits idle before it counts as abandoned. */
  cartDelayMinutes?: number;
}

export interface WooPluginZip {
  /** `<brand-slug>-woocommerce.zip` */
  filename: string;
  zip: Buffer;
}

/** `Acme Shop!` -> `acme-shop`: lower case letters and digits joined by single hyphens, never empty. */
export function brandSlug(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return slug === '' ? 'store' : slug;
}

/** A PHP identifier fragment from the slug: `acme-shop` -> `acme_shop`, and never starting with a digit. */
function identOf(slug: string): string {
  const ident = slug.replace(/-/g, '_');
  return /^[0-9]/.test(ident) ? `b${ident}` : ident;
}

/** A value inside a PHP single-quoted string. */
const phpString = (v: string): string => v.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/** One line, safe inside a block comment and the header, without the braces that would look like a token. */
const headerText = (v: string): string =>
  Array.from(v, (ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? ' ' : ch))
    .join('')
    .replace(/\*\//g, ' ')
    .replace(/[{}]/g, '')
    .trim();

const TOKEN = /\{\{([A-Z_]+)\}\}/g;

/** Replaces every token in one pass (so a value that looks like a token is never expanded) and refuses an unknown one. */
export function fill(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(TOKEN, (_m, key: string) => {
    const v = values[key];
    if (v === undefined) throw new Error(`Unknown plugin token ${key}`);
    return v;
  });
}

/** The plugin zip for one store: a folder named after the brand, holding the plugin file, its checkout script and a readme. */
export function generateWooPlugin(settings: WooPluginSettings): WooPluginZip {
  const name = headerText(settings.brandName) || 'Store';
  const slug = brandSlug(name);
  const delayRaw = Math.trunc(settings.cartDelayMinutes ?? DEFAULT_CART_DELAY_MINUTES);
  const delay = Math.min(MAX_DELAY, Math.max(MIN_DELAY, Number.isFinite(delayRaw) ? delayRaw : 30));
  const values: Record<string, string> = {
    BRAND_NAME: name,
    BRAND_NAME_PHP: phpString(name),
    BRAND_SLUG: slug,
    BRAND_IDENT: identOf(slug),
    WEBHOOK_URL_PHP: phpString(settings.webhookUrl),
    WEBHOOK_SECRET_PHP: phpString(settings.webhookSecret),
    CART_DELAY_MINUTES: String(delay),
  };
  const dir = `${slug}-woocommerce`;
  const zip = buildZip([
    { name: `${dir}/${dir}.php`, data: Buffer.from(fill(PLUGIN_PHP, values), 'utf8') },
    {
      name: `${dir}/assets/checkout-capture.js`,
      data: Buffer.from(fill(CAPTURE_JS, values), 'utf8'),
    },
    { name: `${dir}/readme.txt`, data: Buffer.from(fill(README_TXT, values), 'utf8') },
  ]);
  return { filename: `${dir}.zip`, zip };
}
