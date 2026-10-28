/**
 * The product pages of the public site. Copy lives here, apart from the components, in the same shape the content editor stores
 * (a key per text, a shipped default), so binding a page to the editor later means reading these values through `makeFc` instead.
 */
import type { IconName } from '../icons';
import { CHANNELS } from './channels';

export { CHANNELS };

export interface Faq {
  q: string;
  a: string;
}

export interface Product {
  slug: string;
  name: string;
  /** One line for menus and cards. */
  short: string;
  icon: IconName;
  group: 'engage' | 'channels' | 'automate' | 'grow' | 'connect';
  headline: string;
  sub: string;
  /** Three quick wins shown under the hero. */
  points: string[];
  how: Array<{ title: string; text: string }>;
  features: Array<{ title: string; text: string; icon: IconName }>;
  example: { title: string; steps: string[] };
  faq: Faq[];
  related: string[];
}

export const PRODUCT_GROUPS: Record<Product['group'], { label: string; blurb: string }> = {
  engage: { label: 'Talk to customers', blurb: 'Every conversation in one place.' },
  channels: { label: 'Channels', blurb: 'Every place your customers talk to you.' },
  automate: { label: 'Automate', blurb: 'Let the platform do the repeat work.' },
  grow: { label: 'Grow revenue', blurb: 'Capture, nurture and sell.' },
  connect: { label: 'Connect', blurb: 'Plug into the tools you already run.' },
};

export const PRODUCTS: Product[] = [
  {
    slug: 'team-inbox',
    name: 'Team Inbox',
    short: 'One shared inbox for every customer conversation.',
    icon: 'inbox',
    group: 'engage',
    headline: 'One inbox. Your whole team. No dropped chats.',
    sub: 'Every WhatsApp, Instagram, Facebook, Telegram and web chat message lands in a single shared inbox, routed to the right person and tracked against your response targets.',
    points: [
      'Assign by rule, team or round-robin',
      'Response-time targets with alerts',
      'Private notes and team chat',
    ],
    how: [
      {
        title: 'Messages arrive',
        text: 'Each connected channel feeds the same inbox, with the contact and history already attached.',
      },
      {
        title: 'Routing decides who owns it',
        text: 'Rules assign a chat to a team or agent by channel, tag, language or working hours.',
      },
      {
        title: 'Your team replies and resolves',
        text: 'Agents reply, add notes, hand over, and close the conversation with a clear status.',
      },
    ],
    features: [
      {
        title: 'Shared inbox',
        text: 'See open, mine, unassigned and resolved chats with filters that stick.',
        icon: 'inbox',
      },
      {
        title: 'Routing rules',
        text: 'Send chats to the right team automatically, with fallback and round-robin.',
        icon: 'route',
      },
      {
        title: 'Response targets',
        text: 'Set first-reply and resolution targets and get warned before one is missed.',
        icon: 'clock',
      },
      {
        title: 'Internal notes',
        text: 'Leave context for teammates that the customer never sees.',
        icon: 'note',
      },
      {
        title: 'Team chat',
        text: 'Talk to colleagues inside the product without leaving the conversation.',
        icon: 'chat',
      },
      {
        title: 'Saved replies',
        text: 'Answer common questions in one click and keep the tone consistent.',
        icon: 'bolt',
      },
      {
        title: 'Roles and permissions',
        text: 'Decide who can see which chats, numbers and settings.',
        icon: 'lock',
      },
      {
        title: 'Notifications',
        text: 'Desktop, in-app and push alerts so a new message is never missed.',
        icon: 'bell',
      },
    ],
    example: {
      title: 'A support chat, from message to resolved',
      steps: [
        'Customer writes on WhatsApp after hours',
        'Rule assigns it to the support team and sends an away message',
        'Morning shift opens it with the full history and replies',
        'Agent resolves it; response time is recorded',
      ],
    },
    faq: [
      {
        q: 'Can several people work in the inbox at once?',
        a: 'Yes. Chats are assigned to one owner at a time, and everyone else sees who has it, so two people never answer the same message.',
      },
      {
        q: 'Can I limit what each agent sees?',
        a: 'Yes. Roles and permissions control which chats, numbers and settings each person can reach.',
      },
      {
        q: 'Does it work on mobile?',
        a: 'The inbox is responsive and supports push notifications, so agents can reply from a phone.',
      },
    ],
    related: ['whatsapp', 'email', 'crm'],
  },
  {
    slug: 'broadcasts-campaigns',
    name: 'Broadcasts & Campaigns',
    short: 'Send bulk messages and multi-step campaigns to segments.',
    icon: 'megaphone',
    group: 'grow',
    headline: 'Reach the right people, at the right moment.',
    sub: 'Send one-off broadcasts or multi-step campaigns to saved segments, schedule them, and see exactly who received, read and replied.',
    points: [
      'Segments built from any contact field',
      'Scheduling and a managed send queue',
      'Delivery, read and reply reports',
    ],
    how: [
      {
        title: 'Pick an audience',
        text: 'Choose a saved segment or build one from tags, attributes and activity.',
      },
      {
        title: 'Compose and schedule',
        text: 'Select a template, fill the variables, and send now or at a set time.',
      },
      {
        title: 'Track the result',
        text: 'Watch delivery and replies as they come in and follow up from the inbox.',
      },
    ],
    features: [
      {
        title: 'Broadcasts',
        text: 'Send a template to thousands of contacts with variables per recipient.',
        icon: 'megaphone',
      },
      {
        title: 'Campaigns',
        text: 'Chain messages over days with conditions on what each person did.',
        icon: 'route',
      },
      {
        title: 'Segments',
        text: 'Group contacts by tag, attribute, source or behaviour; segments stay current.',
        icon: 'filter',
      },
      {
        title: 'Scheduling',
        text: 'Plan sends ahead and respect quiet hours and send pacing.',
        icon: 'calendar',
      },
      {
        title: 'Send queue',
        text: 'A managed queue paces delivery so large sends stay within limits.',
        icon: 'gauge',
      },
      {
        title: 'Reports',
        text: 'Sent, delivered, read, replied and failed, per broadcast.',
        icon: 'chart',
      },
    ],
    example: {
      title: 'A re-engagement campaign for quiet customers',
      steps: [
        'Segment: customers with no order in 60 days',
        'Day 1 template with an offer',
        'Day 3 reminder only to those who did not reply',
        'Replies drop into the inbox for the sales team',
      ],
    },
    faq: [
      {
        q: 'Can I send to everyone in my list?',
        a: 'You can send to contacts who have opted in. The platform keeps opt-out status and honours it automatically.',
      },
      {
        q: 'What happens to failed messages?',
        a: 'Failures are listed with the reason, so you can fix the cause and retry.',
      },
    ],
    related: ['whatsapp', 'crm', 'chatbots-flows'],
  },
  {
    slug: 'chatbots-flows',
    name: 'Chatbots & Flow Builder',
    short: 'Visual flows, keyword replies and always-on bots.',
    icon: 'flow',
    group: 'automate',
    headline: 'Build the conversation once. Run it on every chat.',
    sub: 'Design bots on a visual canvas, trigger them from keywords or events, and hand over to a person the moment a human is needed.',
    points: [
      'Drag-and-drop flow builder',
      'Keyword and event triggers',
      'Hand over to an agent in one step',
    ],
    how: [
      {
        title: 'Draw the flow',
        text: 'Place messages, questions, conditions, delays and actions on the canvas.',
      },
      {
        title: 'Choose a trigger',
        text: 'Start it from a keyword, a new contact, a form submission or a schedule.',
      },
      {
        title: 'Publish and improve',
        text: 'Go live, then read where people drop off and adjust the steps.',
      },
    ],
    features: [
      {
        title: 'Visual canvas',
        text: 'Build branching conversations without writing code.',
        icon: 'flow',
      },
      {
        title: 'Auto-reply keywords',
        text: 'Answer common words and phrases instantly, day or night.',
        icon: 'bolt',
      },
      {
        title: 'Questions and capture',
        text: 'Ask for details and save the answers to contact fields.',
        icon: 'form',
      },
      {
        title: 'Conditions and delays',
        text: 'Branch on answers and wait before the next step.',
        icon: 'branch',
      },
      {
        title: 'Actions',
        text: 'Tag a contact, assign a chat, call a webhook or create a task.',
        icon: 'cog',
      },
      {
        title: 'Human handover',
        text: 'Pass the chat to a team with the transcript attached.',
        icon: 'users',
      },
    ],
    example: {
      title: 'A lead qualification bot',
      steps: [
        'Keyword "pricing" starts the flow',
        'The bot asks budget and timeline',
        'Hot leads are assigned to sales with a task',
        'Everyone else joins a nurture campaign',
      ],
    },
    faq: [
      {
        q: 'Do I need to code?',
        a: 'No. Flows are built visually. Developers can still call a webhook from any step.',
      },
      {
        q: 'Can a person take over mid-flow?',
        a: 'Yes. A handover step assigns the chat to a team and pauses the bot.',
      },
    ],
    related: ['ai-agents', 'whatsapp', 'team-inbox'],
  },
  {
    slug: 'ai-agents',
    name: 'AI Agents',
    short: 'Agents trained on your content that answer and qualify.',
    icon: 'sparkle',
    group: 'automate',
    headline: 'An agent that knows your business and works all night.',
    sub: 'Train an AI agent on your own documents and pages, let it answer customers and qualify leads, and keep control with clear rules for when it hands over.',
    points: [
      'Train on your documents and pages',
      'Answer, qualify and book',
      'You set the limits and the handover',
    ],
    how: [
      {
        title: 'Teach it',
        text: 'Upload documents, add web pages and write instructions in plain language.',
      },
      {
        title: 'Test it',
        text: 'Chat with the agent, read the sources it used and fix gaps before going live.',
      },
      {
        title: 'Let it work',
        text: 'Switch it on for chosen channels; it hands over to a person when you say so.',
      },
    ],
    features: [
      {
        title: 'Knowledge training',
        text: 'Ground answers in the files and pages you provide.',
        icon: 'book',
      },
      {
        title: 'Instructions and tone',
        text: 'Tell the agent how to speak and what it must never do.',
        icon: 'note',
      },
      {
        title: 'Lead qualification',
        text: 'Ask the right questions and save answers to the contact.',
        icon: 'target',
      },
      {
        title: 'Handover rules',
        text: 'Escalate on topic, sentiment or request for a person.',
        icon: 'users',
      },
      {
        title: 'Usage and keys',
        text: 'Bring your own AI provider key and watch usage in one place.',
        icon: 'gauge',
      },
      {
        title: 'Review conversations',
        text: 'Read what the agent said and correct it so it improves.',
        icon: 'eye',
      },
    ],
    example: {
      title: 'After-hours enquiries, handled',
      steps: [
        'A visitor asks about fees at 11 pm',
        'The agent answers from your fee document',
        'It collects name and course interest',
        'A counsellor sees a qualified lead at 9 am',
      ],
    },
    faq: [
      {
        q: 'Can the agent make things up?',
        a: 'It answers from the content you give it and you can tell it to hand over when unsure. You can read every conversation to catch mistakes.',
      },
      {
        q: 'Which AI provider does it use?',
        a: 'You connect your own provider key, so you control the model and the cost.',
      },
    ],
    related: ['chatbots-flows', 'team-inbox', 'forms-lead-capture'],
  },
  {
    slug: 'crm',
    name: 'CRM',
    short: 'Contacts, companies, deals, tasks and appointments.',
    icon: 'contact',
    group: 'grow',
    headline: 'A CRM that is built around the conversation.',
    sub: 'Every chat updates a living contact record. Track companies, move deals through a pipeline, assign tasks and book appointments without leaving the thread.',
    points: [
      'Custom fields, tags and segments',
      'Deal pipelines with stages',
      'Tasks and appointments linked to chats',
    ],
    how: [
      {
        title: 'Contacts fill themselves',
        text: 'People are created from chats, forms and imports with their source recorded.',
      },
      {
        title: 'Work the pipeline',
        text: 'Create deals, move them across stages and see value by stage.',
      },
      {
        title: 'Follow up on time',
        text: 'Tasks and appointments keep every next step owned and dated.',
      },
    ],
    features: [
      {
        title: 'Contacts and companies',
        text: 'Profiles with custom attributes, tags, notes and full history.',
        icon: 'contact',
      },
      {
        title: 'Import and export',
        text: 'Bring contacts in from a spreadsheet and export when you need to.',
        icon: 'upload',
      },
      {
        title: 'Deal pipelines',
        text: 'Stages, values and owners on a board your team can drag.',
        icon: 'kanban',
      },
      { title: 'Tasks', text: 'Assign follow-ups with due dates and reminders.', icon: 'check' },
      {
        title: 'Appointments',
        text: 'Offer slots and book meetings, with reminders sent on WhatsApp.',
        icon: 'calendar',
      },
      {
        title: 'Lead sources',
        text: 'See which channel, form or campaign each lead came from.',
        icon: 'target',
      },
      {
        title: 'Segments',
        text: 'Save any filter as a living audience for campaigns.',
        icon: 'filter',
      },
      { title: 'Sales documents', text: 'Create quotes and invoices from a deal.', icon: 'doc' },
    ],
    example: {
      title: 'From first message to closed deal',
      steps: [
        'A lead messages from an Instagram ad',
        'The contact is created with source recorded',
        'A deal is opened and a call task is set',
        'The deal moves to Won and an invoice is sent',
      ],
    },
    faq: [
      {
        q: 'Can I add my own fields?',
        a: 'Yes. Add custom attributes of the types you need and use them in segments and messages.',
      },
      {
        q: 'Can I import existing contacts?',
        a: 'Yes. Upload a spreadsheet, map the columns and import.',
      },
    ],
    related: ['team-inbox', 'broadcasts-campaigns', 'commerce'],
  },
  {
    slug: 'forms-lead-capture',
    name: 'Forms & Lead Capture',
    short: 'Web forms, links and QR codes that feed your CRM.',
    icon: 'form',
    group: 'grow',
    headline: 'Turn every visitor into a conversation.',
    sub: 'Publish forms, short links and click-to-chat QR codes that create a contact, tag the source and start a WhatsApp chat in one step.',
    points: [
      'Embeddable and hosted forms',
      'Short links and QR codes',
      'Source tracking on every lead',
    ],
    how: [
      {
        title: 'Build a form or link',
        text: 'Pick fields, set the thank-you action and choose where leads should go.',
      },
      {
        title: 'Share it anywhere',
        text: 'Embed on your site, print the QR code or put the link in an ad.',
      },
      {
        title: 'Follow up instantly',
        text: 'New leads get an instant message and an owner in the inbox.',
      },
    ],
    features: [
      { title: 'Web forms', text: 'Build forms and embed them on any page.', icon: 'form' },
      {
        title: 'Short links',
        text: 'Branded links that open a chat with a pre-filled message.',
        icon: 'link',
      },
      {
        title: 'QR codes',
        text: 'Print-ready codes for packaging, posters and storefronts.',
        icon: 'qr',
      },
      {
        title: 'Instant follow-up',
        text: 'Send a welcome message the moment a form is submitted.',
        icon: 'bolt',
      },
      {
        title: 'Source tracking',
        text: 'Know which form, link or ad each lead came from.',
        icon: 'target',
      },
      {
        title: 'Spam protection',
        text: 'A honeypot and captcha keep junk out of your list.',
        icon: 'shield',
      },
    ],
    example: {
      title: 'A property enquiry form',
      steps: [
        'Visitor submits the form on a listing page',
        'A WhatsApp message arrives within seconds',
        'The lead is assigned to the area agent',
        'Source and listing are saved on the contact',
      ],
    },
    faq: [
      {
        q: 'Can I embed a form on my own website?',
        a: 'Yes. Copy the embed code, or share the hosted form link.',
      },
      {
        q: 'Do leads need to opt in?',
        a: 'Add a consent field and the platform records it with the contact.',
      },
    ],
    related: ['crm', 'whatsapp', 'broadcasts-campaigns'],
  },
  {
    slug: 'commerce',
    name: 'Commerce',
    short: 'Catalog, storefront, invoices and payments in chat.',
    icon: 'bag',
    group: 'grow',
    headline: 'Sell where the conversation already is.',
    sub: 'Share a product catalog, publish a storefront, send invoices and collect payment, then keep customers updated about their order in the same chat.',
    points: [
      'Product catalog and storefront',
      'Invoices and payment links',
      'Order updates on WhatsApp',
    ],
    how: [
      {
        title: 'List your products',
        text: 'Add products with images and prices, or sync them from your store.',
      },
      {
        title: 'Share and sell',
        text: 'Send items in chat, point to your storefront or share a payment link.',
      },
      {
        title: 'Keep them informed',
        text: 'Send order, shipping and payment updates automatically.',
      },
    ],
    features: [
      {
        title: 'Catalog',
        text: 'Organise products and share them as cards inside a chat.',
        icon: 'bag',
      },
      {
        title: 'Storefront builder',
        text: 'Publish a simple shop on your own domain.',
        icon: 'store',
      },
      {
        title: 'Invoices and quotes',
        text: 'Create documents from a deal and send them for payment.',
        icon: 'doc',
      },
      {
        title: 'Payments',
        text: 'Collect payment through your own payment gateway account.',
        icon: 'card',
      },
      {
        title: 'Shopify and WooCommerce',
        text: 'Connect your store to read orders and trigger messages.',
        icon: 'plug',
      },
      {
        title: 'Order notifications',
        text: 'Confirmation, dispatch and delivery messages without manual work.',
        icon: 'bell',
      },
    ],
    example: {
      title: 'Abandoned cart recovery',
      steps: [
        'A cart is left unpaid on the store',
        'A WhatsApp reminder with a payment link goes out',
        'The customer asks a question and gets an answer',
        'The order completes and a confirmation is sent',
      ],
    },
    faq: [
      {
        q: 'Which payment gateways can I use?',
        a: 'You connect your own gateway account, so payments go straight to you.',
      },
      {
        q: 'Do I need Shopify or WooCommerce?',
        a: 'No. The catalog and storefront work on their own. The store connections are optional.',
      },
    ],
    related: ['crm', 'whatsapp', 'integrations-api'],
  },
  {
    slug: 'integrations-api',
    name: 'Integrations & API',
    short: 'REST API, webhooks and connections to your stack.',
    icon: 'plug',
    group: 'connect',
    headline: 'Connect every tool. Automate every flow.',
    sub: 'A documented REST API, signed outbound webhooks and ready connections mean your data and your automation reach the systems you already use.',
    points: [
      'Documented REST API',
      'Signed outbound webhooks',
      'Sheets, Chrome and store connections',
    ],
    how: [
      {
        title: 'Create a key',
        text: 'Generate an API key with the permissions an integration needs.',
      },
      {
        title: 'Send and receive',
        text: 'Call the API to send messages and sync contacts; subscribe to events by webhook.',
      },
      { title: 'Monitor it', text: 'See deliveries, retries and failures for every webhook.' },
    ],
    features: [
      {
        title: 'REST API',
        text: 'Contacts, messages, templates and more, with reference docs.',
        icon: 'code',
      },
      {
        title: 'Outbound webhooks',
        text: 'Get an event the moment a message, contact or deal changes.',
        icon: 'webhook',
      },
      {
        title: 'Signed requests',
        text: 'Verify each webhook with a secret you can rotate.',
        icon: 'lock',
      },
      {
        title: 'Delivery log',
        text: 'Inspect payloads and retry a failed delivery.',
        icon: 'list',
      },
      {
        title: 'Google Sheets and Chrome',
        text: 'Work with your data from a spreadsheet or the browser.',
        icon: 'sheet',
      },
      {
        title: 'Store connections',
        text: 'Shopify and WooCommerce events become messages.',
        icon: 'plug',
      },
    ],
    example: {
      title: 'Sync new leads to your system',
      steps: [
        'A form creates a contact',
        'A webhook sends the lead to your backend',
        'Your system replies through the API',
        'The conversation continues in the inbox',
      ],
    },
    faq: [
      {
        q: 'Is there API documentation?',
        a: 'Yes. The REST API has reference documentation with examples.',
      },
      {
        q: 'How are webhooks secured?',
        a: 'Each request is signed with a secret you can rotate at any time.',
      },
    ],
    related: ['marketplace', 'commerce', 'crm'],
  },
  {
    slug: 'marketplace',
    name: 'Marketplace & Add-ons',
    short: 'Install mini apps and integrations, or add feature packs.',
    icon: 'puzzle',
    group: 'connect',
    headline: 'Extend it your way, without custom code.',
    sub: 'Browse mini apps and integrations in the Marketplace, review exactly what each one can access, install in a few steps, and add paid feature packs when your plan needs more room.',
    points: [
      'Permission review before every install',
      'Pause, test or uninstall at any time',
      'Add-ons stack on top of your plan',
    ],
    how: [
      {
        title: 'Browse',
        text: 'Search mini apps and integrations by category, or sort by featured, most installed and newest.',
      },
      {
        title: 'Review and install',
        text: 'Read what an app can access, with a risk level on each permission, then approve and fill in its setup fields.',
      },
      {
        title: 'Manage',
        text: 'Pause or resume an app, test the connection, rotate a secret and read its recent deliveries.',
      },
    ],
    features: [
      {
        title: 'Mini apps',
        text: 'Small apps that add a capability to your workspace, installed in minutes.',
        icon: 'puzzle',
      },
      {
        title: 'Integrations',
        text: 'Connect outside services such as lead sources and stores from one catalogue.',
        icon: 'plug',
      },
      {
        title: 'Permission review',
        text: 'Every permission an app asks for is listed with a risk level before you agree.',
        icon: 'shield',
      },
      {
        title: 'Sealed credentials',
        text: 'Keys you enter are stored sealed and cannot be read back by anyone.',
        icon: 'lock',
      },
      {
        title: 'Manage and monitor',
        text: 'Test the connection, send a sample lead, rotate a secret and see recent deliveries.',
        icon: 'gauge',
      },
      {
        title: 'Request an integration',
        text: 'Describe what is missing and vote on what other teams have asked for.',
        icon: 'chat',
      },
      {
        title: 'Add-ons',
        text: 'Monthly feature and limit packs that stack on top of your plan when you need more.',
        icon: 'plus',
      },
      {
        title: 'Roles decide who installs',
        text: 'Viewing and installing are separate permissions, so you control who can add apps.',
        icon: 'users',
      },
    ],
    example: {
      title: 'Connect a lead source and add capacity',
      steps: [
        'Open the Marketplace and find the lead-source integration',
        'Review its permissions, approve, and enter your key',
        'Send a sample lead to confirm it reaches the inbox',
        'Subscribe to an add-on when your team outgrows a plan limit',
      ],
    },
    faq: [
      {
        q: 'Do add-ons replace my plan?',
        a: 'No. An add-on is a feature or limit pack that stacks on top of your plan, so you only pay for the extra you need.',
      },
      {
        q: 'Is it safe to install an app?',
        a: 'Each app lists what it can access, with a risk level, and nothing installs until you approve. You can pause or uninstall it whenever you like.',
      },
      {
        q: 'What if the app I need is not listed?',
        a: 'Use Request an integration to describe it and vote on requests from other teams. You can also build your own connection with the REST API and webhooks.',
      },
    ],
    related: ['integrations-api', 'crm', 'ai-agents'],
  },
];

/** Products and channels together, for lists that cover everything (features index, platform page, sitemap). */
export const ALL_PRODUCTS: Product[] = [...PRODUCTS, ...CHANNELS];

export const productBySlug = (slug: string) => ALL_PRODUCTS.find((p) => p.slug === slug);

/** A channel page lives under /products/channels (the app itself owns /channels), every other product under /products. */
export const hrefOf = (p: Pick<Product, 'slug' | 'group'>) =>
  p.group === 'channels' ? `/products/channels/${p.slug}` : `/products/${p.slug}`;
