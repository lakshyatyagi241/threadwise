/**
 * Pure helpers of the platform settings domain (TW-SET-011, 012, 016, 028, 030, 044, 045, 046), shared by the API and the
 * web app. No I/O: every function takes the settings it needs, so each is tested on its own.
 */

// --- TW-SET-011: brand identity ---------------------------------------------------------------

/** The platform name, or the product default when none is set. Never falls back to `.env` (as in Reference). */
export function brandName(appName: string | null | undefined, fallback = 'CRM Platform'): string {
  const t = (appName ?? '').trim();
  return t === '' ? fallback : t;
}

/** Brand name reduced to letters, upper-cased and cut to `n`; `SENDER` when nothing is left (example sender ids). */
export function brandToken(name: string, n = 6): string {
  const t = name
    .replace(/[^A-Za-z]/g, '')
    .toUpperCase()
    .slice(0, n);
  return t === '' ? 'SENDER' : t;
}

/**
 * Role mailbox for the brand: the saved `site.email_<prefix>`, else the support address, else `<prefix>@<domain>`
 * where the domain is the site domain, the request host or the app URL host (leading `www.` or `app.` removed).
 */
export function brandEmail(
  prefix: string,
  ctx: {
    roleEmails?: Record<string, string>;
    supportEmail?: string;
    siteDomain?: string;
    requestHost?: string;
    appUrl?: string;
  },
): string {
  const own = (ctx.roleEmails?.[prefix] ?? '').trim();
  if (own) return own;
  const support = (ctx.supportEmail ?? '').trim();
  if (support) return support;
  let host = (ctx.siteDomain ?? '').trim() || (ctx.requestHost ?? '').trim();
  if (!host && ctx.appUrl) host = /^https?:\/\/([^/?#]+)/i.exec(ctx.appUrl)?.[1] ?? '';
  host = host.replace(/:\d+$/, '').replace(/^(www|app)\./i, '');
  return `${prefix}@${host || 'example.com'}`;
}

/** `X-<Brand>-Signature` and its siblings: the brand name stripped to letters and digits (TW-SET-011 rule 4). */
export function webhookHeaderNames(name: string, fallback = 'CRM') {
  const tag = name.replace(/[^A-Za-z0-9]/g, '') || fallback;
  return {
    signature: `X-${tag}-Signature`,
    event: `X-${tag}-Event`,
    hookId: `X-${tag}-Hook-Id`,
  };
}

// --- TW-SET-012: platform message footer ------------------------------------------------------

export const FOOTER_MAX = 60;

/**
 * The footer to put on an outbound message. A workspace whose plan has `remove_branding` uses its OWN footer and never
 * falls back to the platform default; every other workspace gets the platform default. Blank means none.
 */
export function resolveBrandingFooter(o: {
  platformFooter: string;
  workspaceFooter?: string | null;
  hasRemoveBranding?: boolean;
}): string | null {
  const pick = o.hasRemoveBranding ? (o.workspaceFooter ?? '') : o.platformFooter;
  const t = pick.trim().slice(0, FOOTER_MAX);
  return t === '' ? null : t;
}

/** Appends `\n\n_<footer>_` once; unchanged when there is no footer or the body already ends with it. */
export function appendFooterToBody(body: string, footer: string | null): string {
  if (!footer) return body;
  const tail = `_${footer}_`;
  return body.endsWith(tail) ? body : `${body}\n\n${tail}`;
}

// --- TW-SET-046: timezone ---------------------------------------------------------------------

/** Legacy IANA aliases some runtimes reject, mapped to their canonical zone (TW-SET-046 rule 3). */
export const TIMEZONE_ALIASES: Record<string, string> = {
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Rangoon': 'Asia/Yangon',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Asia/Dacca': 'Asia/Dhaka',
  'Asia/Thimbu': 'Asia/Thimphu',
  'Asia/Ulan_Bator': 'Asia/Ulaanbaatar',
  'Asia/Chungking': 'Asia/Chongqing',
  'Asia/Harbin': 'Asia/Shanghai',
  'Asia/Ashkhabad': 'Asia/Ashgabat',
  'Asia/Ujung_Pandang': 'Asia/Makassar',
  'Asia/Macao': 'Asia/Macau',
  'Europe/Kiev': 'Europe/Kyiv',
  'Europe/Uzhgorod': 'Europe/Kyiv',
  'Europe/Zaporozhye': 'Europe/Kyiv',
  'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
  'America/Godthab': 'America/Nuuk',
  'Pacific/Ponape': 'Pacific/Pohnpei',
  'Pacific/Truk': 'Pacific/Chuuk',
};

function zoneWorks(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Canonical name of a zone, or `fallback` when the runtime does not know it. A blank value passes through. */
export function safeTimezone(tz: string | null | undefined, fallback = 'UTC'): string {
  const t = (tz ?? '').trim();
  if (t === '') return '';
  const mapped = TIMEZONE_ALIASES[t] ?? t;
  return zoneWorks(mapped) ? mapped : fallback;
}

/**
 * First valid zone of: explicit, workspace, user, platform default, then UTC. Invalid candidates are skipped, so a
 * stale value never breaks a page (TW-SET-046 rule 1).
 */
export function resolveTimezone(candidates: ReadonlyArray<string | null | undefined>): string {
  for (const c of candidates) {
    const s = safeTimezone(c, '');
    if (s !== '') return s;
  }
  return 'UTC';
}

// --- TW-SET-044: currency ---------------------------------------------------------------------

export interface CurrencyRow {
  code: string;
  symbol: string;
  /** Digits after the point. */
  precision: number;
  /** Units of this currency per 1 USD. */
  rate: string;
}

/** Fixed `,` thousands and `.` decimals, as Reference (no locale-specific separators). Amount and result are strings. */
export function formatMoney(amount: string | number, currency: CurrencyRow | null): string {
  const n = Number(amount);
  const precision = currency ? Math.min(8, Math.max(0, currency.precision)) : 2;
  const fixed = (Number.isFinite(n) ? n : 0).toFixed(precision);
  const [int, frac] = fixed.split('.');
  const body = `${int!.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${frac ? `.${frac}` : ''}`;
  if (!currency) return body;
  return `${currency.symbol || `${currency.code} `}${body}`;
}

/** `amount / fromRate * toRate`, 2 decimals (Reference ignores the target precision); a rate <= 0 returns the amount. */
export function convertCurrency(
  amount: string | number,
  fromRate: string | number,
  toRate: string | number,
): string {
  const n = Number(amount);
  const from = Number(fromRate);
  const to = Number(toRate);
  if (!Number.isFinite(n)) return '0.00';
  if (!(from > 0) || !Number.isFinite(to)) return n.toFixed(2);
  return ((n / from) * to).toFixed(2);
}

// --- TW-SET-045: locales ----------------------------------------------------------------------

export interface LocaleRow {
  code: string;
  name: string;
  nativeName: string;
  direction: 'ltr' | 'rtl';
}

export const directionFor = (code: string, registry: readonly LocaleRow[]): 'ltr' | 'rtl' =>
  registry.find((l) => l.code === code)?.direction ?? 'ltr';
export const isLocaleAvailable = (code: string, registry: readonly LocaleRow[]) =>
  registry.some((l) => l.code === code);
/** Never empty: the saved default, else `en`. */
export const defaultLocale = (saved: string | null | undefined) => (saved ?? '').trim() || 'en';

// --- TW-SET-017: active theme -----------------------------------------------------------------

const THEMES = ['paper', 'bright', 'dark', 'doodle'] as const;
export type ActiveTheme = (typeof THEMES)[number];
/** Cookie value if it is a known theme, else the saved preference (never doodle), else paper. */
export function activeTheme(
  cookie: string | null | undefined,
  preference?: string | null,
): ActiveTheme {
  if ((THEMES as readonly string[]).includes(cookie ?? '')) return cookie as ActiveTheme;
  if (['paper', 'bright', 'dark'].includes(preference ?? '')) return preference as ActiveTheme;
  return 'paper';
}

// --- TW-SET-028: sitemap and robots -----------------------------------------------------------

const ESC: Record<string, string> = {
  '<': '&lt;',
  '>': '&gt;',
  '&': '&amp;',
  "'": '&apos;',
  '"': '&quot;',
};
const xml = (s: string) => s.replace(/[<>&'"]/g, (c) => ESC[c]!);

export interface SitemapInput {
  baseUrl: string;
  posts: ReadonlyArray<{ slug: string; lastModified: string; featured?: boolean }>;
  categories: ReadonlyArray<{ slug: string }>;
  legal?: ReadonlyArray<{ slug: string }>;
}

/** Static pages first, then categories, then live posts (newest first, caller-ordered): TW-SET-028 rules 1 to 3. */
export function buildSitemapXml(i: SitemapInput): string {
  const base = i.baseUrl.replace(/\/+$/, '');
  const rows: Array<{ loc: string; priority: string; freq: string; mod?: string }> = [
    { loc: '/', priority: '1.0', freq: 'daily' },
    { loc: '/blog', priority: '0.9', freq: 'daily' },
    { loc: '/contact', priority: '0.5', freq: 'monthly' },
    ...(i.legal ?? []).map((l) => ({ loc: `/legal/${l.slug}`, priority: '0.4', freq: 'monthly' })),
    ...i.categories.map((c) => ({
      loc: `/blog?category=${encodeURIComponent(c.slug)}`,
      priority: '0.6',
      freq: 'weekly',
    })),
    ...i.posts.map((p) => ({
      loc: `/blog/${encodeURIComponent(p.slug)}`,
      priority: p.featured ? '0.8' : '0.7',
      freq: 'weekly',
      mod: p.lastModified,
    })),
  ];
  const body = rows
    .map(
      (r) =>
        `  <url>\n    <loc>${xml(base + r.loc)}</loc>\n${r.mod ? `    <lastmod>${xml(r.mod)}</lastmod>\n` : ''}    <changefreq>${r.freq}</changefreq>\n    <priority>${r.priority}</priority>\n  </url>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

/**
 * robots.txt. Reference always allowed crawling and ignored the SEO robots setting (QUIRK); a saved `noindex` default now
 * disallows everything, otherwise the five Reference lines (the sitemap line needs an absolute base URL).
 */
export function buildRobotsTxt(o: { baseUrl: string; robotsDirective: string }): string {
  const base = o.baseUrl.replace(/\/+$/, '');
  if (/\bnoindex\b/i.test(o.robotsDirective)) return 'User-agent: *\nDisallow: /\n';
  const lines = ['User-agent: *', 'Allow: /', 'Disallow: /admin', 'Disallow: /api'];
  if (base) lines.push(`Sitemap: ${base}/sitemap.xml`);
  return lines.join('\n') + '\n';
}

// --- TW-SET-030: legal links ------------------------------------------------------------------

/** Where the terms, privacy and cookies pages live: the saved URL, else the built-in `/legal/<which>` page. */
export function legalUrl(
  which: 'terms' | 'privacy' | 'cookies',
  saved: { termsUrl: string; policyUrl: string; cookiesPolicyUrl: string },
): string {
  const v = { terms: saved.termsUrl, privacy: saved.policyUrl, cookies: saved.cookiesPolicyUrl }[
    which
  ].trim();
  return v === '' ? `/legal/${which}` : v;
}
