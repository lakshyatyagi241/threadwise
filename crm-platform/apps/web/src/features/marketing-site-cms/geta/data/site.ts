import type { IconName } from '../icons';
import { CHANNELS } from './channels';
import { ALL_PRODUCTS, PRODUCTS, hrefOf } from './products';
import { INDUSTRIES, USE_CASES } from './solutions';
import type { Faq } from './products';

/** Fallback brand name when the platform settings have none. */
export const DEFAULT_BRAND = 'Geta';

export const HOME = {
  eyebrow: 'Leads, conversations and follow-ups in one place',
  lead: 'One platform, built around your',
  sub: 'Capture every lead, reply on WhatsApp, your website, Instagram or email, and follow up from one place, with automation and AI where they help. Turn on only what your business needs.',
  assurances: [
    'Automation and AI where they help',
    'Official WhatsApp Cloud API',
    'Turn on only what you need',
  ],
};

export const HOME_PILLARS: Array<{ title: string; text: string; icon: IconName; href: string }> = [
  {
    title: 'AI agents',
    text: 'Agents trained on your content that answer, qualify and hand over to your team.',
    icon: 'sparkle',
    href: '/products/ai-agents',
  },
  {
    title: 'Engagement',
    text: 'A shared inbox, WhatsApp and other channels, flows and campaigns.',
    icon: 'inbox',
    href: '/products/team-inbox',
  },
  {
    title: 'CRM',
    text: 'Contacts, deals, tasks and appointments that update from every conversation.',
    icon: 'contact',
    href: '/products/crm',
  },
  {
    title: 'Integrations',
    text: 'REST API, signed webhooks and store connections for your stack.',
    icon: 'plug',
    href: '/products/integrations-api',
  },
];

/** The agent types shown in the "one agent, every channel" section. */
export const HOME_AGENTS: Array<{
  id: string;
  label: string;
  icon: IconName;
  headline: string;
  body: string;
  bullets: string[];
  href: string;
  chat: Array<{ from: 'customer' | 'business'; text: string }>;
}> = [
  {
    id: 'web',
    label: 'Web agent',
    icon: 'widget',
    headline: 'Greets every visitor and qualifies the lead',
    body: 'A chat widget on your website that answers from your own content, asks the right questions and creates the contact before your team sees it.',
    bullets: [
      'One snippet to install',
      'Pre-chat form captures name and email',
      'Creates the CRM contact instantly',
    ],
    href: '/products/channels/web-chat',
    chat: [
      { from: 'customer', text: 'Do you offer a free trial?' },
      { from: 'business', text: 'Yes. Is this for you or a team? I can set up the right one.' },
      { from: 'customer', text: 'A team of 8.' },
      { from: 'business', text: 'Great, I have noted that and asked Meera to follow up today.' },
    ],
  },
  {
    id: 'whatsapp',
    label: 'WhatsApp agent',
    icon: 'whatsapp',
    headline: 'Meets customers where they already chat',
    body: 'An agent on the official WhatsApp Business API that handles inbound questions, qualifies intent and hands over with the whole conversation attached.',
    bullets: [
      'Official Cloud API connection',
      'Approved templates for outbound',
      'Hands over to a person on your rules',
    ],
    href: '/products/channels/whatsapp',
    chat: [
      { from: 'customer', text: 'Is the 2 BHK still available?' },
      { from: 'business', text: 'Yes. What budget and move-in date should I note?' },
      { from: 'customer', text: '80 lakh, next month.' },
      { from: 'business', text: 'Noted. Priya will confirm a visit time shortly.' },
    ],
  },
  {
    id: 'qualify',
    label: 'Lead qualification',
    icon: 'target',
    headline: 'Sorts hot leads from the rest, automatically',
    body: 'Ask the questions that matter, save the answers to the contact, and route the right leads to the right person while the rest join a nurture campaign.',
    bullets: [
      'Answers saved to contact fields',
      'Routing by team, tag or rule',
      'Deals and tasks created for hot leads',
    ],
    href: '/products/ai-agents',
    chat: [
      { from: 'business', text: 'What are you hoping to achieve in the next 3 months?' },
      { from: 'customer', text: 'Cut our response time.' },
      { from: 'business', text: 'Thanks. I have tagged you as high intent and booked a call.' },
    ],
  },
];

/** The loop the platform runs, from first touch to repeat customer. */
export const HOME_LOOP: Array<{ title: string; text: string; icon: IconName }> = [
  { title: 'Capture', text: 'Forms, links, ads and chat bring leads in.', icon: 'form' },
  { title: 'Qualify', text: 'AI agents ask, answer and score.', icon: 'sparkle' },
  { title: 'Assign', text: 'Routing puts it with the right person.', icon: 'route' },
  { title: 'Convert', text: 'Deals, tasks, quotes and payments.', icon: 'kanban' },
  { title: 'Retain', text: 'Campaigns and updates bring them back.', icon: 'megaphone' },
];

/** A sample of what the workspace looks like while it works. Illustrative, not live data. */
export const LIVE_ACTIVITY: Array<{
  tone: 'blue' | 'green' | 'amber' | 'violet' | 'rose';
  who: string;
  what: string;
}> = [
  { tone: 'green', who: 'AI agent', what: 'Qualified a new lead from the website chat' },
  { tone: 'blue', who: 'Inbox', what: 'Chat routed to the Sales team' },
  { tone: 'amber', who: 'Broadcast', what: 'Reminder sent to the “Trial users” segment' },
  { tone: 'violet', who: 'CRM', what: 'Deal moved from Proposal to Negotiation' },
  { tone: 'rose', who: 'Appointment', what: 'Site visit confirmed for Friday 11 am' },
];

export const HOME_WHY: Array<{ title: string; text: string; icon: IconName }> = [
  {
    title: 'AI and CRM in one place',
    text: 'Agents work the conversation while contacts, deals and tasks update themselves, so nobody re-types anything.',
    icon: 'chat',
  },
  {
    title: 'Official channels',
    text: 'WhatsApp through the official Cloud API, not workarounds.',
    icon: 'shield',
  },
  {
    title: 'Your own AI, your own key',
    text: 'Train agents on your content and bring your own provider key for control of model and cost.',
    icon: 'sparkle',
  },
  {
    title: 'Made for teams',
    text: 'Roles, permissions, routing and audit trails from the first seat.',
    icon: 'users',
  },
];

export const HOME_FAQ: Faq[] = [
  {
    q: 'What is this platform?',
    a: 'It is an agentic AI engagement platform with a CRM built in: AI agents, a shared inbox, WhatsApp and other channels, flows, campaigns, contacts and deals in one workspace.',
  },
  {
    q: 'Which channels do you support?',
    a: 'WhatsApp (official Cloud API), Instagram, Facebook Messenger, Telegram and a website chat widget.',
  },
  {
    q: 'Do I need technical skills?',
    a: 'No. Setup is guided and flows are built visually. Developers get a REST API and webhooks when they want them.',
  },
  {
    q: 'Can I try it before I pay?',
    a: 'Yes. Start a free trial and look around your own workspace, or contact us and we will walk you through it.',
  },
  {
    q: 'Is my data safe?',
    a: 'Each workspace is isolated from every other, access is controlled by roles, and sensitive actions are logged. See the Security page for detail.',
  },
  {
    q: 'Can I connect my own systems?',
    a: 'Yes, through the REST API, signed outbound webhooks and store connections.',
  },
  {
    q: 'Does it work for my industry?',
    a: 'It is built to be generic. We have guides for healthcare, real estate, education, e-commerce and sales teams, and the same building blocks fit others.',
  },
  {
    q: 'How do I get help?',
    a: 'There is a built-in help center and you can contact us from the Contact page.',
  },
];

/** The "what do you want to do?" quiz on /get-started. Each goal points at products and a solution page. */
export const GOALS: Array<{
  id: string;
  label: string;
  icon: IconName;
  products: string[];
  solution: { kind: 'industry' | 'usecase'; slug: string };
}> = [
  {
    id: 'leads',
    label: 'Get more leads and reply faster',
    icon: 'target',
    products: ['forms-lead-capture', 'ai-agents', 'crm'],
    solution: { kind: 'usecase', slug: 'lead-generation' },
  },
  {
    id: 'support',
    label: 'Support customers without a long queue',
    icon: 'headset',
    products: ['team-inbox', 'ai-agents', 'chatbots-flows'],
    solution: { kind: 'usecase', slug: 'customer-support' },
  },
  {
    id: 'marketing',
    label: 'Send campaigns on WhatsApp',
    icon: 'megaphone',
    products: ['whatsapp', 'broadcasts-campaigns', 'crm'],
    solution: { kind: 'usecase', slug: 'whatsapp-marketing' },
  },
  {
    id: 'bookings',
    label: 'Take bookings and cut no-shows',
    icon: 'calendar',
    products: ['crm', 'whatsapp', 'chatbots-flows'],
    solution: { kind: 'usecase', slug: 'appointment-booking' },
  },
  {
    id: 'orders',
    label: 'Update customers about orders and payments',
    icon: 'card',
    products: ['commerce', 'integrations-api', 'whatsapp'],
    solution: { kind: 'usecase', slug: 'order-updates' },
  },
  {
    id: 'pipeline',
    label: 'Manage a sales pipeline',
    icon: 'kanban',
    products: ['crm', 'broadcasts-campaigns', 'team-inbox'],
    solution: { kind: 'industry', slug: 'sales-teams' },
  },
];

export const TEAMS: Array<{
  id: string;
  label: string;
  solution: { kind: 'industry' | 'usecase'; slug: string } | null;
}> = [
  { id: 'health', label: 'Clinic or hospital', solution: { kind: 'industry', slug: 'healthcare' } },
  { id: 're', label: 'Real estate', solution: { kind: 'industry', slug: 'real-estate' } },
  {
    id: 'edu',
    label: 'School, college or training',
    solution: { kind: 'industry', slug: 'education' },
  },
  { id: 'shop', label: 'Online store', solution: { kind: 'industry', slug: 'ecommerce' } },
  { id: 'sales', label: 'Sales team', solution: { kind: 'industry', slug: 'sales-teams' } },
  { id: 'other', label: 'Something else', solution: null },
];

export interface NavLink {
  label: string;
  href: string;
  desc?: string;
  icon?: IconName;
}

export const NAV_PRODUCT_GROUPS = (['engage', 'automate', 'grow', 'connect'] as const).map((g) => ({
  group: g,
  items: PRODUCTS.filter((p) => p.group === g).map<NavLink>((p) => ({
    label: p.name,
    href: hrefOf(p),
    desc: p.short,
    icon: p.icon,
  })),
}));

export const NAV_CHANNELS: NavLink[] = CHANNELS.map((c) => ({
  label: c.name,
  href: hrefOf(c),
  desc: c.short,
  icon: c.icon,
}));

/** Every product, flat, for the Product menu and the footer. */
export const NAV_PRODUCTS: NavLink[] = PRODUCTS.map((p) => ({
  label: p.name,
  href: hrefOf(p),
  desc: p.short,
  icon: p.icon,
}));

/** The channels shown in the Product menu; the rest are one click away on the channels page. */
const MENU_CHANNELS = ['whatsapp', 'email', 'sms', 'voice', 'instagram', 'web-chat'];
export const NAV_CHANNELS_MENU: NavLink[] = MENU_CHANNELS.flatMap((slug) => {
  const c = CHANNELS.find((x) => x.slug === slug);
  return c ? [{ label: c.name, href: hrefOf(c), desc: c.short, icon: c.icon }] : [];
});

export const NAV_INDUSTRIES: NavLink[] = INDUSTRIES.map((s) => ({
  label: s.name,
  href: `/solutions/${s.slug}`,
  desc: s.short,
  icon: s.icon,
}));
export const NAV_USE_CASES: NavLink[] = USE_CASES.map((s) => ({
  label: s.name,
  href: `/use-cases/${s.slug}`,
  desc: s.short,
  icon: s.icon,
}));

export const NAV_RESOURCES: NavLink[] = [
  { label: 'Blog', href: '/blog', desc: 'Guides and product news.', icon: 'doc' },
  {
    label: 'API documentation',
    href: '/developers/docs',
    desc: 'Reference for developers.',
    icon: 'code',
  },
  {
    label: 'Find your fit',
    href: '/get-started',
    desc: 'Answer three questions, get a plan.',
    icon: 'search',
  },
];

export const NAV_COMPANY: NavLink[] = [
  { label: 'About', href: '/about' },
  { label: 'Security', href: '/security' },
  { label: 'Contact', href: '/contact' },
];

export const SECURITY_POINTS: Array<{ title: string; text: string; icon: IconName }> = [
  {
    title: 'Workspace isolation',
    text: 'Every workspace’s data is separated at the database level, so one customer can never read another’s.',
    icon: 'layers',
  },
  {
    title: 'Roles and permissions',
    text: 'Control exactly who can see chats, numbers, settings and billing.',
    icon: 'lock',
  },
  {
    title: 'Two-step sign-in',
    text: 'Protect accounts with authenticator-app verification.',
    icon: 'shield',
  },
  {
    title: 'Audit trail',
    text: 'Sensitive actions are recorded so you can see who changed what and when.',
    icon: 'list',
  },
  {
    title: 'Signed webhooks',
    text: 'Outbound requests are signed with a secret you can rotate at any time.',
    icon: 'webhook',
  },
  {
    title: 'Official channel APIs',
    text: 'WhatsApp, Instagram and Facebook connect through their official platforms.',
    icon: 'check',
  },
];

export const ABOUT_VALUES: Array<{ title: string; text: string; icon: IconName }> = [
  {
    title: 'Conversations first',
    text: 'Customers already talk in chat. We build tools that meet them there.',
    icon: 'chat',
  },
  {
    title: 'One system, not ten tabs',
    text: 'Inbox, automation, campaigns and CRM belong together.',
    icon: 'layers',
  },
  {
    title: 'Plain and honest',
    text: 'Clear limits, clear permissions and clear documentation.',
    icon: 'check',
  },
];

export const PRICING_FAQ: Faq[] = [
  {
    q: 'Can I change plans later?',
    a: 'Yes. You can upgrade or downgrade from your account at any time.',
  },
  {
    q: 'How much does it cost?',
    a: 'It depends on the modules you turn on and your volumes. Contact us and we will send a quote the same day.',
  },
  {
    q: 'Is there a free trial?',
    a: 'Yes, you can start a free trial and look around your workspace. Contact us if you would like help getting set up.',
  },
  {
    q: 'Are WhatsApp conversation charges included?',
    a: 'WhatsApp charges for business conversations separately from the platform plan. We show those charges in your wallet so there are no surprises.',
  },
  {
    q: 'Do you offer custom plans?',
    a: 'Yes. Contact us for larger volumes or special requirements.',
  },
];

/** Every static public page, for sitemap.xml. */
export const SITEMAP_PAGES = [
  ...['/platform', '/features', '/pricing', '/get-started', '/about', '/security'].map((loc) => ({
    loc,
    priority: '0.8',
  })),
  ...ALL_PRODUCTS.map((p) => ({ loc: hrefOf(p), priority: '0.8' })),
  { loc: '/products/channels', priority: '0.8' },
  { loc: '/delete-account', priority: '0.4' },
  ...INDUSTRIES.map((s) => ({ loc: `/solutions/${s.slug}`, priority: '0.7' })),
  ...USE_CASES.map((s) => ({ loc: `/use-cases/${s.slug}`, priority: '0.7' })),
];

/** The five layers of the platform, bottom to top: this is the map the home and platform pages are built on. */
export const PLATFORM_LAYERS: Array<{
  n: string;
  title: string;
  text: string;
  icon: IconName;
  href: string;
}> = [
  {
    n: '01',
    title: 'Agentic layer',
    text: 'AI agents, flows and automation that answer, qualify and act on every conversation.',
    icon: 'sparkle',
    href: '/products/ai-agents',
  },
  {
    n: '02',
    title: 'Engagement layer',
    text: 'Shared inbox, WhatsApp, Instagram, Facebook, Telegram and web chat, plus campaigns and forms.',
    icon: 'inbox',
    href: '/products/team-inbox',
  },
  {
    n: '03',
    title: 'CRM layer',
    text: 'Contacts, companies, deals, tasks and appointments, updated by every message.',
    icon: 'contact',
    href: '/products/crm',
  },
  {
    n: '04',
    title: 'Integration layer',
    text: 'REST API, signed webhooks, store connections, Google Sheets and a Chrome extension.',
    icon: 'plug',
    href: '/products/integrations-api',
  },
  {
    n: '05',
    title: 'Extension layer',
    text: 'The Marketplace for mini apps and integrations, and add-ons that stack on your plan.',
    icon: 'puzzle',
    href: '/products/marketplace',
  },
];

/** Screenshots of the running app. A file is only used when it exists in public/geta/shots (see shots.ts). */
export const SHOTS: Array<{ id: string; label: string; alt: string; caption: string }> = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    alt: 'The dashboard with message and lead activity',
    caption: 'See conversations, leads and team activity at a glance.',
  },
  {
    id: 'inbox',
    label: 'Team inbox',
    alt: 'The team inbox with an open conversation',
    caption: 'Every channel in one shared inbox, routed to the right person.',
  },
  {
    id: 'contacts',
    label: 'CRM',
    alt: 'The contacts list in the CRM',
    caption: 'One contact record behind every chat, form and campaign.',
  },
  {
    id: 'deals',
    label: 'Deals',
    alt: 'A deals pipeline board with several stages',
    caption: 'Move deals across stages without leaving the conversation.',
  },
  {
    id: 'flow-builder',
    label: 'Flow builder',
    alt: 'The visual flow builder canvas',
    caption: 'Design bots on a visual canvas and publish when ready.',
  },
  {
    id: 'ai-agents',
    label: 'AI agents',
    alt: 'The AI agent training screen',
    caption: 'Train an agent on your own content and set its limits.',
  },
  {
    id: 'broadcasts',
    label: 'Broadcasts',
    alt: 'The broadcasts and campaigns screen',
    caption: 'Send to segments and track delivery, reads and replies.',
  },
  {
    id: 'marketplace',
    label: 'Marketplace',
    alt: 'The Marketplace of mini apps and integrations',
    caption: 'Install mini apps and integrations after reviewing permissions.',
  },
];

/** Which screenshot best illustrates a product page. */
export const PRODUCT_SHOT: Record<string, string> = {
  'team-inbox': 'inbox',
  whatsapp: 'inbox',
  email: 'inbox',
  sms: 'broadcasts',
  voice: 'inbox',
  instagram: 'inbox',
  facebook: 'inbox',
  telegram: 'inbox',
  'web-chat': 'inbox',
  line: 'inbox',
  viber: 'inbox',
  wechat: 'inbox',
  'broadcasts-campaigns': 'broadcasts',
  'chatbots-flows': 'flow-builder',
  'ai-agents': 'ai-agents',
  crm: 'deals',
  'forms-lead-capture': 'contacts',
  commerce: 'dashboard',
  'integrations-api': 'marketplace',
  marketplace: 'marketplace',
};

export const INTEGRATION_TILES: Array<{ name: string; icon: IconName; note: string }> = [
  { name: 'WhatsApp', icon: 'whatsapp', note: 'Cloud API' },
  { name: 'Instagram', icon: 'instagram', note: 'Direct messages' },
  { name: 'Facebook', icon: 'facebook', note: 'Messenger' },
  { name: 'Telegram', icon: 'telegram', note: 'Bots' },
  { name: 'Shopify', icon: 'bag', note: 'Orders' },
  { name: 'WooCommerce', icon: 'store', note: 'Orders' },
  { name: 'Google Sheets', icon: 'sheet', note: 'Contacts' },
  { name: 'REST API', icon: 'code', note: 'Developers' },
  { name: 'Webhooks', icon: 'webhook', note: 'Signed events' },
  { name: 'Marketplace', icon: 'puzzle', note: 'Mini apps' },
];
