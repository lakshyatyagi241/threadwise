import type { Tx } from '@crm/db';

/** A smart agent, as the widget needs to know it. */
export interface AssistantRef {
  id: number;
  uuid: string;
  name: string;
}

/** The persona and settings the AI reply is built from (TW-WGT-016). */
export interface AssistantProfile extends AssistantRef {
  systemPrompt: string | null;
  tone: string | null;
  language: string | null;
  aiProvider: string;
  aiModel: string;
  replyMaxTokens: number | null;
  temperature: number | null;
  fallbackMessage: string | null;
  handoffEnabled: boolean;
  handoffKeyword: string | null;
  handoffMessage: string | null;
}

/** One trained source the knowledge base is built from. */
export interface KnowledgeSource {
  label: string;
  kind: string;
  content: string | null;
  question: string | null;
  answer: string | null;
}

/** AI chat assistants and their training sources: owned by the AI agents domain (AIAG). */
export interface AssistantDirectory {
  /** Active assistants of the organization, by name (the builder's picker). */
  listActive(tx: Tx, orgId: number): Promise<AssistantRef[]>;
  /** Any status: Reference only checked that the assistant belongs to the workspace. */
  findByUuid(tx: Tx, orgId: number, uuid: string): Promise<AssistantRef | undefined>;
  profile(tx: Tx, orgId: number, assistantId: number): Promise<AssistantProfile | undefined>;
}
export const ASSISTANT_DIRECTORY = Symbol('WGT_ASSISTANT_DIRECTORY');

export interface ConversationStub {
  id: number;
  created: boolean;
}

export interface InboxLine {
  id: number;
  direction: string;
  body: string | null;
  agentId: number | null;
  sentAt: Date | null;
  /** Reply buttons a flow bot stored with the line. */
  buttons?: Array<{ id: string; title: string; icon?: string }> | null;
  /** A file a flow bot stored with the line. */
  media?: { key: string; kind: string; mime: string; name: string } | null;
  /** What a question line waits for (`widget_input`). */
  input?: { type: string; format?: string; accept?: string[] } | null;
  /** Link, call and email buttons a flow bot stored with the line (`widget_links`). */
  links?: Array<{ label: string; url: string; icon?: string }> | null;
  /** The cards of a carousel a flow bot stored with the line (`widget_cards`). */
  cards?: Array<{
    title: string;
    text: string;
    image?: string;
    buttons: Array<
      { kind: 'reply'; id: string; title: string } | { kind: 'link'; label: string; url: string }
    >;
  }> | null;
}

export interface WidgetForInbox {
  id: number;
  uuid: string;
  userId: number | null;
  name: string;
  welcomeMessage: string | null;
  assistantUuid: string | null;
}

export interface VisitorForInbox {
  id: number;
  visitorUuid: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  conversationId: number | null;
}

/**
 * The team inbox's conversations and messages (TIB1), and the contact a visitor becomes (CON). The widget writes the
 * visitor's thread into the same tables WhatsApp threads use, so operators handle web chats next to them; until those
 * domains export their own services this default writes the tables directly.
 */
export interface InboxGateway {
  /** The visitor's thread, created (with its contact and welcome line) when they have none or it was deleted. */
  ensureConversation(
    tx: Tx,
    orgId: number,
    widget: WidgetForInbox,
    visitor: VisitorForInbox,
  ): Promise<ConversationStub>;
  /** The visitor's message; bumps the thread preview, last-inbound time and unread count. */
  insertInbound(
    tx: Tx,
    orgId: number,
    conversation: ConversationStub,
    widget: WidgetForInbox,
    visitorUuid: string,
    body: string,
  ): Promise<{ id: number; sentAt: Date }>;
  /** The assistant's reply; bumps the thread preview and last-outbound time. */
  insertAssistantReply(
    tx: Tx,
    orgId: number,
    conversation: ConversationStub,
    widget: WidgetForInbox,
    assistantUuid: string | null,
    body: string,
  ): Promise<{ id: number; sentAt: Date }>;
  /**
   * The contact a thread belongs to, or null (none was made: the plan's contact cap, or a failure). Blank phone and email of that contact
   * are filled from what the visitor gave, so a consent recorded for a channel is on a contact that can be reached there.
   */
  contactOf(
    tx: Tx,
    orgId: number,
    conversationId: number,
    details: { email: string | null; phone: string | null },
  ): Promise<number | null>;
  /** The uuid of the `webchat` channel that carries a thread: the id the ingest queue names a channel by. */
  channelUuidOf(tx: Tx, orgId: number, conversationId: number): Promise<string>;
  /** Reference rule (TW-WGT-017): any outbound line after the opening line counts as a person having taken over; see the gateway. */
  humanHasTakenOver(tx: Tx, orgId: number, conversationId: number): Promise<boolean>;
  /** Newest `limit` lines, oldest first. */
  recent(tx: Tx, orgId: number, conversationId: number, limit: number): Promise<InboxLine[]>;
  /** The oldest `limit` lines, oldest first (the transcript the widget repaints). */
  oldest(tx: Tx, orgId: number, conversationId: number, limit: number): Promise<InboxLine[]>;
  /** Outbound lines with an id above `since`, oldest first. */
  outboundSince(tx: Tx, orgId: number, conversationId: number, since: number): Promise<InboxLine[]>;
  /** The file a flow bot stored with one outbound line of this thread, or null (no such line, or it carries none). */
  /** Writes (or, with null, clears) the visitor's feedback on one outbound line of this thread; true when the line was theirs. */
  setFeedback(
    tx: Tx,
    orgId: number,
    conversationId: number,
    id: number,
    value: 'up' | 'down' | null,
  ): Promise<boolean>;
  mediaOf(
    tx: Tx,
    orgId: number,
    conversationId: number,
    id: number,
  ): Promise<NonNullable<InboxLine['media']> | null>;
}
export const INBOX_GATEWAY = Symbol('WGT_INBOX_GATEWAY');

/** The `access_chatbot_widgets` plan flag (TW-WGT-027). */
export interface WidgetPlanGate {
  isEnabled(orgId: number): Promise<boolean>;
}
export const WIDGET_PLAN_GATE = Symbol('WGT_PLAN_GATE');

/** Real-time translation (I18N): the language hint added to the AI prompt (TW-WGT-016 rule 3). */
export interface LanguageHint {
  /** The visitor's language code when it differs from the team language and translation is on; otherwise null. */
  replyLanguage(orgId: number, visitorMessage: string): Promise<string | null>;
}
export const LANGUAGE_HINT = Symbol('WGT_LANGUAGE_HINT');
