export type Tab = 'all' | 'mine' | 'unassigned' | 'unread';

export type Conversation = {
  id: string;
  title: string;
  preview: string | null;
  status: string;
  unreadCount: number;
  lastMessageAt: string | null;
  channel: { id: string; kind: string; name: string };
  contact: { id: string; name: string | null } | null;
  assignment: { user: { id: string; name: string | null } | null };
  rowVersion: number;
};

export type ConversationList = {
  data: Conversation[];
  page: { nextCursor: string | null; hasMore: boolean };
  meta: { counts: Record<'all' | 'mine' | 'unassigned' | 'unread' | 'archived', number> };
};

export type Message = {
  id: string;
  seq: number;
  direction: 'in' | 'out';
  kind: string;
  body: string | null;
  status: string;
  clientMessageId: string | null;
  sender: { name: string | null };
  media: { url: string; mime: string; name: string | null } | null;
  failure: { message?: string } | null;
  createdAt: string;
};

export type MessageList = { data: Message[]; page: { hasMoreBefore: boolean } };

export type TemplateOption = {
  id: string;
  name: string;
  language: string;
  body: string;
  slots: { key: string; label: string; example: string | null }[];
  sendable: boolean;
  reason: string | null;
};

export type ConversationDetail = Conversation & {
  window: { open: boolean; expiresAt: string | null };
};

export type Contact = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  lifecycleStage: string | null;
  status: string | null;
};
export type ContactList = { data: Contact[]; page: { nextCursor: string | null; hasMore: boolean } };

export type DashSummary = {
  range: string;
  current: Record<'sent' | 'delivered' | 'failed' | 'read' | 'queued' | 'replies' | 'contactsMessaged', number>;
  sentDeltaPct: number;
  sparkline: number[];
  funnel: { stages: { key: string; count: number; pct: number }[]; replyRate: number };
};
