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

const TITLE_BODY = [
  ['title', 'text', 'title'],
  ['body', 'longtext', 'text'],
] as const;

/** `n` repeated groups named `<name>1_<part>`: `item1_title`, `rail2_desc`, `card3_spec1_label`. */
function repeat(
  name: string,
  n: number,
  parts: ReadonlyArray<readonly [string, CmsFieldType, string]>,
  defaults: ReadonlyArray<Record<string, string>>,
  label: string,
): CmsField[] {
  const out: CmsField[] = [];
  for (let i = 1; i <= n; i++) {
    for (const [part, type, partLabel] of parts) {
      out.push(
        f(
          `${name}${i}_${part}`,
          type,
          `${label} ${i}: ${partLabel}`,
          defaults[i - 1]?.[part] ?? '',
        ),
      );
    }
  }
  return out;
}

const eyebrow = (def: string) => f('eyebrow', 'text', 'Eyebrow', def);
const headline = (def: string) => f('headline', 'richtext', 'Headline', def);
const subtitle = (def: string) => f('subtitle', 'longtext', 'Subtitle', def);
const body = (def: string) => f('body', 'longtext', 'Text', def);
const cta = (label: string, url: string, name = 'cta') => [
  f(`${name}_label`, 'text', 'Button label', label),
  f(`${name}_url`, 'link', 'Button link', url),
];
/** The small chips under a section title (WaDesk: meta1..4). */
const metas = (defaults: readonly string[]) =>
  defaults.map((d, i) => f(`meta${i + 1}`, 'text', `Detail ${i + 1}`, d));

function faqFields(
  defaults: ReadonlyArray<readonly [string, string]>,
  headlineText: string,
): CmsField[] {
  return [
    f('kicker', 'text', 'Kicker', 'Questions'),
    headline(headlineText),
    subtitle('Cannot find what you need? Write to us and a person will reply.'),
    ...defaults.flatMap(([q, a], i) => [
      f(`faq${i + 1}_q`, 'text', `Question ${i + 1}`, q),
      f(`faq${i + 1}_a`, 'longtext', `Answer ${i + 1}`, a),
    ]),
  ];
}

const section = (
  slug: string,
  label: string,
  fields: CmsField[],
  removable = true,
): CmsSection => ({
  slug,
  label,
  removable,
  fields,
});

const ctaFinal = (head: string, sub: string, kicker = 'Ready when you are'): CmsSection =>
  section('cta-final', 'Final CTA', [
    f('kicker', 'text', 'Kicker', kicker),
    headline(head),
    subtitle(sub),
    ...cta('Get started', '/register', 'cta'),
    ...cta('Talk to us', '/contact', 'cta2'),
  ]);

const logoStrip = (): CmsSection =>
  section('logo-strip', 'Logo strip', [
    f('label', 'text', 'Label', 'Built for teams in'),
    ...[
      'Retail',
      'Education',
      'Healthcare',
      'Finance',
      'Travel',
      'Logistics',
      'Media',
      'Services',
      'Software',
      'Community',
    ].map((n, i) => f(`logo${i + 1}_label`, 'text', `Name ${i + 1}`, n)),
  ]);

const pullQuote = (): CmsSection =>
  section('pull-quote', 'Pull quote', [
    f(
      'quote',
      'longtext',
      'Quote',
      'Replace this with a sentence that sums up what you stand for.',
    ),
    f('author_initials', 'text', 'Author initials', 'AB'),
    f('author', 'text', 'Author', 'Name Surname'),
    f('author_role', 'text', 'Author role', 'Role, Company'),
    f('stat', 'text', 'Highlight figure', '1'),
    f('stat_label', 'text', 'Highlight label', 'workspace for every conversation'),
  ]);

/** A product spotlight: title block, chips, a paragraph and a list of short tiles. */
const spotlight = (
  slug: string,
  label: string,
  eyebrowText: string,
  head: string,
  tiles: { name: string; count: number; titleKey: string; defaults: Array<Record<string, string>> },
  extra: CmsField[] = [],
): CmsSection =>
  section(slug, label, [
    eyebrow(eyebrowText),
    f('label', 'text', 'Section label', label.replace('Feature · ', '')),
    headline(head),
    ...metas([
      'Included in every plan',
      'Set up in minutes',
      'Works with your team',
      'Always in sync',
    ]),
    body('Describe what this part of the product does and who it is for.'),
    ...extra,
    ...repeat(
      tiles.name,
      tiles.count,
      [
        [tiles.titleKey, 'text', 'title'],
        ['desc', 'longtext', 'text'],
      ],
      tiles.defaults,
      'Tile',
    ),
    ...cta('Learn more', '/features', 'cta'),
  ]);

const six = (rows: ReadonlyArray<readonly [string, string]>, key: string) =>
  rows.map(([t, d]) => ({ [key]: t, desc: d }));

const pricingHero = (): CmsSection =>
  section(
    'hero',
    'Hero',
    [
      eyebrow('Pricing'),
      headline('Choose the plan that fits'),
      f('intro', 'longtext', 'Intro', 'Clear prices. Change or cancel whenever you like.'),
    ],
    false,
  );

export const CMS_REGISTRY: Record<CmsPage, CmsPageDef> = {
  home: {
    slug: 'home',
    label: 'Home',
    path: '/',
    sections: [
      section(
        'hero',
        'Hero',
        [
          eyebrow('Customer conversations, organised'),
          headline('Every customer conversation in one place'),
          subtitle(
            'Reach people on the channels they already use, answer from one shared inbox and keep every contact organised.',
          ),
          ...cta('Start free', '/register', 'cta1'),
          ...cta('See pricing', '/pricing', 'cta2'),
          f('stat1_label', 'text', 'Point 1', 'One shared inbox'),
          f('stat2_label', 'text', 'Point 2', 'Every channel'),
          f('stat3_label', 'text', 'Point 3', 'One workspace'),
        ],
        false,
      ),
      logoStrip(),
      section('manifesto', 'Manifesto', [
        eyebrow('Manifesto'),
        headline('Fewer tools. <em>Better</em> conversations.'),
        f('quote', 'longtext', 'Quote', 'We wanted one calm place to talk to customers, not five.'),
        f('author_initials', 'text', 'Author initials', 'AB'),
        f('author', 'text', 'Author', 'Name Surname'),
        f('author_role', 'text', 'Author role', 'Founder'),
        f('est_label', 'text', 'Established label', 'est.'),
        ...repeat(
          'stat',
          3,
          [
            ['value', 'text', 'value'],
            ['label', 'text', 'label'],
          ],
          [
            { value: 'One', label: 'workspace' },
            { value: 'Every', label: 'channel in one inbox' },
            { value: 'All', label: 'features on every plan' },
          ],
          'Figure',
        ),
      ]),
      spotlight(
        'feature-broadcasts',
        'Feature · Broadcasts',
        'Broadcasts',
        'Send the right message to the right people',
        {
          name: 'rail',
          count: 6,
          titleKey: 'title',
          defaults: six(
            [
              ['Audiences', 'Pick who receives a message from your contacts.'],
              ['Templates', 'Use approved messages your team can trust.'],
              ['Scheduling', 'Send now or at the best time.'],
              ['Personalisation', 'Fill in names and details automatically.'],
              ['Delivery tracking', 'See what was sent, delivered and read.'],
              ['Replies', 'Answers land in the shared inbox.'],
            ],
            'title',
          ),
        },
        [f('rail_title', 'text', 'List title', 'How a broadcast works')],
      ),
      spotlight(
        'feature-flows',
        'Feature · Flows',
        'Flows',
        'Automate the routine, hand over the rest',
        {
          name: 'tile',
          count: 4,
          titleKey: 'label',
          defaults: six(
            [
              ['Trigger', 'Start when a message, keyword or event arrives.'],
              ['Decide', 'Branch on what the customer said or who they are.'],
              ['Reply', 'Answer common questions straight away.'],
              ['Hand over', 'Pass the conversation to a person with context.'],
            ],
            'label',
          ),
        },
      ),
      spotlight(
        'feature-inbox',
        'Feature · Inbox',
        'Shared inbox',
        'One inbox for the whole team',
        {
          name: 'tile',
          count: 6,
          titleKey: 'title',
          defaults: six(
            [
              ['Assignment', 'Give every conversation an owner.'],
              ['Notes', 'Leave private notes for teammates.'],
              ['Saved replies', 'Answer common questions in one click.'],
              ['Labels', 'Group conversations your way.'],
              ['Search', 'Find any message in seconds.'],
              ['Status', 'See what is open, waiting or done.'],
            ],
            'title',
          ),
        },
      ),
      spotlight(
        'feature-templates',
        'Feature · Templates',
        'Templates',
        'Message templates that get approved',
        {
          name: 'step',
          count: 4,
          titleKey: 'title',
          defaults: six(
            [
              ['Write', 'Draft the message with variables.'],
              ['Check', 'Catch common problems before you submit.'],
              ['Submit', 'Send it for approval.'],
              ['Use', 'Send it as soon as it is approved.'],
            ],
            'title',
          ),
        },
        [
          f('how_title', 'text', 'How-to title', 'How it works'),
          f('how_body', 'longtext', 'How-to text', 'Write once, check it, submit it and reuse it.'),
          f('preflight_title', 'text', 'Checklist title', 'Before you submit'),
          f('preflight_badge', 'text', 'Checklist badge', 'Checklist'),
          ...[
            'Use a clear, specific purpose',
            'Keep variables in order',
            'Avoid shouting and extra symbols',
            'Add an opt-out where needed',
            'Match the language you select',
          ].map((r, i) => f(`rule${i + 1}`, 'text', `Rule ${i + 1}`, r)),
        ],
      ),
      section('feature-connectivity', 'Feature · Channels', [
        eyebrow('Channels'),
        f('label', 'text', 'Section label', 'Channels'),
        headline('Meet customers where they already are'),
        ...metas(['Connect in minutes', 'One inbox', 'Your own numbers', 'Secure by default']),
        body('Connect the channels you use and answer them all from one place.'),
        ...[1, 2, 3].flatMap((c) => [
          f(`card${c}_badge`, 'text', `Card ${c}: badge`, c === 1 ? 'Popular' : ''),
          f(`card${c}_channel`, 'text', `Card ${c}: channel`, `Channel ${c}`),
          f(`card${c}_name`, 'text', `Card ${c}: name`, `Channel name ${c}`),
          f(`card${c}_headline`, 'text', `Card ${c}: headline`, 'What it is good for'),
          f(`card${c}_desc`, 'longtext', `Card ${c}: text`, 'Describe how this channel works.'),
          ...[1, 2, 3, 4].flatMap((s) => [
            f(`card${c}_spec${s}_label`, 'text', `Card ${c} detail ${s}: label`, ''),
            f(`card${c}_spec${s}_value`, 'text', `Card ${c} detail ${s}: value`, ''),
          ]),
        ]),
      ]),
      section('use-cases', 'Use cases', [
        eyebrow('Use cases'),
        f('label', 'text', 'Section label', 'Use cases'),
        headline('Made for the way you work'),
        ...metas(['Sales', 'Support', 'Operations']),
        ...[1, 2, 3, 4].flatMap((c) => {
          const d = [
            [
              'Sales',
              'Follow up quickly',
              'Reply to new leads fast',
              'Keep every lead in view',
              'Hand over warm leads',
              'Track who said what',
            ],
            [
              'Support',
              'Resolve faster',
              'Share history across the team',
              'Answer common questions automatically',
              'Route by topic',
              'Keep notes private',
            ],
            [
              'Operations',
              'Stay in touch',
              'Send reminders',
              'Confirm appointments',
              'Share updates',
              'Collect replies',
            ],
            [
              'Community',
              'Keep people informed',
              'Announce news',
              'Answer questions',
              'Segment by interest',
              'Respect opt-outs',
            ],
          ][c - 1]!;
          return [
            f(`case${c}_cat`, 'text', `Case ${c}: category`, d[0]!),
            f(`case${c}_title`, 'text', `Case ${c}: title`, d[1]!),
            ...[2, 3, 4, 5].map((b) =>
              f(`case${c}_bullet${b - 1}`, 'text', `Case ${c}: point ${b - 1}`, d[b]!),
            ),
          ];
        }),
      ]),
      section('testimonials', 'Testimonials', [
        f('eyebrow_text', 'text', 'Eyebrow', 'Customers'),
        f('label', 'text', 'Section label', 'Customer stories'),
        headline('What customers say'),
        ...metas([
          'Add real quotes here',
          'Edit in the site editor',
          'Hide this section if unused',
        ]),
        ...repeat(
          'quote',
          2,
          [
            ['text', 'longtext', 'quote'],
            ['initials', 'text', 'initials'],
            ['author', 'text', 'author'],
            ['role', 'text', 'role'],
          ],
          [
            {
              text: 'Replace this with a real customer quote.',
              initials: 'AB',
              author: 'Name Surname',
              role: 'Role, Company',
            },
            {
              text: 'Replace this with a second customer quote.',
              initials: 'CD',
              author: 'Name Surname',
              role: 'Role, Company',
            },
          ],
          'Quote',
        ),
        f('feat_initials', 'text', 'Featured: initials', 'EF'),
        f('feat_author', 'text', 'Featured: author', 'Name Surname'),
        f('feat_role', 'text', 'Featured: role', 'Role, Company'),
        f('feat_stat', 'text', 'Featured: figure', ''),
        f('feat_stat_label', 'text', 'Featured: figure label', ''),
      ]),
      section('pricing-strip', 'Pricing cards', [
        eyebrow('Pricing'),
        headline('Simple plans that grow with you'),
        subtitle('Start free and upgrade when you need more.'),
        f('monthly_label', 'text', 'Monthly switch label', 'Monthly'),
        f('yearly_label', 'text', 'Yearly switch label', 'Yearly'),
        f('save_label', 'text', 'Savings badge text', 'Save {pct}%'),
        f('footnote', 'longtext', 'Footnote', 'Prices exclude taxes where applicable.'),
        ...repeat(
          'tier',
          3,
          [
            ['name', 'text', 'name'],
            ['badge', 'text', 'badge'],
            ['tagline', 'text', 'tagline'],
            ['price', 'text', 'price'],
            ['period', 'text', 'period'],
            ['cta_label', 'text', 'button label'],
          ],
          [
            {
              name: 'Starter',
              badge: '',
              tagline: 'For trying things out',
              price: 'Free',
              period: '',
              cta_label: 'Start free',
            },
            {
              name: 'Growth',
              badge: 'Popular',
              tagline: 'For growing teams',
              price: 'Contact us',
              period: '',
              cta_label: 'Talk to us',
            },
            {
              name: 'Scale',
              badge: '',
              tagline: 'For larger teams',
              price: 'Contact us',
              period: '',
              cta_label: 'Talk to us',
            },
          ],
          'Fallback plan',
        ),
      ]),
      section(
        'faq',
        'FAQ',
        faqFields(
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
      ),
      section('faq-slider', 'FAQ marquee', [
        f('kicker', 'text', 'Kicker', 'Quick answers'),
        headline('Questions, answered'),
        subtitle('The questions we hear most often.'),
      ]),
      ctaFinal('Ready to bring your conversations together?', 'Create a workspace in minutes.'),
    ],
  },
  features: {
    slug: 'features',
    label: 'Features',
    path: '/features',
    sections: [
      section(
        'hero',
        'Hero',
        [
          eyebrow('Features'),
          headline('Everything your team needs to talk to customers'),
          subtitle('One workspace for conversations, contacts and campaigns.'),
          ...[
            'Inbox',
            'Contacts',
            'Broadcasts',
            'Automation',
            'Templates',
            'Reports',
            'Teams',
            'Settings',
          ].map((c, i) => f(`chip${i + 1}`, 'text', `Chip ${i + 1}`, c)),
        ],
        false,
      ),
      logoStrip(),
      section('feature-bento', 'Feature bento', [
        eyebrow('What is inside'),
        headline('What is inside'),
        ...repeat(
          'item',
          12,
          [...TITLE_BODY],
          six(
            [
              ['Shared inbox', 'Every conversation in one view, with owners and statuses.'],
              ['Contacts', 'Profiles, tags and custom fields that stay in sync.'],
              ['Broadcasts', 'Reach segments with approved messages.'],
              ['Automation', 'Replies and routing that run without manual work.'],
              ['Templates', 'Reusable messages your team can trust.'],
              ['Reports', 'See response times and volumes at a glance.'],
              ['Teams', 'Roles and permissions for everyone who joins.'],
              ['Notes', 'Private context beside every conversation.'],
              ['Search', 'Find a person or a message at once.'],
              ['Segments', 'Save the groups you message most.'],
              ['Integrations', 'Connect the tools you already use.'],
              ['Security', 'Sign-in protection and an audit trail.'],
            ],
            'title',
          ).map((r) => ({ title: r.title!, body: r.desc! })),
          'Feature',
        ),
      ]),
      section('pillars-three', 'Three pillars', [
        eyebrow('Principles'),
        headline('Three ideas behind the product'),
        ...repeat(
          'pillar',
          3,
          [
            ['label', 'text', 'label'],
            ['title', 'text', 'title'],
            ['body', 'longtext', 'text'],
          ],
          [
            { label: 'One', title: 'Clarity', body: 'Know who said what, and what happens next.' },
            { label: 'Two', title: 'Speed', body: 'Answer in seconds, not hours.' },
            { label: 'Three', title: 'Control', body: 'Decide who can see and change what.' },
          ],
          'Pillar',
        ),
      ]),
      pullQuote(),
      section(
        'faq',
        'FAQ',
        faqFields(
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
      ),
      ctaFinal('See it with your own data', 'Start free and invite your team.'),
    ],
  },
  pricing: {
    slug: 'pricing',
    label: 'Pricing',
    path: '/pricing',
    sections: [
      pricingHero(),
      section('pricing-strip', 'Pricing cards', [
        headline('Compare plans'),
        f('monthly_label', 'text', 'Monthly switch label', 'Monthly'),
        f('yearly_label', 'text', 'Yearly switch label', 'Yearly'),
        f('save_label', 'text', 'Savings badge text', 'Save {pct}%'),
        f('footnote', 'longtext', 'Footnote', 'Prices exclude taxes where applicable.'),
        ...repeat(
          'tier',
          3,
          [
            ['name', 'text', 'name'],
            ['badge', 'text', 'badge'],
            ['tagline', 'text', 'tagline'],
            ['price', 'text', 'price'],
            ['period', 'text', 'period'],
            ['cta_label', 'text', 'button label'],
          ],
          [
            {
              name: 'Starter',
              badge: '',
              tagline: 'For trying things out',
              price: 'Free',
              period: '',
              cta_label: 'Start free',
            },
            {
              name: 'Growth',
              badge: 'Popular',
              tagline: 'For growing teams',
              price: 'Contact us',
              period: '',
              cta_label: 'Talk to us',
            },
            {
              name: 'Scale',
              badge: '',
              tagline: 'For larger teams',
              price: 'Contact us',
              period: '',
              cta_label: 'Talk to us',
            },
          ],
          'Fallback plan',
        ),
      ]),
      section(
        'faq',
        'FAQ',
        faqFields(
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
      ),
      ctaFinal('Start with the plan that fits today', 'Switch whenever your needs change.'),
    ],
  },
  about: {
    slug: 'about',
    label: 'About',
    path: '/about',
    sections: [
      section(
        'hero',
        'Hero',
        [
          eyebrow('About us'),
          headline('We help teams talk to their customers'),
          f(
            'intro',
            'longtext',
            'Intro',
            'A small, focused team building calm software for busy people.',
          ),
          ...repeat(
            'stat',
            3,
            [
              ['value', 'text', 'value'],
              ['label', 'text', 'label'],
            ],
            [
              { value: 'One', label: 'product' },
              { value: 'Every', label: 'conversation in one place' },
              { value: 'All', label: 'features on every plan' },
            ],
            'Figure',
          ),
        ],
        false,
      ),
      section('origin-story', 'Origin story', [
        eyebrow('Our story'),
        f('sublabel', 'text', 'Sub label', 'Why we built this'),
        f('location', 'text', 'Location', 'Where we are based'),
        f('since', 'text', 'Since', 'Since the start'),
        f(
          'para1',
          'longtext',
          'Paragraph 1',
          'Replace this paragraph with the story of your company and the problem you set out to solve.',
        ),
        f('para2', 'longtext', 'Paragraph 2', 'Add a second paragraph about how the product grew.'),
        f('glance_label', 'text', 'At-a-glance title', 'At a glance'),
        ...repeat(
          'glance_r',
          6,
          [
            ['label', 'text', 'label'],
            ['value', 'text', 'value'],
          ],
          [
            { label: 'Focus', value: 'Customer conversations' },
            { label: 'Product', value: 'Inbox, contacts, broadcasts' },
            { label: 'Plans', value: 'Free to start' },
            { label: 'Support', value: 'Within one working day' },
            { label: 'Focus', value: 'Customer conversations' },
            { label: 'Contact', value: 'See the contact page' },
          ],
          'Row',
        ),
      ]),
      section('values', 'Values', [
        eyebrow('Values'),
        f('sublabel', 'text', 'Sub label', 'What we care about'),
        f('caption', 'text', 'Caption', 'The ideas we build around'),
        headline('What we care about'),
        ...repeat(
          'item',
          3,
          [...TITLE_BODY],
          [
            { title: 'Be useful', body: 'Build what people need, not what looks impressive.' },
            { title: 'Be honest', body: 'Say what the product does and what it does not.' },
            { title: 'Be reliable', body: 'Make the basics work every single day.' },
          ],
          'Value',
        ),
      ]),
      section('timeline', 'Timeline', [
        eyebrow('Timeline'),
        f('sublabel', 'text', 'Sub label', 'How we got here'),
        ...repeat(
          'step',
          4,
          [
            ['year', 'text', 'year'],
            ['title', 'text', 'title'],
            ['body', 'longtext', 'text'],
          ],
          [
            { year: 'Step 1', title: 'The idea', body: 'Describe how it started.' },
            { year: 'Step 2', title: 'First customers', body: 'Describe the first users.' },
            { year: 'Step 3', title: 'Growth', body: 'Describe what changed.' },
            { year: 'Step 4', title: 'Today', body: 'Describe where you are now.' },
          ],
          'Milestone',
        ),
      ]),
      section('numbers', 'Numbers', [
        eyebrow('Numbers'),
        f('sublabel', 'text', 'Sub label', 'Add your own figures'),
        ...repeat(
          'stat',
          4,
          [
            ['value', 'text', 'value'],
            ['label', 'text', 'label'],
          ],
          [
            { value: 'Shared', label: 'inbox' },
            { value: 'Simple', label: 'setup' },
            { value: 'Clear', label: 'pricing' },
            { value: 'Real', label: 'support' },
          ],
          'Figure',
        ),
      ]),
      section('press', 'Press', [
        eyebrow('Press'),
        f('sublabel', 'text', 'Sub label', 'In the news'),
        headline('Words from others'),
        ...repeat(
          'item',
          3,
          [
            ['source', 'text', 'source'],
            ['text', 'longtext', 'text'],
          ],
          [
            { source: 'Publication', text: 'Add a quote from the press.' },
            { source: 'Publication', text: 'Add a quote from the press.' },
            { source: 'Publication', text: 'Add a quote from the press.' },
          ],
          'Mention',
        ),
      ]),
      section('backers', 'Backers', [
        eyebrow('Backers'),
        f('sublabel', 'text', 'Sub label', 'Who supports us'),
        f('operators_label', 'text', 'List label', 'Supporters'),
        ...[1, 2, 3, 4].map((i) => f(`backer${i}_name`, 'text', `Name ${i}`, `Supporter ${i}`)),
      ]),
      pullQuote(),
      ctaFinal('Want to talk?', 'We would like to hear from you.'),
    ],
  },
  contact: {
    slug: 'contact',
    label: 'Contact',
    path: '/contact',
    sections: [
      section(
        'hero',
        'Hero',
        [
          eyebrow('Contact'),
          headline('Tell us how we can help'),
          f('intro', 'longtext', 'Intro', 'Send a message and a person on the team will reply.'),
          ...repeat(
            'stat',
            3,
            [
              ['value', 'text', 'value'],
              ['label', 'text', 'label'],
            ],
            [
              { value: '1', label: 'working day to reply' },
              { value: 'Real', label: 'people on the team' },
              { value: 'Any', label: 'question welcome' },
            ],
            'Figure',
          ),
        ],
        false,
      ),
      section('channels', 'Channels', [
        eyebrow('Ways to reach us'),
        f('sublabel', 'text', 'Sub label', 'Pick what suits you'),
        f('caption1', 'text', 'Caption 1', 'We read everything'),
        f('caption2', 'text', 'Caption 2', 'Pick a channel'),
        f('bestfor_label', 'text', 'Best-for label', 'Best for'),
        f('replytime_label', 'text', 'Reply-time label', 'Usually replies'),
        ...repeat(
          'ch',
          3,
          [
            ['badge', 'text', 'badge'],
            ['label', 'text', 'label'],
            ['title', 'text', 'title'],
            ['desc', 'longtext', 'text'],
            ['bestfor', 'text', 'best for'],
            ['replytime', 'text', 'reply time'],
          ],
          [
            {
              badge: '',
              label: 'Email',
              title: 'Write to us',
              desc: 'Write to us any time.',
              bestfor: 'Questions and feedback',
              replytime: 'Within a working day',
            },
            {
              badge: 'Fast',
              label: 'Chat',
              title: 'Message us',
              desc: 'Message us on WhatsApp.',
              bestfor: 'Quick questions',
              replytime: 'Within hours',
            },
            {
              badge: '',
              label: 'Sales',
              title: 'Talk to sales',
              desc: 'Talk to us about plans and onboarding.',
              bestfor: 'Plans and demos',
              replytime: 'Within a working day',
            },
          ],
          'Channel',
        ),
        f('office_label', 'text', 'Office block label', 'Head office'),
      ]),
      section('form', 'Contact form', [
        eyebrow('Send a message'),
        f('sublabel', 'text', 'Sub label', 'We reply to every message'),
        f('caption', 'text', 'Caption', 'Tell us a little about what you need'),
        headline('Send us a message'),
        f('name_label', 'text', 'Name label', 'Your name'),
        f('email_label', 'text', 'Email label', 'Work email'),
        f('company_label', 'text', 'Company label', 'Company (optional)'),
        f('topic_label', 'text', 'Topic label', 'What is this about?'),
        f('message_label', 'text', 'Message label', 'Message'),
        f('sla', 'text', 'Reply promise', 'We aim to reply within one working day.'),
        f('submit_label', 'text', 'Button label', 'Send message'),
        f('success_title', 'text', 'Success title', 'Message sent'),
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
      ]),
      section(
        'faq',
        'FAQ',
        faqFields(
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
      ),
      ctaFinal('Prefer to start right away?', 'Create a workspace and look around.'),
    ],
  },
};

// --- site chrome (shared by every page) ---------------------------------------------------------------------------

/** The navigation, the ticker's fallback lines and the footer, edited next to the pages but not hideable or orderable. */
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
    slug: 'ticker',
    label: 'Ticker',
    removable: false,
    fields: [
      'Welcome. Take a look around.',
      'Start free and invite your team.',
      'Questions? Write to us any time.',
      'Every feature, on every plan.',
      'Read the latest on the blog.',
    ].map((m, i) => f(`message${i + 1}`, 'text', `Fallback message ${i + 1}`, m)),
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

/** WaDesk's panel groups: WhatsApp (here "Brand"), ink, paper and accent. */
export const THEME_GROUPS = ['wa', 'ink', 'paper', 'accent'] as const;
export type ThemeGroup = (typeof THEME_GROUPS)[number];
export const THEME_GROUP_LABELS: Record<ThemeGroup, string> = {
  wa: 'Brand',
  ink: 'Ink (text)',
  paper: 'Paper (bg)',
  accent: 'Accent',
};

export interface ThemeToken {
  /** The last two segments of the content key: `theme.wa.deep`. */
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

/** The 24 colour tokens of WaDesk's palette, with its shipped values. */
export const THEME_TOKENS: readonly ThemeToken[] = [
  t('wa.deep', 'Deep', '#075E54'),
  t('wa.teal', 'Teal', '#128C7E'),
  t('wa.green', 'Green', '#25D366'),
  t('wa.mint', 'Mint', '#DCF8C6'),
  t('wa.bubble', 'Bubble', '#E7FFDB'),
  t('wa.chat', 'Chat', '#ECE5DD'),
  t('ink.950', '950', '#070D0C'),
  t('ink.900', '900', '#0B1F1C'),
  t('ink.800', '800', '#13312D'),
  t('ink.700', '700', '#1F4540'),
  t('ink.600', '600', '#3A5A55'),
  t('ink.500', '500', '#6B807C'),
  t('ink.400', '400', '#9AA8A4'),
  t('ink.300', '300', '#C3CCC9'),
  t('paper.0', '0', '#FBFAF6'),
  t('paper.50', '50', '#F5F3EC'),
  t('paper.100', '100', '#EFEBE0'),
  t('paper.200', '200', '#E5DFD0'),
  t('paper.300', '300', '#D4CCB6'),
  t('accent.coral', 'Coral', '#E87A5D'),
  t('accent.amber', 'Amber', '#E5A04E'),
  t('accent.sand', 'Sand', '#D9C9A3'),
  t('accent.plum', 'Plum', '#5B3D8A'),
  t('accent.sky', 'Sky', '#3E7AA1'),
];

export const THEME_KEYS: readonly string[] = THEME_TOKENS.map((x) => `theme.${x.key}`);

/** One-click re-skins: they rewrite the brand and the two warm accents only, never ink or paper (WaDesk's six presets). */
export const THEME_PRESETS: ReadonlyArray<{
  id: string;
  label: string;
  swatch: string;
  tokens: Record<string, string>;
}> = [
  {
    id: 'emerald',
    label: 'Emerald',
    swatch: '#075E54',
    tokens: {
      'wa.deep': '#075E54',
      'wa.teal': '#128C7E',
      'wa.green': '#25D366',
      'wa.mint': '#DCF8C6',
      'wa.bubble': '#E7FFDB',
      'accent.coral': '#E87A5D',
      'accent.amber': '#E5A04E',
    },
  },
  {
    id: 'ocean',
    label: 'Ocean',
    swatch: '#0B4F6C',
    tokens: {
      'wa.deep': '#0B4F6C',
      'wa.teal': '#1B98C9',
      'wa.green': '#20A4F3',
      'wa.mint': '#CDEFFF',
      'wa.bubble': '#E3F6FF',
      'accent.coral': '#FF8552',
      'accent.amber': '#FFB627',
    },
  },
  {
    id: 'forest',
    label: 'Forest',
    swatch: '#1B4332',
    tokens: {
      'wa.deep': '#1B4332',
      'wa.teal': '#2D6A4F',
      'wa.green': '#40916C',
      'wa.mint': '#D8F3DC',
      'wa.bubble': '#E9F7EF',
      'accent.coral': '#E76F51',
      'accent.amber': '#E9C46A',
    },
  },
  {
    id: 'royal',
    label: 'Royal',
    swatch: '#4A2C6F',
    tokens: {
      'wa.deep': '#4A2C6F',
      'wa.teal': '#6C3FA0',
      'wa.green': '#9B59D0',
      'wa.mint': '#EADCF7',
      'wa.bubble': '#F3EAFB',
      'accent.coral': '#E0689A',
      'accent.amber': '#E5A04E',
    },
  },
  {
    id: 'sunset',
    label: 'Sunset',
    swatch: '#B23A48',
    tokens: {
      'wa.deep': '#B23A48',
      'wa.teal': '#D9594C',
      'wa.green': '#F08A4B',
      'wa.mint': '#FCE4D6',
      'wa.bubble': '#FFEFE3',
      'accent.coral': '#E5533D',
      'accent.amber': '#F2A65A',
    },
  },
  {
    id: 'slate',
    label: 'Slate',
    swatch: '#2B2D42',
    tokens: {
      'wa.deep': '#2B2D42',
      'wa.teal': '#4A4E69',
      'wa.green': '#5C8A72',
      'wa.mint': '#E2E4ED',
      'wa.bubble': '#EDEEF4',
      'accent.coral': '#D98B7B',
      'accent.amber': '#C9A86A',
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
  // Whitespace and control characters (code points up to 0x1f) are never valid here.
  if (v === '' || v.length > 500 || /\s/.test(v) || [...v].some((c) => c.charCodeAt(0) <= 0x1f)) {
    return false;
  }
  if (v.startsWith('//')) return false;
  return /^(\/|#|https?:\/\/|mailto:|tel:)/i.test(v);
}

export const isHexColor = (value: string): boolean =>
  /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim());
