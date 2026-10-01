import type { NavItem } from './types';

/**
 * Screens WaDesk has that this app has not built yet. They show in the menu as disabled "coming soon" entries so the
 * product's shape is visible from day one. This file is the one place they are listed.
 *
 * To switch one on: build the screen, declare a `NavItem` with the same `id` in your domain's `nav.ts` (labels and
 * gates are then yours), and delete the entry here. Until you delete it, the real item already wins (see
 * `mergePlanned`), so the two never both show.
 *
 * Labels live in `messages/<locale>/shell.json` under `shell.nav`, in the shell's own namespace, because no domain
 * owns these screens yet. `icon` names are defined in `components/shell/nav-icons.tsx`.
 */
const L = (id: string) => `shell.nav.${id}`;

export const PLANNED_NAV: readonly NavItem[] = [
  // Overview (Dashboard is a real screen)
  { id: 'analytics', group: 'overview', labelKey: L('analytics'), href: '/analytics', order: 10, icon: 'analytics' },
  { id: 'notifications', group: 'overview', labelKey: L('notifications'), href: '/notifications', order: 20, icon: 'bell' },

  // Inbox & Chat
  { id: 'inbox', group: 'inbox', labelKey: L('inbox'), href: '/inbox', order: 0, icon: 'inbox' },
  { id: 'quick-chat', group: 'inbox', labelKey: L('quickChat'), href: '/chat', order: 10, icon: 'chat' },
  { id: 'call-logs', group: 'inbox', labelKey: L('callLogs'), href: '/call-logs', order: 20, icon: 'phone' },
  { id: 'team-chat', group: 'inbox', labelKey: L('teamChat'), href: '/team-chat', order: 30, icon: 'team-chat' },
  { id: 'team-members', group: 'inbox', labelKey: L('teamMembers'), href: '/team-members', order: 40, icon: 'team' },

  // Audience (Contacts, Attributes and Contact groups are real screens)
  { id: 'lead-finder', group: 'audience', labelKey: L('leadFinder'), href: '/lead-finder', order: 30, icon: 'pin', badge: 'new' },
  { id: 'deals', group: 'audience', labelKey: L('deals'), href: '/deals', order: 40, icon: 'deal' },

  // Campaigns
  { id: 'campaigns', group: 'campaigns', labelKey: L('campaigns'), href: '/campaigns', order: 0, icon: 'campaign' },
  { id: 'scheduled', group: 'campaigns', labelKey: L('scheduled'), href: '/scheduled', order: 20, icon: 'clock' },
  { id: 'templates', group: 'campaigns', labelKey: L('templates'), href: '/templates', order: 30, icon: 'template' },
  { id: 'history', group: 'campaigns', labelKey: L('history'), href: '/message-history', order: 40, icon: 'history' },

  // Automation
  { id: 'flows', group: 'automation', labelKey: L('flows'), href: '/flows', order: 0, icon: 'flow' },
  { id: 'ai-assistants', group: 'automation', labelKey: L('aiAssistants'), href: '/ai-assistants', order: 10, icon: 'bot', badge: 'new' },
  { id: 'auto-reply', group: 'automation', labelKey: L('autoReply'), href: '/auto-reply', order: 20, icon: 'reply' },
  { id: 'appointments', group: 'automation', labelKey: L('appointments'), href: '/appointments', order: 30, icon: 'calendar' },
  { id: 'chat-widget', group: 'automation', labelKey: L('chatWidget'), href: '/chatbot-widgets', order: 40, icon: 'widget' },

  // Channels
  { id: 'channels', group: 'channels', labelKey: L('channels'), href: '/channels', order: 0, icon: 'channels' },
  { id: 'telegram', group: 'channels', labelKey: L('telegram'), href: '/telegram', order: 10, icon: 'send' },
  { id: 'sms', group: 'channels', labelKey: L('sms'), href: '/sms', order: 20, icon: 'sms' },
  { id: 'line', group: 'channels', labelKey: L('line'), href: '/line', order: 30, icon: 'chat' },
  { id: 'viber', group: 'channels', labelKey: L('viber'), href: '/viber', order: 40, icon: 'phone' },
  { id: 'wechat', group: 'channels', labelKey: L('wechat'), href: '/wechat', order: 50, icon: 'team-chat' },
  { id: 'email', group: 'channels', labelKey: L('email'), href: '/email', order: 60, icon: 'mail' },
  { id: 'wa-links', group: 'channels', labelKey: L('waLinks'), href: '/wa-links', order: 70, icon: 'link' },

  // Sales & CRM
  { id: 'crm-dashboard', group: 'sales', labelKey: L('crmDashboard'), href: '/crm', order: 0, icon: 'crm' },

  // Store
  { id: 'store', group: 'store', labelKey: L('store'), href: '/store', order: 0, icon: 'store' },
  { id: 'catalog', group: 'store', labelKey: L('catalog'), href: '/catalog', order: 10, icon: 'catalog' },

  // Developer
  { id: 'integrations', group: 'developer', labelKey: L('integrations'), href: '/integrations', order: 0, icon: 'plug' },
  { id: 'rest-api', group: 'developer', labelKey: L('restApi'), href: '/developers', order: 10, icon: 'code' },
  { id: 'webhooks', group: 'developer', labelKey: L('webhooks'), href: '/webhooks', order: 20, icon: 'webhook' },

  // Help
  { id: 'support', group: 'help', labelKey: L('support'), href: '/support', order: 0, icon: 'help' },
  { id: 'guidebook', group: 'help', labelKey: L('guidebook'), href: '/guidebook', order: 10, icon: 'book' },
  { id: 'activity-log', group: 'help', labelKey: L('activityLog'), href: '/activity-log', order: 20, icon: 'history' },
];
