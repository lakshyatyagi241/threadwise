import {
  BRAND_THEMES,
  WABA_PROVIDERS,
  FONT_FAMILIES,
  MAILERS,
  STORAGE_PROVIDERS,
  type SetGroup,
  type SetTestableGroup,
} from '@crm/contracts';

/**
 * What each settings screen shows. The API's group schemas are the authority on validity; this only says which control
 * renders each field and how the page is sectioned. Reference's pages and ours are not one to one with the stored groups:
 * Site info and Footer are two pages over one group, Appearance is the colour half of the branding group (its files sit
 * on General, as in Reference). Field labels live under `groups.<group>.fields.<key>`, page text under `pages.<id>`;
 * `messages.test.ts` checks that every key used here has its text.
 */
export type FieldKind =
  | 'text'
  | 'url'
  | 'email'
  | 'number'
  | 'toggle'
  | 'select'
  | 'color'
  | 'range'
  | 'cards'
  | 'textarea'
  | 'timezone'
  | 'language'
  | 'country'
  | 'secret';

export interface FieldSpec {
  /** Dotted for a nested object field (`logos.paper`); the group's top-level key otherwise. */
  key: string;
  kind: FieldKind;
  options?: readonly string[];
  mono?: boolean;
  min?: number;
  max?: number;
  /** Character counter with a target range (the SEO page): amber outside it. */
  counter?: readonly [number, number];
  /** Two fields share a row on wide screens. */
  half?: boolean;
  /** Part of the draft but drawn by another control (the dial code follows the country). */
  hidden?: boolean;
}

/** A block that is not a plain list of fields. */
export type CustomSection =
  'brandAssets' | 'signupLink' | 'seoPreview' | 'teamInboxApp' | 'wabaCallback' | 'googleCallback';

export interface SectionSpec {
  id: string;
  fields: FieldSpec[];
  custom?: CustomSection;
  /** A small mono label above the section title (Reference: the section's "eyebrow"). */
  eyebrow?: string;
}

export interface GroupSpec {
  /** The page id: messages `pages.<id>`, and the menu key. */
  id: string;
  group: SetGroup;
  /** URL segment under /admin/settings. */
  slug: string;
  sections: SectionSpec[];
  /** Groups with a "check it against the real service" action. */
  test?: SetTestableGroup;
  /** The quick-guide items under `pages.<id>.guide.items`, in order. */
  guide: readonly string[];
  /** The Appearance page's live preview and its "reset all colours" card. */
  appearanceAside?: boolean;
}

const f = (key: string, kind: FieldKind = 'text', extra: Partial<FieldSpec> = {}): FieldSpec => ({
  key,
  kind,
  ...extra,
});
const flags = (...keys: string[]) => keys.map((k) => f(k, 'toggle'));
const texts = (...keys: string[]) => keys.map((k) => f(k));
const halves = (...fs: FieldSpec[]) => fs.map((x) => ({ ...x, half: true }));
const socials = () =>
  halves(
    ...[
      'socialX',
      'socialLinkedin',
      'socialInstagram',
      'socialYoutube',
      'socialFacebook',
      'socialGithub',
    ].map((k) => f(k, 'url')),
  );

export const ROBOTS_OPTIONS = [
  'index, follow',
  'index, nofollow',
  'noindex, follow',
  'noindex, nofollow',
] as const;

export const GROUP_SPECS: GroupSpec[] = [
  {
    id: 'general',
    group: 'general',
    slug: 'general',
    guide: ['appName', 'appUrl', 'language', 'currency', 'maintenance'],
    sections: [
      {
        id: 'identity',
        eyebrow: 'general-setting',
        fields: [
          f('appName'),
          f('platformFooter'),
          ...halves(
            f('appUrl', 'url'),
            f('supportEmail', 'email'),
            f('contactNumber'),
            f('fromEmail', 'email'),
            f('defaultTimezone', 'timezone'),
            f('defaultLanguage', 'language'),
            f('defaultCurrency', 'text', { mono: true }),
            f('defaultCountryIso', 'country'),
          ),
          f('defaultCountryCode', 'text', { hidden: true }),
          f('fontFamily', 'select', { options: ['', ...FONT_FAMILIES] }),
          f('address', 'textarea'),
          f('mapIframeUrl', 'url'),
        ],
      },
      { id: 'brandAssets', eyebrow: 'brand-assets', custom: 'brandAssets', fields: [] },
      { id: 'platform', eyebrow: 'platform-toggles', fields: flags('maintenanceMode') },
      { id: 'signup', eyebrow: 'signups-and-trial', custom: 'signupLink', fields: [] },
    ],
  },
  {
    id: 'appearance',
    group: 'branding',
    slug: 'appearance',
    appearanceAside: true,
    guide: ['how', 'tokens', 'primary', 'defaults'],
    sections: [
      {
        id: 'layout',
        eyebrow: 'user-dashboard',
        fields: [f('dashboardLayout', 'cards', { options: ['topbar', 'sidebar'] })],
      },
      {
        id: 'sidebar',
        eyebrow: 'user-dashboard',
        fields: [
          f('sidebarColor', 'color'),
          f('sidebarTextColor', 'color'),
          f('sidebarAccentColor', 'color'),
        ],
      },
      {
        id: 'interface',
        eyebrow: 'interface',
        fields: [
          f('fontScale', 'range', { min: 80, max: 130 }),
          f('uiOpacity', 'range', { min: 55, max: 100 }),
        ],
      },
      {
        id: 'brand',
        eyebrow: 'brand',
        fields: ['wa-deep', 'wa-teal', 'wa-green', 'wa-mint', 'wa-bubble'].map((t) =>
          f(`colors.${t}`, 'color', { half: true }),
        ),
      },
      {
        id: 'surfaces',
        eyebrow: 'surfaces',
        fields: ['paper-0', 'paper-50', 'paper-100', 'paper-200'].map((t) =>
          f(`colors.${t}`, 'color', { half: true }),
        ),
      },
      {
        id: 'text',
        eyebrow: 'text',
        fields: ['ink-500', 'ink-700', 'ink-900'].map((t) =>
          f(`colors.${t}`, 'color', { half: true }),
        ),
      },
      {
        id: 'accents',
        eyebrow: 'accents',
        fields: ['accent-coral', 'accent-amber', 'accent-plum', 'accent-sky'].map((t) =>
          f(`colors.${t}`, 'color', { half: true }),
        ),
      },
    ],
  },
  {
    id: 'siteInfo',
    group: 'site',
    slug: 'site-info',
    guide: ['shared', 'frontend'],
    sections: [
      {
        id: 'company',
        eyebrow: 'company',
        fields: texts('companyName', 'tagline', 'foundedYear', 'address', 'cityCountry'),
      },
      {
        id: 'contact',
        eyebrow: 'emails',
        fields: ['emailGeneral', 'emailSupport', 'emailSales', 'emailSecurity', 'emailCareers'].map(
          (k) => f(k, 'email', { half: true }),
        ),
      },
      { id: 'phone', eyebrow: 'phone', fields: halves(...texts('phone', 'whatsapp')) },
      { id: 'social', eyebrow: 'social', fields: socials() },
    ],
  },
  {
    id: 'footer',
    group: 'site',
    slug: 'footer',
    guide: ['what', 'social'],
    sections: [
      {
        id: 'footer',
        eyebrow: 'footer',
        fields: [
          f('footerTitle'),
          f('footerCopyright', 'textarea'),
          f('footerDescription', 'textarea'),
          ...socials(),
        ],
      },
    ],
  },
  {
    id: 'mail',
    group: 'mail',
    slug: 'mail',
    test: 'mail',
    guide: ['hosts', 'used'],
    sections: [
      {
        id: 'smtp',
        eyebrow: 'outbound-mail',
        fields: halves(
          f('fromName'),
          f('fromAddress', 'email'),
          f('mailer', 'select', { options: MAILERS }),
          f('encryption', 'select', { options: ['tls', 'ssl', 'starttls', ''] }),
          f('host'),
          f('port', 'number', { min: 1, max: 65535, mono: true }),
          f('username'),
          f('password', 'secret'),
        ),
      },
    ],
  },
  {
    id: 'seo',
    group: 'seo',
    slug: 'seo',
    guide: ['basics', 'where', 'sitemap'],
    sections: [
      {
        id: 'search',
        eyebrow: 'meta',
        fields: [
          f('metaTitle', 'text', { counter: [50, 60] }),
          f('metaDescription', 'textarea', { counter: [140, 160] }),
          f('metaKeywords', 'textarea'),
          ...halves(
            f('robots', 'select', { options: ROBOTS_OPTIONS }),
            f('author'),
            f('canonical', 'url'),
          ),
        ],
      },
      {
        id: 'social',
        eyebrow: 'opengraph',
        fields: [
          f('ogImage', 'url'),
          f('ogTitle'),
          f('ogDescription', 'textarea'),
          ...halves(
            f('ogType', 'select', { options: ['website', 'article', 'product', 'profile'] }),
            f('ogUrl', 'url'),
          ),
        ],
      },
      {
        id: 'twitter',
        eyebrow: 'twitter',
        fields: [
          f('twitterCard', 'select', {
            options: ['summary', 'summary_large_image', 'app', 'player'],
          }),
          ...halves(f('twitterSite'), f('twitterCreator')),
        ],
      },
      {
        id: 'verification',
        eyebrow: 'verification',
        fields: texts('googleVerification', 'bingVerification'),
      },
      { id: 'preview', eyebrow: 'preview', custom: 'seoPreview', fields: [] },
    ],
  },
  {
    id: 'privacy',
    group: 'privacy',
    slug: 'privacy',
    guide: ['order', 'linked'],
    sections: [
      {
        id: 'banner',
        eyebrow: 'cookie-consent',
        fields: [
          f('cookieBannerEnabled', 'toggle'),
          f('cookieBannerStyle', 'select', { options: ['bottom-bar', 'top-bar', 'modal'] }),
          f('respectDoNotTrack', 'toggle'),
          f('cookieMessage', 'textarea'),
          f('policyUrl', 'url'),
          f('termsUrl', 'url'),
          f('cookiesPolicyUrl', 'url'),
        ],
      },
      { id: 'compliance', eyebrow: 'gdpr-ccpa', fields: flags('gdprCompliance', 'ccpaCompliance') },
      {
        id: 'accessibility',
        eyebrow: 'ada-wcag',
        fields: flags('adaSkipLink', 'adaHighContrast', 'adaLargeText', 'adaReducedMotion'),
      },
    ],
  },
  {
    id: 'analytics',
    group: 'analytics',
    slug: 'analytics',
    guide: ['categories', 'where'],
    sections: [
      {
        id: 'site',
        eyebrow: 'analytics-cookies',
        fields: halves(
          ...texts('googleGa4', 'googleGtm', 'microsoftClarity', 'plausibleDomain'),
          f('posthogKey'),
          f('posthogHost', 'url'),
          ...texts('hotjarSiteId', 'mixpanelToken'),
        ),
      },
      {
        id: 'marketing',
        eyebrow: 'marketing-cookies',
        fields: halves(...texts('metaPixel', 'tiktokPixel', 'linkedinPartner', 'twitterPixel')),
      },
    ],
  },
  {
    id: 'custom',
    group: 'customCode',
    slug: 'custom',
    guide: ['scope', 'block', 'dark', 'sensitive'],
    sections: [
      {
        id: 'code',
        eyebrow: 'custom-code',
        fields: [
          f('enabled', 'toggle'),
          f('css', 'textarea', { mono: true }),
          f('js', 'textarea', { mono: true }),
        ],
      },
    ],
  },
  {
    id: 'pwa',
    group: 'pwa',
    slug: 'pwa',
    guide: ['manifest', 'install'],
    sections: [
      {
        id: 'app',
        eyebrow: 'pwa-manifest',
        fields: [
          f('enabled', 'toggle'),
          ...halves(f('appName'), f('shortName')),
          f('description', 'textarea'),
          ...halves(
            f('startUrl'),
            f('scope'),
            f('display', 'select', {
              options: ['standalone', 'fullscreen', 'minimal-ui', 'browser'],
            }),
            f('orientation', 'select', {
              options: [
                'any',
                'portrait',
                'landscape',
                'natural',
                'portrait-primary',
                'landscape-primary',
              ],
            }),
            f('themeColor', 'color'),
            f('backgroundColor', 'color'),
            f('icon192', 'url'),
            f('icon512', 'url'),
          ),
          ...flags('installPrompt', 'offlineEnabled'),
        ],
      },
      { id: 'teamInbox', eyebrow: 'team-inbox-pwa', custom: 'teamInboxApp', fields: [] },
    ],
  },
  {
    id: 'storage',
    group: 'storage',
    slug: 'storage',
    test: 'storage',
    guide: ['s3', 'bunny', 'spaces', 'test'],
    sections: [
      {
        id: 'provider',
        eyebrow: 'storage-status',
        fields: [
          f('enabled', 'toggle'),
          ...halves(
            f('provider', 'select', { options: STORAGE_PROVIDERS }),
            f('visibility', 'select', { options: ['private', 'public'] }),
          ),
        ],
      },
      {
        id: 'credentials',
        eyebrow: 'credentials',
        fields: [
          ...halves(f('accessKeyId'), f('secret', 'secret'), f('region'), f('bucket')),
          f('endpoint', 'url'),
          f('cdnUrl', 'url'),
          f('pathStyle', 'toggle'),
          ...halves(f('storageZone'), f('storagePassword', 'secret')),
          f('basePath'),
        ],
      },
    ],
  },
  {
    id: 'realtime',
    group: 'realtime',
    slug: 'realtime',
    test: 'realtime',
    guide: ['how', 'live', 'poll', 'test'],
    sections: [
      { id: 'live', eyebrow: 'broadcasting', fields: [f('enabled', 'toggle')] },
      {
        id: 'pusher',
        eyebrow: 'pusher-app',
        fields: halves(f('appId'), f('cluster'), f('appKey'), f('appSecret', 'secret')),
      },
    ],
  },
  {
    id: 'campaigns',
    group: 'campaigns',
    slug: 'campaigns',
    guide: ['retry', 'expiry'],
    sections: [
      {
        id: 'retry',
        eyebrow: 'delivery',
        fields: halves(
          f('retryAttempts', 'number', { min: 0, max: 10 }),
          f('retryBackoffSec', 'number', { min: 10, max: 3600 }),
        ),
      },
      {
        id: 'expiry',
        eyebrow: 'lifecycle',
        fields: halves(
          f('autoExpiryEnabled', 'toggle'),
          f('defaultExpiryHours', 'number', { min: 1, max: 720 }),
        ),
      },
    ],
  },
  {
    id: 'googleCalendar',
    group: 'googleCalendar',
    slug: 'google-calendar',
    guide: ['project', 'redirect', 'consent', 'workspaces'],
    sections: [
      {
        id: 'oauth',
        eyebrow: 'google-oauth',
        custom: 'googleCallback',
        fields: [
          f('enabled', 'toggle'),
          ...halves(f('clientId', 'text', { mono: true }), f('clientSecret', 'secret')),
          f('redirectUri', 'url', { mono: true }),
        ],
      },
    ],
  },
  {
    id: 'whatsapp',
    group: 'whatsapp',
    slug: 'whatsapp',
    guide: ['api', 'app', 'webhook', 'perWorkspace', 'login'],
    sections: [
      {
        id: 'metaApp',
        eyebrow: 'business-api-waba',
        fields: [
          ...halves(f('appId', 'text', { mono: true }), f('appSecret', 'secret')),
          ...halves(
            f('configId', 'text', { mono: true }),
            f('graphVersion', 'text', { mono: true }),
          ),
          f('coexistence', 'toggle'),
        ],
      },
      {
        id: 'interakt',
        eyebrow: 'interakt-route',
        fields: [
          f('defaultProvider', 'select', { options: WABA_PROVIDERS }),
          ...halves(f('solutionId', 'text', { mono: true }), f('partnerAuthKey', 'secret')),
          ...halves(f('systemUserId', 'text', { mono: true }), f('systemUserToken', 'secret')),
          f('businessId', 'text', { mono: true }),
        ],
      },
      {
        id: 'inbound',
        eyebrow: 'webhook',
        custom: 'wabaCallback',
        fields: [f('verifyToken', 'secret'), f('requireSignature', 'toggle')],
      },
    ],
  },
];

export const specBySlug = (slug: string): GroupSpec | undefined =>
  GROUP_SPECS.find((s) => s.slug === slug);
export const specById = (id: string): GroupSpec => GROUP_SPECS.find((s) => s.id === id)!;
export const allFields = (spec: GroupSpec): FieldSpec[] => spec.sections.flatMap((s) => s.fields);

/** The theme ids the brand-asset uploader offers, in Reference's order (Paper is the default). */
export const LOGO_THEMES = BRAND_THEMES;

/**
 * Hub cards that open a page of another domain (Reference's settings landing page links to them). Only the ones that exist in
 * this app are listed; currencies, catalogue, Shopify, WooCommerce, HubSpot, Google, Slack, mobile push and Trello come
 * with their own domains.
 */
export const EXTERNAL_CARDS = [
  { id: 'paymentGateways', href: '/admin/payment-gateways' },
  { id: 'aiKeys', href: '/admin/ai-keys' },
  { id: 'auditLog', href: '/admin/security/events' },
  { id: 'menuOrder', href: '/admin/settings/menu-order' },
  { id: 'authPages', href: '/admin/settings/auth-pages' },
  { id: 'languages', href: '/admin/i18n/languages' },
  { id: 'socialLogin', href: '/admin/settings/social-login' },
  { id: 'registration', href: '/admin/settings/registration' },
] as const;

/** Hub card order (Reference's): the numbers on the cards follow it. */
export const HUB_ORDER = [
  'appearance',
  'general',
  'paymentGateways',
  'aiKeys',
  'mail',
  'whatsapp',
  'auditLog',
  'privacy',
  'menuOrder',
  'authPages',
  'analytics',
  'seo',
  'languages',
  'pwa',
  'footer',
  'siteInfo',
  'socialLogin',
  'registration',
  'custom',
  'storage',
  'realtime',
  'campaigns',
  'googleCalendar',
] as const;
