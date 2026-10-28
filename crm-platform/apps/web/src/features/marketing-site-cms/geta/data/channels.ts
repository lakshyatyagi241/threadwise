/**
 * The channel pages (/channels/*). Each is written from the product's own help guides, so a channel only claims what the
 * product does: SMS is send-only, voice is WhatsApp calling plus call logs, and so on. Same shape as a product page.
 */
import type { Product } from './products';

const ALL_CHANNELS: Product[] = [
  {
    slug: 'whatsapp',
    name: 'WhatsApp',
    short: 'Official WhatsApp Business API, templates and calling.',
    icon: 'whatsapp',
    group: 'channels',
    headline: 'WhatsApp, done properly, on the official API.',
    sub: 'Connect your WhatsApp Business number, send approved templates, run campaigns and reply from a shared inbox, with the compliance details handled for you.',
    points: [
      'Official Cloud API connection',
      'Template builder and approvals',
      'Groups, forms and click-to-chat links',
    ],
    how: [
      {
        title: 'Connect your number',
        text: 'Link your WhatsApp Business account and verify the number through guided setup.',
      },
      {
        title: 'Create templates',
        text: 'Build message templates, submit them for approval and track their status.',
      },
      {
        title: 'Start conversations',
        text: 'Reply to inbound chats, send template messages and launch campaigns.',
      },
    ],
    features: [
      {
        title: 'Cloud API connection',
        text: 'Connect through the official WhatsApp Business platform.',
        icon: 'whatsapp',
      },
      {
        title: 'Message templates',
        text: 'Create, preview and submit templates with variables, buttons and media.',
        icon: 'template',
      },
      {
        title: 'Click-to-chat links',
        text: 'Generate links and QR codes that open a chat with a pre-filled message.',
        icon: 'link',
      },
      {
        title: 'Groups',
        text: 'Manage WhatsApp groups and group announcements from the same workspace.',
        icon: 'users',
      },
      {
        title: 'Calling',
        text: 'Place and answer WhatsApp calls from the browser on numbers where calling is on.',
        icon: 'phone',
      },
      {
        title: 'Quality and limits',
        text: 'Watch your number quality rating and messaging limits at a glance.',
        icon: 'gauge',
      },
      {
        title: 'Delivery tracking',
        text: 'See sent, delivered and read status for every message.',
        icon: 'check',
      },
      {
        title: 'Personal number option',
        text: 'Where your platform allows it, link a personal number by QR code. It is unofficial and WhatsApp can restrict such numbers.',
        icon: 'qr',
      },
    ],
    example: {
      title: 'Appointment reminders that people actually read',
      steps: [
        'A template with the date and a Confirm button is approved',
        'A scheduled message goes out the day before',
        'The reply lands in the inbox and updates the booking',
        'No-shows drop because reminders get read',
      ],
    },
    faq: [
      {
        q: 'Do I need a WhatsApp Business account?',
        a: 'Yes. You connect a WhatsApp Business account and phone number; setup walks you through it.',
      },
      {
        q: 'Who approves templates?',
        a: 'WhatsApp reviews templates. You submit them from the platform and see the status here.',
      },
      {
        q: 'Can I message anyone I like?',
        a: 'WhatsApp requires opt-in and limits business-initiated messages to approved templates outside the 24-hour reply window. The platform shows you these limits as you work.',
      },
    ],
    related: ['voice', 'team-inbox', 'broadcasts-campaigns'],
  },
  {
    slug: 'email',
    name: 'Email',
    short: 'Gmail, Microsoft 365 and IMAP mailboxes in the team inbox.',
    icon: 'mail',
    group: 'channels',
    headline: 'Customer email, answered from the same inbox as everything else.',
    sub: 'Connect support@ and sales@ from Gmail, Microsoft 365 or any IMAP provider. Every email thread becomes one conversation in the team inbox, next to your WhatsApp and web chats.',
    points: [
      'Gmail, Microsoft 365 and IMAP',
      'Shared or personal mailboxes',
      'Reusable email templates',
    ],
    how: [
      {
        title: 'Connect a mailbox',
        text: 'Choose Gmail or Google Workspace, Microsoft 365 or Outlook, or any provider by IMAP and SMTP, as shared or personal.',
      },
      {
        title: 'Email arrives as a conversation',
        text: 'Each thread is one conversation in the team inbox, routed and assigned like any other channel.',
      },
      {
        title: 'Reply from the same address',
        text: 'Your answer goes out from the mailbox the customer wrote to, in the same thread.',
      },
    ],
    features: [
      {
        title: 'Gmail and Microsoft 365',
        text: 'Connect Google Workspace and Microsoft accounts, or any IMAP and SMTP provider.',
        icon: 'mail',
      },
      {
        title: 'Shared and personal mailboxes',
        text: 'Share a support address with the team, or let people connect their own mailbox where you allow it.',
        icon: 'users',
      },
      {
        title: 'Threads as conversations',
        text: 'Every email thread is one conversation with the customer’s full history.',
        icon: 'timeline',
      },
      {
        title: 'Rich replies',
        text: 'Formatted text, CC and BCC, attachments and a signature.',
        icon: 'note',
      },
      {
        title: 'Email templates',
        text: 'Write an email once with a subject and variables, then insert it into any reply.',
        icon: 'template',
      },
      {
        title: 'Mailbox health',
        text: 'See each mailbox’s status, reconnect it and spot bounces.',
        icon: 'gauge',
      },
    ],
    example: {
      title: 'A support email, from inbox to resolved',
      steps: [
        'A customer writes to support@ about an invoice',
        'The thread appears in the team inbox and is assigned to billing',
        'The agent replies with a template, filled in for that contact',
        'The same contact’s WhatsApp history sits beside the email',
      ],
    },
    faq: [
      {
        q: 'Which providers can I connect?',
        a: 'Gmail and Google Workspace, Microsoft 365 and Outlook, and any other provider through IMAP and SMTP.',
      },
      {
        q: 'Can I send bulk marketing email?',
        a: 'The email channel is for conversations and templated replies in the inbox. It is not a bulk mailing tool.',
      },
    ],
    related: ['team-inbox', 'crm', 'whatsapp'],
  },
  {
    slug: 'sms',
    name: 'SMS',
    short: 'Send SMS to contacts with Twilio or MSG91.',
    icon: 'chat',
    group: 'channels',
    headline: 'Text the people WhatsApp cannot reach.',
    sub: 'Connect a Twilio number or an MSG91 sender and send SMS to your contacts from broadcasts and campaigns. Several senders can run at once.',
    points: [
      'Twilio numbers and MSG91 senders',
      'Send from broadcasts and campaigns',
      'Segment billing explained up front',
    ],
    how: [
      {
        title: 'Connect a sender',
        text: 'Add a Twilio number or an MSG91 sender and switch it on.',
      },
      {
        title: 'Check before you text',
        text: 'Check a number before sending, and see how many segments your message will use.',
      },
      {
        title: 'Send to a segment',
        text: 'Pick SMS in a broadcast or campaign and send to a saved audience.',
      },
    ],
    features: [
      {
        title: 'Twilio and MSG91',
        text: 'Use Twilio numbers or MSG91 senders, several at once.',
        icon: 'plug',
      },
      {
        title: 'Broadcasts and campaigns',
        text: 'Send SMS to segments from the same tools as your WhatsApp messages.',
        icon: 'megaphone',
      },
      {
        title: 'Number check',
        text: 'Check a number before you text it.',
        icon: 'check',
      },
      {
        title: 'Segment billing',
        text: 'See how a message is split into segments and billed before you send.',
        icon: 'gauge',
      },
      {
        title: 'On and off per sender',
        text: 'Switch any sender on or off without removing it.',
        icon: 'cog',
      },
    ],
    example: {
      title: 'A payment reminder by SMS',
      steps: [
        'Segment: customers with an unpaid invoice',
        'A broadcast sends a short SMS from your MSG91 sender',
        'Customers who prefer WhatsApp get the same reminder there',
        'Delivery is tracked per broadcast',
      ],
    },
    faq: [
      {
        q: 'Can customers reply by SMS?',
        a: 'SMS here is send-only. You send from broadcasts and campaigns, and replies are not received in the app.',
      },
      {
        q: 'Which providers are supported?',
        a: 'Twilio and MSG91.',
      },
    ],
    related: ['broadcasts-campaigns', 'whatsapp', 'crm'],
  },
  {
    slug: 'voice',
    name: 'Voice & Calling',
    short: 'Place and answer WhatsApp calls from the inbox.',
    icon: 'phone',
    group: 'channels',
    headline: 'Pick up the phone without leaving the conversation.',
    sub: 'Turn calling on for a WhatsApp number, then place and answer calls from the browser, with call logs and consent-based recording kept against the contact.',
    points: ['Calls from the team inbox', 'Incoming call popup', 'Recording only after consent'],
    how: [
      {
        title: 'Check readiness',
        text: 'Each WhatsApp number shows a "Ready for calls?" checklist. Fix anything flagged, then enable calling.',
      },
      {
        title: 'Call from the chat',
        text: 'Chats on that number show a Call button. If the contact has not allowed calls, ask permission first.',
      },
      {
        title: 'Handle and record',
        text: 'Mute, end or record during the call. Incoming calls show Accept and Decline.',
      },
    ],
    features: [
      {
        title: 'Calls in the browser',
        text: 'Place and answer WhatsApp voice calls without a separate phone app.',
        icon: 'phone',
      },
      {
        title: 'Call button in the inbox',
        text: 'Start a call from the conversation you are already in.',
        icon: 'inbox',
      },
      {
        title: 'Permission requests',
        text: 'Ask a contact for calling permission instead of calling cold.',
        icon: 'shield',
      },
      {
        title: 'Incoming call popup',
        text: 'Accept or decline right where your team works.',
        icon: 'bell',
      },
      {
        title: 'Consent-based recording',
        text: 'Nothing is recorded until the person agrees, and a notice is shown first.',
        icon: 'lock',
      },
      {
        title: 'Call logs',
        text: 'See and log calls against the contact so the history stays in one place.',
        icon: 'list',
      },
    ],
    example: {
      title: 'From chat to call and back',
      steps: [
        'A customer asks a complicated billing question on WhatsApp',
        'The agent asks permission, then calls from the same chat',
        'The call is logged against the contact',
        'The agent sends the summary in the chat afterwards',
      ],
    },
    faq: [
      {
        q: 'Is this an AI voice agent?',
        a: 'No. Calling lets your team place and answer WhatsApp calls. AI agents work in chat, not on voice calls.',
      },
      {
        q: 'Which numbers can call?',
        a: 'You switch calling on per WhatsApp number once it passes the readiness checklist and WhatsApp accepts it.',
      },
    ],
    related: ['whatsapp', 'team-inbox', 'crm'],
  },
  {
    slug: 'instagram',
    name: 'Instagram',
    short: 'Instagram direct messages in the team inbox.',
    icon: 'instagram',
    group: 'channels',
    headline: 'Answer Instagram DMs as fast as WhatsApp.',
    sub: 'Link your Instagram Business or Creator account so its direct messages reach the team inbox, where you can reply, run flows and send reply-only broadcasts.',
    points: [
      'Business and Creator accounts',
      'Flows and replies from the inbox',
      'Reply-only broadcasts',
    ],
    how: [
      {
        title: 'Link your account',
        text: 'Connect an Instagram Business or Creator account and refresh or unlink it any time.',
      },
      {
        title: 'DMs arrive in the inbox',
        text: 'Messages land beside every other channel, routed to the right person.',
      },
      {
        title: 'Reply and automate',
        text: 'Answer by hand or let a flow handle the common questions.',
      },
    ],
    features: [
      {
        title: 'Direct messages',
        text: 'Receive and answer Instagram DMs in the shared inbox.',
        icon: 'instagram',
      },
      {
        title: 'Flows',
        text: 'Run bots on Instagram conversations with the same flow builder.',
        icon: 'flow',
      },
      {
        title: 'Reply-only broadcasts',
        text: 'Send one message to existing conversations, with each 24-hour window shown first.',
        icon: 'megaphone',
      },
      {
        title: 'One contact record',
        text: 'The same person on Instagram and WhatsApp stays one contact.',
        icon: 'timeline',
      },
    ],
    example: {
      title: 'A product question from a story reply',
      steps: [
        'A follower messages your account about a product',
        'The DM appears in the team inbox and is assigned to sales',
        'The agent replies and shares the catalog item',
        'The contact joins your CRM with the source recorded',
      ],
    },
    faq: [
      {
        q: 'Can I message people who have not written to me?',
        a: 'No. Instagram lets an account message only people who wrote to it first, so broadcasts go to existing conversations only.',
      },
      {
        q: 'Which account types work?',
        a: 'Instagram Business and Creator accounts.',
      },
    ],
    related: ['facebook', 'team-inbox', 'chatbots-flows'],
  },
  {
    slug: 'facebook',
    name: 'Facebook Messenger',
    short: 'Messenger, comments and posts for your Facebook Pages.',
    icon: 'facebook',
    group: 'channels',
    headline: 'Run your Facebook Page from the team inbox.',
    sub: 'Connect your Facebook Pages so Messenger messages and comments reach the inbox, then publish posts, set up the Messenger welcome experience and message recent chatters.',
    points: [
      'Messenger messages and comments',
      'Publish and schedule posts',
      'Greeting, menu and ice breakers',
    ],
    how: [
      {
        title: 'Connect your Pages',
        text: 'Connect your Facebook account or a single Page.',
      },
      {
        title: 'Handle the conversations',
        text: 'Messenger messages and comments arrive in the team inbox.',
      },
      {
        title: 'Publish and broadcast',
        text: 'Post to your Page and message people who chatted in the last 24 hours.',
      },
    ],
    features: [
      {
        title: 'Messenger inbox',
        text: 'Answer Messenger conversations beside your other channels.',
        icon: 'facebook',
      },
      {
        title: 'Comments',
        text: 'Comments on your Page reach the same inbox.',
        icon: 'chat',
      },
      {
        title: 'Posts',
        text: 'Publish, schedule, retry or delete posts on connected Pages.',
        icon: 'calendar',
      },
      {
        title: 'Messenger setup',
        text: 'Set the Get Started button, greeting, persistent menu and ice-breaker questions.',
        icon: 'cog',
      },
      {
        title: 'Messenger broadcasts',
        text: 'Message people who chatted with your Page in the last 24 hours, and track sent, failed and blocked.',
        icon: 'megaphone',
      },
    ],
    example: {
      title: 'A launch announcement',
      steps: [
        'Schedule a post on your Page for Monday morning',
        'Replies and comments arrive in the team inbox',
        'Message people who chatted in the last 24 hours with the offer',
        'Track sent, failed and blocked per broadcast',
      ],
    },
    faq: [
      {
        q: 'Can I message anyone who liked my Page?',
        a: 'No. Meta allows a Page to message someone only within 24 hours of their last message, so broadcasts offer only people who can be reached right now.',
      },
    ],
    related: ['instagram', 'team-inbox', 'chatbots-flows'],
  },
  {
    slug: 'telegram',
    name: 'Telegram',
    short: 'Connect a Telegram bot and serve its chats with your team.',
    icon: 'telegram',
    group: 'channels',
    headline: 'Serve your Telegram community from the team inbox.',
    sub: 'Connect a Telegram bot with its BotFather token. Its chats appear in the inbox and flows can answer them.',
    points: [
      'Connect with a BotFather token',
      'Flows answer the bot',
      'Pause or disconnect any time',
    ],
    how: [
      {
        title: 'Create a bot',
        text: 'Create the bot with BotFather and copy its token.',
      },
      {
        title: 'Connect it',
        text: 'Paste the token, check the webhook and switch the bot on.',
      },
      {
        title: 'Answer in the inbox',
        text: 'Chats arrive in the team inbox, and flows handle the routine questions.',
      },
    ],
    features: [
      {
        title: 'Bot connection',
        text: 'Connect one or more Telegram bots with their tokens.',
        icon: 'telegram',
      },
      {
        title: 'Webhook check',
        text: 'See that the bot’s webhook is healthy.',
        icon: 'webhook',
      },
      {
        title: 'Flows on Telegram',
        text: 'Run the same flow builder bots on Telegram chats.',
        icon: 'flow',
      },
      {
        title: 'Pause and disconnect',
        text: 'Pause a bot or disconnect it whenever you need.',
        icon: 'cog',
      },
      {
        title: 'Payment token',
        text: 'Add a payment token to the bot when you want to take payments in chat.',
        icon: 'card',
      },
    ],
    example: {
      title: 'A community support bot',
      steps: [
        'Members message your bot with questions',
        'A flow answers the common ones',
        'Anything else is handed to your team in the inbox',
        'Every member becomes a contact in the CRM',
      ],
    },
    faq: [
      {
        q: 'Do I need to code?',
        a: 'No. You create the bot in Telegram, paste its token here and build the replies in the flow builder.',
      },
    ],
    related: ['chatbots-flows', 'team-inbox', 'web-chat'],
  },
  {
    slug: 'web-chat',
    name: 'Website Chat',
    short: 'A chat bubble for your site, answered by an agent or WhatsApp.',
    icon: 'widget',
    group: 'channels',
    headline: 'Turn every website visitor into a conversation.',
    sub: 'Put a floating chat bubble on your website. Visitors chat with an AI agent, jump into WhatsApp, or choose between the two, and chats that need a person land in the inbox.',
    points: ['One embed code', 'Agent, WhatsApp or both', 'Pre-chat form for name and email'],
    how: [
      {
        title: 'Design the widget',
        text: 'Set the look, the greeting and what the bubble opens.',
      },
      {
        title: 'Paste the snippet',
        text: 'Copy the embed code onto your site.',
      },
      {
        title: 'Chats reach your team',
        text: 'The agent handles the routine; people take over from the team inbox.',
      },
    ],
    features: [
      {
        title: 'Chat bubble',
        text: 'A branded bubble that floats on every page you choose.',
        icon: 'widget',
      },
      {
        title: 'Agent, WhatsApp or both',
        text: 'Let visitors chat with an agent, jump into WhatsApp, or pick.',
        icon: 'sparkle',
      },
      {
        title: 'Pre-chat form',
        text: 'Ask for a name and email so every lead is identified.',
        icon: 'form',
      },
      {
        title: 'Website bots in one list',
        text: 'See every website bot and the widget it runs in, and copy its install code.',
        icon: 'list',
      },
      {
        title: 'Handover',
        text: 'Conversations that need a person land in the team inbox.',
        icon: 'users',
      },
    ],
    example: {
      title: 'A pricing question at midnight',
      steps: [
        'A visitor opens the bubble and asks about plans',
        'The agent answers from your content and asks for an email',
        'A contact is created with the page as the source',
        'Your team follows up in the morning with the full chat',
      ],
    },
    faq: [
      {
        q: 'How do I install it?',
        a: 'Copy the embed code from Website chat in settings and paste it into your site.',
      },
    ],
    related: ['ai-agents', 'team-inbox', 'forms-lead-capture'],
  },
  {
    slug: 'line',
    name: 'LINE',
    short: 'Connect a LINE Official Account and broadcast to friends.',
    icon: 'chat',
    group: 'channels',
    headline: 'Reach customers on LINE from the same workspace.',
    sub: 'Connect a LINE Official Account so people who add it and write to it appear in your team inbox, and send broadcasts to the people who chat with it.',
    points: ['Official Account connection', 'Webhook check', 'Broadcasts'],
    how: [
      {
        title: 'Get your keys',
        text: 'Copy the channel access token and channel secret from the LINE Developers Console.',
      },
      {
        title: 'Connect the account',
        text: 'Paste both values, check the webhook, and pause or rotate the token when needed.',
      },
      {
        title: 'Chat and broadcast',
        text: 'Answer in the inbox, and send one message to many people.',
      },
    ],
    features: [
      {
        title: 'Official Account',
        text: 'Connect a LINE Official Account to your workspace.',
        icon: 'chat',
      },
      {
        title: 'Team inbox',
        text: 'Friends’ messages appear beside your other channels.',
        icon: 'inbox',
      },
      {
        title: 'Broadcasts',
        text: 'Send one message to the people who chat with the account.',
        icon: 'megaphone',
      },
      {
        title: 'Token rotation',
        text: 'Pause the account or turn on token rotation.',
        icon: 'lock',
      },
    ],
    example: {
      title: 'A shop announcement on LINE',
      steps: [
        'Customers add your Official Account and write in',
        'Their chats appear in the team inbox',
        'You broadcast a new-arrivals message',
        'Replies come back to the same inbox',
      ],
    },
    faq: [
      {
        q: 'What do I need from LINE?',
        a: 'A LINE Official Account, with its channel access token and channel secret from the LINE Developers Console.',
      },
    ],
    related: ['viber', 'wechat', 'team-inbox'],
  },
  {
    slug: 'viber',
    name: 'Viber',
    short: 'Connect a Viber Public Account and message subscribers.',
    icon: 'phone',
    group: 'channels',
    headline: 'Bring Viber chats into the team inbox.',
    sub: 'Connect a Viber Public Account with its authentication token. Chats people start with it appear in the inbox, and you can message subscribers in broadcasts and read their insights.',
    points: ['Public Account connection', 'Broadcasts to subscribers', 'Insights'],
    how: [
      {
        title: 'Paste the token',
        text: 'Connect the Public Account with the authentication token Viber gives it.',
      },
      {
        title: 'Answer in the inbox',
        text: 'Replies you type in the inbox go out through the account.',
      },
      {
        title: 'Broadcast and measure',
        text: 'Message your subscribers and read the account’s insights.',
      },
    ],
    features: [
      {
        title: 'Public Account',
        text: 'Connect a Viber Public Account and manage it.',
        icon: 'phone',
      },
      {
        title: 'Team inbox',
        text: 'Viber chats appear beside every other channel.',
        icon: 'inbox',
      },
      {
        title: 'Broadcasts',
        text: 'Message your subscribers in a broadcast.',
        icon: 'megaphone',
      },
      {
        title: 'Insights',
        text: 'Read how the account is doing.',
        icon: 'chart',
      },
    ],
    example: {
      title: 'A promotion to subscribers',
      steps: [
        'Subscribers follow your Public Account',
        'You broadcast an offer to them',
        'Questions arrive in the inbox',
        'Your team answers from the same screen as WhatsApp',
      ],
    },
    faq: [
      {
        q: 'How do I connect it?',
        a: 'Paste the authentication token that Viber gives your Public Account.',
      },
    ],
    related: ['line', 'wechat', 'team-inbox'],
  },
  {
    slug: 'wechat',
    name: 'WeChat',
    short: 'Connect a WeChat Official Account and mass-send messages.',
    icon: 'globe',
    group: 'channels',
    headline: 'Answer WeChat followers from the same inbox.',
    sub: 'Connect a WeChat Official Account so follower messages appear in the team inbox and your team can answer them there. You can also mass-send a text message to followers.',
    points: ['Official Account connection', 'Reply from the inbox', 'Mass send to followers'],
    how: [
      {
        title: 'Check your account',
        text: 'You need a certified WeChat Service Account. Subscription accounts and unverified accounts cannot use the messaging APIs.',
      },
      {
        title: 'Connect it',
        text: 'Paste the address and Token we give you into WeChat.',
      },
      {
        title: 'Answer and send',
        text: 'Reply to followers in the inbox, or mass-send a text message.',
      },
    ],
    features: [
      {
        title: 'Official Account',
        text: 'Connect a certified WeChat Service Account.',
        icon: 'globe',
      },
      {
        title: 'Team inbox',
        text: 'Follower messages appear beside your other channels.',
        icon: 'inbox',
      },
      {
        title: 'Mass send',
        text: 'Send a text message to your followers.',
        icon: 'megaphone',
      },
    ],
    example: {
      title: 'A service update to followers',
      steps: [
        'Followers message your Official Account',
        'Your team answers from the shared inbox',
        'You mass-send a text update to followers',
        'Replies return to the same inbox',
      ],
    },
    faq: [
      {
        q: 'Which WeChat accounts work?',
        a: 'A certified WeChat Service Account. Subscription accounts and accounts that are not verified cannot use the messaging APIs.',
      },
    ],
    related: ['line', 'viber', 'team-inbox'],
  },
];

/**
 * Channels written up but not offered on the public site yet. They stay in the file so they can be switched back on by
 * deleting a slug here; while hidden they have no page, no menu entry and no sitemap line.
 */
const HIDDEN_CHANNELS = ['line', 'viber', 'wechat'];

export const CHANNELS: Product[] = ALL_CHANNELS.filter((c) => !HIDDEN_CHANNELS.includes(c.slug));
