import {
  BRAND_THEMES,
  FONT_FAMILIES,
  MAILERS,
  STORAGE_PROVIDERS,
  THEME_COLOR_TOKENS,
  type SetGroup,
  type SetTestableGroup,
} from '@crm/contracts';

/**
 * What each settings screen shows. The API's group schemas are the authority on validity; this only says
 * which control renders each field and how the page is sectioned. Labels, hints and section titles are
 * message keys under `platform-settings-branding-storage.groups.<group>`; `messages.test.ts` checks that
 * every field here has its text.
 */
export type FieldKind =
  | 'text'
  | 'url'
  | 'email'
  | 'number'
  | 'toggle'
  | 'select'
  | 'color'
  | 'textarea'
  | 'timezone'
  | 'secret';

export interface FieldSpec {
  /** Dotted for a nested object field (`logos.paper`); the group's top-level key otherwise. */
  key: string;
  kind: FieldKind;
  options?: readonly string[];
  mono?: boolean;
  min?: number;
  max?: number;
}
export interface SectionSpec {
  id: string;
  fields: FieldSpec[];
}
export interface GroupSpec {
  group: SetGroup;
  /** URL segment under /admin/settings. */
  slug: string;
  sections: SectionSpec[];
  /** Groups with a "check it against the real service" action. */
  test?: SetTestableGroup;
}

const f = (key: string, kind: FieldKind = 'text', extra: Partial<FieldSpec> = {}): FieldSpec => ({
  key,
  kind,
  ...extra,
});
const flags = (...keys: string[]) => keys.map((k) => f(k, 'toggle'));
const urls = (...keys: string[]) => keys.map((k) => f(k, 'url'));
const texts = (...keys: string[]) => keys.map((k) => f(k));

export const GROUP_SPECS: GroupSpec[] = [
  {
    group: 'general',
    slug: 'general',
    sections: [
      {
        id: 'identity',
        fields: [
          f('appName'),
          f('appUrl', 'url'),
          f('supportEmail', 'email'),
          f('fromEmail', 'email'),
          f('contactNumber'),
          f('address', 'textarea'),
          f('mapIframeUrl', 'url'),
          f('platformFooter'),
        ],
      },
      {
        id: 'defaults',
        fields: [
          f('defaultTimezone', 'timezone'),
          f('defaultLanguage', 'text', { mono: true }),
          f('defaultCurrency', 'text', { mono: true }),
          f('defaultCountryCode', 'text', { mono: true }),
          f('defaultCountryIso', 'text', { mono: true }),
          f('fontFamily', 'select', { options: ['', ...FONT_FAMILIES] }),
        ],
      },
      { id: 'platform', fields: flags('maintenanceMode') },
    ],
  },
  {
    group: 'branding',
    slug: 'branding',
    sections: [
      {
        id: 'assets',
        fields: [f('faviconUrl', 'url'), ...BRAND_THEMES.map((t) => f(`logos.${t}`, 'url'))],
      },
      {
        id: 'colors',
        fields: THEME_COLOR_TOKENS.map((t) => f(`colors.${t}`, 'color')),
      },
      {
        id: 'interface',
        fields: [
          f('fontScale', 'number', { min: 80, max: 130 }),
          f('uiOpacity', 'number', { min: 55, max: 100 }),
          f('dashboardLayout', 'select', { options: ['topbar', 'sidebar'] }),
          f('sidebarColor', 'color'),
          f('sidebarTextColor', 'color'),
          f('sidebarAccentColor', 'color'),
        ],
      },
    ],
  },
  {
    group: 'site',
    slug: 'site-info',
    sections: [
      {
        id: 'company',
        fields: texts('companyName', 'tagline', 'foundedYear', 'address', 'cityCountry'),
      },
      {
        id: 'contact',
        fields: [
          ...['emailGeneral', 'emailSupport', 'emailSales', 'emailSecurity', 'emailCareers'].map(
            (k) => f(k, 'email'),
          ),
          ...texts('phone', 'whatsapp'),
        ],
      },
      {
        id: 'social',
        fields: urls(
          'socialX',
          'socialLinkedin',
          'socialInstagram',
          'socialYoutube',
          'socialFacebook',
          'socialGithub',
        ),
      },
      {
        id: 'footer',
        fields: [
          f('footerTitle'),
          f('footerDescription', 'textarea'),
          f('footerCopyright', 'textarea'),
        ],
      },
    ],
  },
  {
    group: 'mail',
    slug: 'mail',
    test: 'mail',
    sections: [
      {
        id: 'sender',
        fields: [f('fromName'), f('fromAddress', 'email')],
      },
      {
        id: 'smtp',
        fields: [
          f('mailer', 'select', { options: MAILERS }),
          f('host'),
          f('port', 'number', { min: 1, max: 65535, mono: true }),
          f('encryption', 'select', { options: ['tls', 'ssl', 'starttls', ''] }),
          f('username'),
          f('password', 'secret'),
        ],
      },
    ],
  },
  {
    group: 'seo',
    slug: 'seo',
    sections: [
      {
        id: 'search',
        fields: [
          f('metaTitle'),
          f('metaDescription', 'textarea'),
          f('metaKeywords', 'textarea'),
          f('robots'),
          f('canonical', 'url'),
          f('author'),
        ],
      },
      {
        id: 'social',
        fields: [
          f('ogTitle'),
          f('ogDescription', 'textarea'),
          f('ogType', 'select', { options: ['website', 'article', 'product', 'profile'] }),
          f('ogUrl', 'url'),
          f('ogImage', 'url'),
          f('twitterCard', 'select', {
            options: ['summary', 'summary_large_image', 'app', 'player'],
          }),
          f('twitterSite'),
          f('twitterCreator'),
        ],
      },
      { id: 'verification', fields: texts('googleVerification', 'bingVerification') },
    ],
  },
  {
    group: 'privacy',
    slug: 'privacy',
    sections: [
      {
        id: 'banner',
        fields: [
          f('cookieBannerEnabled', 'toggle'),
          f('cookieBannerStyle', 'select', { options: ['modal', 'bottom-bar', 'top-bar'] }),
          f('cookieMessage', 'textarea'),
          f('respectDoNotTrack', 'toggle'),
        ],
      },
      { id: 'links', fields: urls('policyUrl', 'termsUrl', 'cookiesPolicyUrl') },
      {
        id: 'compliance',
        fields: flags(
          'gdprCompliance',
          'ccpaCompliance',
          'adaSkipLink',
          'adaHighContrast',
          'adaLargeText',
          'adaReducedMotion',
        ),
      },
    ],
  },
  {
    group: 'analytics',
    slug: 'analytics',
    sections: [
      {
        id: 'trackers',
        fields: texts(
          'googleGa4',
          'googleGtm',
          'metaPixel',
          'microsoftClarity',
          'tiktokPixel',
          'linkedinPartner',
          'twitterPixel',
          'plausibleDomain',
          'posthogKey',
          'mixpanelToken',
          'hotjarSiteId',
        ).concat(f('posthogHost', 'url')),
      },
    ],
  },
  {
    group: 'customCode',
    slug: 'custom-code',
    sections: [
      {
        id: 'code',
        fields: [
          f('enabled', 'toggle'),
          f('css', 'textarea', { mono: true }),
          f('js', 'textarea', { mono: true }),
        ],
      },
    ],
  },
  {
    group: 'pwa',
    slug: 'pwa',
    sections: [
      {
        id: 'app',
        fields: [
          f('enabled', 'toggle'),
          f('appName'),
          f('shortName'),
          f('description', 'textarea'),
          f('startUrl'),
          f('scope'),
        ],
      },
      {
        id: 'look',
        fields: [
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
        ],
      },
      { id: 'install', fields: flags('installPrompt', 'offlineEnabled') },
    ],
  },
  {
    group: 'storage',
    slug: 'storage',
    test: 'storage',
    sections: [
      {
        id: 'provider',
        fields: [
          f('enabled', 'toggle'),
          f('provider', 'select', { options: STORAGE_PROVIDERS }),
          f('visibility', 'select', { options: ['private', 'public'] }),
          f('basePath'),
        ],
      },
      {
        id: 'credentials',
        fields: [
          f('accessKeyId'),
          f('secret', 'secret'),
          f('region'),
          f('bucket'),
          f('endpoint', 'url'),
          f('cdnUrl', 'url'),
          f('pathStyle', 'toggle'),
          f('storageZone'),
          f('storagePassword', 'secret'),
        ],
      },
    ],
  },
  {
    group: 'realtime',
    slug: 'realtime',
    test: 'realtime',
    sections: [
      {
        id: 'live',
        fields: [
          f('enabled', 'toggle'),
          f('appId'),
          f('cluster'),
          f('appKey'),
          f('appSecret', 'secret'),
        ],
      },
    ],
  },
];

export const specBySlug = (slug: string): GroupSpec | undefined =>
  GROUP_SPECS.find((s) => s.slug === slug);
export const specByGroup = (group: SetGroup): GroupSpec =>
  GROUP_SPECS.find((s) => s.group === group)!;
export const allFields = (spec: GroupSpec): FieldSpec[] => spec.sections.flatMap((s) => s.fields);
