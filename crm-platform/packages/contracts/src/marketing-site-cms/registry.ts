/**
 * The page registry (WD-CMS-009): which pages the marketing site has, which sections each page is made of, and every
 * editable field with its shipped default. It is versioned code, not data: the API validates writes against it and the
 * web app renders pages and the editor from it, so a key cannot be "editable in the editor but ignored by the page".
 *
 * Content keys are `<page>.<section>.<field>` (`home.hero.headline`), `nav.<field>`, `footer.<field>` and
 * `theme.<token>`. The per-page layout arrays are stored as `<page>.__hidden` and `<page>.__order`.
 *
 * Default copy is neutral placeholder text written for this port. It makes no claim about customers, volumes,
 * certifications or reviews (WaDesk's shipped defaults did, and are deliberately not carried over).
 */

export const CMS_PAGES = ['home', 'features', 'pricing', 'about', 'contact'] as const;
export type CmsPage = (typeof CMS_PAGES)[number];
export const isCmsPage = (v: string): v is CmsPage => (CMS_PAGES as readonly string[]).includes(v);

/** `longtext` keeps line breaks; `richtext` holds sanitised inline HTML; `link` is a safe URL; `color` is a hex colour. */
export const CMS_FIELD_TYPES = ['text', 'longtext', 'richtext', 'link', 'color'] as const;
export type CmsFieldType = (typeof CMS_FIELD_TYPES)[number];

export interface CmsField {
  /** The last segment of the content key. */
  key: string;
  type: CmsFieldType;
  label: string;
  default: string;
}

export interface CmsSection {
  slug: string;
  label: string;
  /** Pinned sections (heroes) are always shown and always first. */
  removable: boolean;
  fields: CmsField[];
}

export interface CmsPageDef {
  slug: CmsPage;
  label: string;
  path: string;
  sections: CmsSection[];
}

const f = (key: string, type: CmsFieldType, label: string, def: string): CmsField => ({
  key,
  type,
  label,
  default: def,
});

/** `n` repeated groups: item1_title, item1_body, ... */
function items(
  n: number,
  parts: ReadonlyArray<readonly [string, CmsFieldType, string]>,
  defaults: ReadonlyArray<Record<string, string>>,
  label = 'Item',
): CmsField[] {
  const out: CmsField[] = [];
  for (let i = 1; i <= n; i++) {
    for (const [part, type, partLabel] of parts) {
      out.push(
        f(`item${i}_${part}`, type, `${label} ${i}: ${partLabel}`, defaults[i - 1]?.[part] ?? ''),
      );
    }
  }
  return out;
}

const TITLE_BODY = [
  ['title', 'text', 'title'],
  ['body', 'longtext', 'text'],
] as const;

function faqFields(
  defaults: ReadonlyArray<readonly [string, string]>,
  headline: string,
): CmsField[] {
  return [
    f('kicker', 'text', 'Kicker', 'Questions'),
    f('headline', 'richtext', 'Headline', headline),
    f(
      'subtitle',
      'longtext',
      'Subtitle',
      'Cannot find what you need? Write to us and a person will reply.',
    ),
    ...defaults.flatMap(([q, a], i) => [
      f(`faq${i + 1}_q`, 'text', `Question ${i + 1}`, q),
      f(`faq${i + 1}_a`, 'longtext', `Answer ${i + 1}`, a),
    ]),
  ];
}

const ctaFinal = (headline: string, subtitle: string): CmsSection => ({
  slug: 'cta-final',
  label: 'Closing call to action',
  removable: true,
  fields: [
    f('headline', 'richtext', 'Headline', headline),
    f('subtitle', 'longtext', 'Subtitle', subtitle),
    f('cta_label', 'text', 'Button label', 'Get started'),
    f('cta_url', 'link', 'Button link', '/register'),
  ],
});

export const CMS_REGISTRY: Record<CmsPage, CmsPageDef> = {
  home: {
    slug: 'home',
    label: 'Home',
    path: '/',
    sections: [
      {
        slug: 'hero',
        label: 'Hero',
        removable: false,
        fields: [
          f('eyebrow', 'text', 'Eyebrow', 'Customer conversations, organised'),
          f('headline', 'richtext', 'Headline', 'Every customer conversation in one place'),
          f(
            'subtitle',
            'longtext',
            'Subtitle',
            'Reach people on the channels they already use, answer from one shared inbox and keep every contact organised.',
          ),
          f('cta1_label', 'text', 'Primary button label', 'Start free'),
          f('cta1_url', 'link', 'Primary button link', '/register'),
          f('cta2_label', 'text', 'Secondary button label', 'See pricing'),
          f('cta2_url', 'link', 'Secondary button link', '/pricing'),
        ],
      },
      {
        slug: 'highlights',
        label: 'Highlights',
        removable: true,
        fields: [
          f('headline', 'richtext', 'Headline', 'Built for teams that talk to customers all day'),
          f(
            'subtitle',
            'longtext',
            'Subtitle',
            'The essentials, without a stack of separate tools.',
          ),
          ...items(
            3,
            TITLE_BODY,
            [
              {
                title: 'Shared inbox',
                body: 'Assign, reply and hand over conversations without losing context.',
              },
              {
                title: 'Broadcasts',
                body: 'Send approved messages to the right audience at the right time.',
              },
              {
                title: 'Automation',
                body: 'Answer common questions automatically and route the rest to a person.',
              },
            ],
            'Highlight',
          ),
        ],
      },
      {
        slug: 'use-cases',
        label: 'Use cases',
        removable: true,
        fields: [
          f('headline', 'richtext', 'Headline', 'Made for the way you work'),
          ...items(
            3,
            TITLE_BODY,
            [
              { title: 'Sales', body: 'Follow up quickly and keep every lead in view.' },
              { title: 'Support', body: 'Resolve questions faster with shared history.' },
              { title: 'Operations', body: 'Send reminders and updates without manual effort.' },
            ],
            'Use case',
          ),
        ],
      },
      {
        slug: 'pricing-strip',
        label: 'Pricing',
        removable: true,
        fields: [
          f('headline', 'richtext', 'Headline', 'Simple plans that grow with you'),
          f('subtitle', 'longtext', 'Subtitle', 'Start free and upgrade when you need more.'),
        ],
      },
      {
        slug: 'faq',
        label: 'FAQ',
        removable: true,
        fields: faqFields(
          [
            [
              'How do I get started?',
              'Create an account, connect a channel and invite your team. Setup takes a few minutes.',
            ],
            [
              'Can I try it before paying?',
              'Yes. Start on a free plan and upgrade whenever you are ready.',
            ],
            [
              'Can my team share one workspace?',
              'Yes. Invite teammates and control what each person can see and do.',
            ],
            [
              'Where is my data stored?',
              'Your workspace data is stored securely and is never shared with other customers.',
            ],
          ],
          'Questions, answered',
        ),
      },
      {
        slug: 'faq-slider',
        label: 'FAQ marquee',
        removable: true,
        fields: [
          f('kicker', 'text', 'Kicker', 'Quick answers'),
          f('headline', 'richtext', 'Headline', 'Questions, answered'),
          f('subtitle', 'longtext', 'Subtitle', 'The questions we hear most often.'),
        ],
      },
      ctaFinal('Ready to bring your conversations together?', 'Create a workspace in minutes.'),
    ],
  },
  features: {
    slug: 'features',
    label: 'Features',
    path: '/features',
    sections: [
      {
        slug: 'hero',
        label: 'Hero',
        removable: false,
        fields: [
          f('eyebrow', 'text', 'Eyebrow', 'Features'),
          f('headline', 'richtext', 'Headline', 'Everything your team needs to talk to customers'),
          f(
            'subtitle',
            'longtext',
            'Subtitle',
            'One workspace for conversations, contacts and campaigns.',
          ),
        ],
      },
      {
        slug: 'feature-grid',
        label: 'Feature grid',
        removable: true,
        fields: [
          f('headline', 'richtext', 'Headline', 'What is inside'),
          ...items(
            6,
            TITLE_BODY,
            [
              {
                title: 'Shared inbox',
                body: 'Every conversation in one view, with owners and statuses.',
              },
              { title: 'Contacts', body: 'Profiles, tags and custom fields that stay in sync.' },
              { title: 'Broadcasts', body: 'Reach segments with approved messages.' },
              { title: 'Automation', body: 'Replies and routing that run without manual work.' },
              { title: 'Templates', body: 'Reusable messages your team can trust.' },
              { title: 'Reports', body: 'See response times and volumes at a glance.' },
            ],
            'Feature',
          ),
        ],
      },
      {
        slug: 'pillars',
        label: 'Three pillars',
        removable: true,
        fields: [
          f('headline', 'richtext', 'Headline', 'Three ideas behind the product'),
          ...items(
            3,
            TITLE_BODY,
            [
              { title: 'Clarity', body: 'Know who said what, and what happens next.' },
              { title: 'Speed', body: 'Answer in seconds, not hours.' },
              { title: 'Control', body: 'Decide who can see and change what.' },
            ],
            'Pillar',
          ),
        ],
      },
      {
        slug: 'faq',
        label: 'FAQ',
        removable: true,
        fields: faqFields(
          [
            [
              'Which channels are supported?',
              'The channels available depend on your plan and region.',
            ],
            ['Can I import my contacts?', 'Yes. Import a spreadsheet and map the columns once.'],
            ['Is there a limit on team members?', 'Limits depend on the plan you choose.'],
            [
              'Can I export my data?',
              'Yes. You can export contacts and conversations at any time.',
            ],
          ],
          'About the features',
        ),
      },
      ctaFinal('See it with your own data', 'Start free and invite your team.'),
    ],
  },
  pricing: {
    slug: 'pricing',
    label: 'Pricing',
    path: '/pricing',
    sections: [
      {
        slug: 'hero',
        label: 'Hero',
        removable: false,
        fields: [
          f('eyebrow', 'text', 'Eyebrow', 'Pricing'),
          f('headline', 'richtext', 'Headline', 'Choose the plan that fits'),
          f(
            'subtitle',
            'longtext',
            'Subtitle',
            'Clear prices. Change or cancel whenever you like.',
          ),
        ],
      },
      {
        slug: 'pricing-strip',
        label: 'Plans',
        removable: true,
        fields: [
          f('headline', 'richtext', 'Headline', 'Compare plans'),
          f('footnote', 'longtext', 'Footnote', 'Prices exclude taxes where applicable.'),
        ],
      },
      {
        slug: 'faq',
        label: 'FAQ',
        removable: true,
        fields: faqFields(
          [
            [
              'Can I change plans later?',
              'Yes. Upgrade or downgrade from your account at any time.',
            ],
            ['Is there a free plan?', 'Plans marked free cost nothing and have no time limit.'],
            [
              'How do I pay?',
              'Paid plans are billed through the checkout using the methods shown there.',
            ],
            ['Do prices include tax?', 'Taxes are added at checkout where they apply.'],
          ],
          'Pricing questions',
        ),
      },
      ctaFinal('Start with the plan that fits today', 'Switch whenever your needs change.'),
    ],
  },
  about: {
    slug: 'about',
    label: 'About',
    path: '/about',
    sections: [
      {
        slug: 'hero',
        label: 'Hero',
        removable: false,
        fields: [
          f('eyebrow', 'text', 'Eyebrow', 'About us'),
          f('headline', 'richtext', 'Headline', 'We help teams talk to their customers'),
          f(
            'subtitle',
            'longtext',
            'Subtitle',
            'A small, focused team building calm software for busy people.',
          ),
        ],
      },
      {
        slug: 'origin-story',
        label: 'Our story',
        removable: true,
        fields: [
          f('headline', 'richtext', 'Headline', 'Why we built this'),
          f(
            'body',
            'longtext',
            'Story',
            'Replace this paragraph with the story of your company and the problem you set out to solve.',
          ),
        ],
      },
      {
        slug: 'values',
        label: 'Values',
        removable: true,
        fields: [
          f('headline', 'richtext', 'Headline', 'What we care about'),
          ...items(
            3,
            TITLE_BODY,
            [
              { title: 'Be useful', body: 'Build what people need, not what looks impressive.' },
              { title: 'Be honest', body: 'Say what the product does and what it does not.' },
              { title: 'Be reliable', body: 'Make the basics work every single day.' },
            ],
            'Value',
          ),
        ],
      },
      ctaFinal('Want to talk?', 'We would like to hear from you.'),
    ],
  },
  contact: {
    slug: 'contact',
    label: 'Contact',
    path: '/contact',
    sections: [
      {
        slug: 'hero',
        label: 'Hero',
        removable: false,
        fields: [
          f('eyebrow', 'text', 'Eyebrow', 'Contact'),
          f('headline', 'richtext', 'Headline', 'Tell us how we can help'),
          f(
            'subtitle',
            'longtext',
            'Subtitle',
            'Send a message and a person on the team will reply.',
          ),
        ],
      },
      {
        slug: 'channels',
        label: 'Contact channels',
        removable: true,
        fields: [
          f('email_title', 'text', 'Email card title', 'Email'),
          f('email_body', 'longtext', 'Email card text', 'Write to us any time.'),
          f('whatsapp_title', 'text', 'Chat card title', 'Chat'),
          f('whatsapp_body', 'longtext', 'Chat card text', 'Message us on WhatsApp.'),
          f('sales_title', 'text', 'Sales card title', 'Sales'),
          f('sales_body', 'longtext', 'Sales card text', 'Talk to us about plans and onboarding.'),
        ],
      },
      {
        slug: 'form',
        label: 'Contact form',
        removable: true,
        fields: [
          f('headline', 'richtext', 'Headline', 'Send us a message'),
          f('name_label', 'text', 'Name label', 'Your name'),
          f('email_label', 'text', 'Email label', 'Work email'),
          f('company_label', 'text', 'Company label', 'Company (optional)'),
          f('topic_label', 'text', 'Topic label', 'What is this about?'),
          f('message_label', 'text', 'Message label', 'Message'),
          f('submit_label', 'text', 'Button label', 'Send message'),
          f(
            'success_text',
            'longtext',
            'Success text',
            'Thanks, your message is on its way. We will reply soon.',
          ),
          f(
            'error_text',
            'longtext',
            'Error text',
            'Something went wrong. Please check the form and try again.',
          ),
        ],
      },
      {
        slug: 'faq',
        label: 'FAQ',
        removable: true,
        fields: faqFields(
          [
            ['How quickly will you reply?', 'We aim to reply within one working day.'],
            [
              'Can I book a demo?',
              'Yes. Choose Sales above and tell us what you would like to see.',
            ],
            [
              'Where do I get product help?',
              'Signed-in customers can open the guidebook or contact support from their workspace.',
            ],
          ],
          'Before you write',
        ),
      },
    ],
  },
};

// --- site chrome (shared by every page) ---------------------------------------------------------------------------

/** The navigation and footer, edited next to the pages but not hideable or orderable. */
export const CMS_SITE_SECTIONS: CmsSection[] = [
  {
    slug: 'nav',
    label: 'Navigation',
    removable: false,
    fields: [
      ...[
        ['Home', '/'],
        ['Features', '/features'],
        ['Pricing', '/pricing'],
        ['Blog', '/blog'],
        ['About', '/about'],
        ['Contact', '/contact'],
      ].flatMap(([label, url], i) => [
        f(`link${i + 1}_label`, 'text', `Link ${i + 1} label`, label!),
        f(`link${i + 1}_url`, 'link', `Link ${i + 1} address`, url!),
      ]),
      f('signin_label', 'text', 'Sign in label', 'Sign in'),
      f('cta_label', 'text', 'Call to action label', 'Start free'),
      f('dashboard_label', 'text', 'Dashboard label', 'Dashboard'),
    ],
  },
  {
    slug: 'footer',
    label: 'Footer',
    removable: false,
    fields: [
      f('tagline', 'longtext', 'Tagline', 'Customer conversations, organised.'),
      f('copyright', 'text', 'Copyright line', ''),
      ...(
        [
          [
            'Product',
            [
              ['Features', '/features'],
              ['Pricing', '/pricing'],
              ['Blog', '/blog'],
            ],
          ],
          [
            'Company',
            [
              ['About', '/about'],
              ['Contact', '/contact'],
              ['Sign in', '/login'],
            ],
          ],
          [
            'Legal',
            [
              ['Terms', '/legal/terms'],
              ['Privacy', '/legal/privacy'],
              ['Cookies', '/legal/cookies'],
            ],
          ],
        ] as const
      ).flatMap(([title, links], c) => [
        f(`col${c + 1}_title`, 'text', `Column ${c + 1} title`, title),
        ...links.flatMap(([label, url], l) => [
          f(`col${c + 1}_link${l + 1}_label`, 'text', `Column ${c + 1} link ${l + 1} label`, label),
          f(`col${c + 1}_link${l + 1}_url`, 'link', `Column ${c + 1} link ${l + 1} address`, url),
        ]),
      ]),
    ],
  },
];

// --- theme --------------------------------------------------------------------------------------------------------

export const THEME_GROUPS = ['brand', 'ink', 'paper', 'accent'] as const;
export type ThemeGroup = (typeof THEME_GROUPS)[number];

export interface ThemeToken {
  /** The last two segments of the content key: `theme.brand.deep`. */
  key: string;
  group: ThemeGroup;
  label: string;
  default: string;
}

const t = (key: string, label: string, def: string): ThemeToken => ({
  key,
  group: key.split('.')[0] as ThemeGroup,
  label,
  default: def,
});

export const THEME_TOKENS: readonly ThemeToken[] = [
  t('brand.deep', 'Brand, deep', '#0f4c45'),
  t('brand.main', 'Brand, main', '#15766a'),
  t('brand.bright', 'Brand, bright', '#1fae77'),
  t('brand.soft', 'Brand, soft', '#d8f3e4'),
  t('brand.tint', 'Brand, tint', '#ecf9f1'),
  t('ink.900', 'Ink 900', '#0b1713'),
  t('ink.700', 'Ink 700', '#1f3a34'),
  t('ink.500', 'Ink 500', '#5b706b'),
  t('ink.300', 'Ink 300', '#b7c4c0'),
  t('paper.0', 'Paper 0', '#fcfbf8'),
  t('paper.50', 'Paper 50', '#f6f4ee'),
  t('paper.100', 'Paper 100', '#ece8dc'),
  t('accent.warm', 'Accent, warm', '#e07a5f'),
  t('accent.cool', 'Accent, cool', '#3d7ea6'),
];

export const THEME_KEYS: readonly string[] = THEME_TOKENS.map((x) => `theme.${x.key}`);

/** One-click re-skins: they rewrite the brand and accent tokens only, never ink or paper. */
export const THEME_PRESETS: ReadonlyArray<{
  id: string;
  label: string;
  tokens: Record<string, string>;
}> = [
  {
    id: 'emerald',
    label: 'Emerald',
    tokens: Object.fromEntries(
      THEME_TOKENS.filter((x) => x.group === 'brand' || x.group === 'accent').map((x) => [
        x.key,
        x.default,
      ]),
    ),
  },
  {
    id: 'ocean',
    label: 'Ocean',
    tokens: {
      'brand.deep': '#0b3a5c',
      'brand.main': '#14639a',
      'brand.bright': '#2f9bd8',
      'brand.soft': '#d6ebf8',
      'brand.tint': '#eaf5fb',
      'accent.warm': '#f08a4b',
      'accent.cool': '#6a5acd',
    },
  },
  {
    id: 'forest',
    label: 'Forest',
    tokens: {
      'brand.deep': '#1d3b24',
      'brand.main': '#2f6b3a',
      'brand.bright': '#5aa05f',
      'brand.soft': '#dcebd9',
      'brand.tint': '#eef6ec',
      'accent.warm': '#c9893b',
      'accent.cool': '#4b7f8c',
    },
  },
  {
    id: 'royal',
    label: 'Royal',
    tokens: {
      'brand.deep': '#2b1a5c',
      'brand.main': '#4b2fa0',
      'brand.bright': '#7a5ce0',
      'brand.soft': '#e3dcf8',
      'brand.tint': '#f1edfc',
      'accent.warm': '#e0668a',
      'accent.cool': '#3d8fd1',
    },
  },
  {
    id: 'sunset',
    label: 'Sunset',
    tokens: {
      'brand.deep': '#5c1f12',
      'brand.main': '#b8431f',
      'brand.bright': '#ee7a3c',
      'brand.soft': '#fbe1d1',
      'brand.tint': '#fdf0e7',
      'accent.warm': '#f2b134',
      'accent.cool': '#5b6fb5',
    },
  },
  {
    id: 'slate',
    label: 'Slate',
    tokens: {
      'brand.deep': '#1c2733',
      'brand.main': '#3b4f63',
      'brand.bright': '#6b8299',
      'brand.soft': '#dde4ea',
      'brand.tint': '#eef1f4',
      'accent.warm': '#d98c5f',
      'accent.cool': '#4f8a8b',
    },
  },
];

// --- the flat key table -------------------------------------------------------------------------------------------

export interface CmsKeyInfo {
  type: CmsFieldType;
  default: string;
  label: string;
}

/** Every editable key with its type and shipped default. Anything else is refused on write. */
export const CMS_KEYS: ReadonlyMap<string, CmsKeyInfo> = (() => {
  const map = new Map<string, CmsKeyInfo>();
  for (const page of CMS_PAGES) {
    for (const s of CMS_REGISTRY[page].sections) {
      for (const fld of s.fields) {
        map.set(`${page}.${s.slug}.${fld.key}`, {
          type: fld.type,
          default: fld.default,
          label: fld.label,
        });
      }
    }
  }
  for (const s of CMS_SITE_SECTIONS) {
    for (const fld of s.fields)
      map.set(`${s.slug}.${fld.key}`, { type: fld.type, default: fld.default, label: fld.label });
  }
  for (const tok of THEME_TOKENS) {
    map.set(`theme.${tok.key}`, { type: 'color', default: tok.default, label: tok.label });
  }
  return map;
})();

export const cmsKey = (page: string, section: string, field: string): string =>
  `${page}.${section}.${field}`;

/** The scopes publish, discard and reset accept. */
export const CMS_SCOPES = ['all', 'site', 'theme', ...CMS_PAGES] as const;
export type CmsScope = (typeof CMS_SCOPES)[number];

/** The key prefix a scope covers (`all` has none). `site` covers the navigation and the footer. */
export function scopePrefixes(scope: CmsScope): string[] | null {
  if (scope === 'all') return null;
  if (scope === 'site') return CMS_SITE_SECTIONS.map((s) => `${s.slug}.`);
  return [`${scope}.`];
}

export const layoutKeys = (page: CmsPage) => ({
  hidden: `${page}.__hidden`,
  order: `${page}.__order`,
});
export const isLayoutKey = (key: string): boolean =>
  /^(home|features|pricing|about|contact)\.__(hidden|order)$/.test(key);

// --- section resolution (WD-CMS-009) ------------------------------------------------------------------------------

export const removableSlugs = (page: CmsPage): string[] =>
  CMS_REGISTRY[page].sections.filter((s) => s.removable).map((s) => s.slug);

/**
 * The sections a page renders, in order. Pinned sections (heroes) come first and are always shown. The saved order
 * keeps only slugs that exist and are removable; any removable section missing from it follows in default order, so a
 * section added in code later can never disappear. Hidden slugs are dropped.
 */
export function resolveSections(
  page: CmsPage,
  hidden: readonly string[] = [],
  order: readonly string[] = [],
): string[] {
  const def = CMS_REGISTRY[page].sections;
  const removable = removableSlugs(page);
  const saved = [...new Set(order.filter((s) => removable.includes(s)))];
  const rest = removable.filter((s) => !saved.includes(s));
  const ordered = [...saved, ...rest].filter((s) => !hidden.includes(s));
  return [...def.filter((s) => !s.removable).map((s) => s.slug), ...ordered];
}

/** A link a page may emit: site-relative, an anchor, http(s), mailto or tel. Never `javascript:` or protocol-relative. */
export function isSafeLink(value: string): boolean {
  const v = value.trim();
  if (v === '' || v.length > 500 || /[\u0000-\u001f\s]/.test(v)) return false;
  if (v.startsWith('//')) return false;
  return /^(\/|#|https?:\/\/|mailto:|tel:)/i.test(v);
}

export const isHexColor = (value: string): boolean =>
  /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim());
