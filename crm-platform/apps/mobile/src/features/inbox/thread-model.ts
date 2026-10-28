import type { InfiniteData } from '@tanstack/react-query';
import {
  ERROR_CODES,
  type ConversationEvent,
  type ConversationNote,
  type MessageListResponse,
  type MessageResponse,
} from '@crm/contracts';

/** A message the person just sent that the server has not answered for yet (or refused in a way worth a retry). */
export interface PendingMessage {
  clientMessageId: string;
  body: string;
  state: 'sending' | 'failed';
}

/** Every loaded message, oldest first, each once: pages are newest-first, and a refetch can make two pages overlap. */
export function flattenMessages(
  data: InfiniteData<MessageListResponse> | undefined,
): MessageResponse[] {
  const bySeq = new Map<number, MessageResponse>();
  for (const page of data?.pages ?? []) for (const m of page.data) bySeq.set(m.seq, m);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

/** The cache after the server accepted a send: the stored message joins the newest page (once, whatever answers arrive first). */
export function withMessage(
  data: InfiniteData<MessageListResponse> | undefined,
  next: MessageResponse,
): InfiniteData<MessageListResponse> | undefined {
  const first = data?.pages[0];
  if (!data || !first) return data;
  if (data.pages.some((p) => p.data.some((m) => m.id === next.id))) return data;
  const merged = [...first.data, next].sort((a, b) => a.seq - b.seq);
  return { ...data, pages: [{ ...first, data: merged }, ...data.pages.slice(1)] };
}

/** Codes that mean "the server will never accept this text as it is": the draft goes back to the box instead of a retry bubble. */
export const REFUSED_SEND_CODES: ReadonlySet<string> = new Set([
  ERROR_CODES.SERVICE_WINDOW_CLOSED,
  ERROR_CODES.CHANNEL_DISCONNECTED,
  ERROR_CODES.PLAN_LIMIT_REACHED,
  ERROR_CODES.AUTH_SEND_HALTED,
  ERROR_CODES.FORBIDDEN,
  ERROR_CODES.VALIDATION_FAILED,
  ERROR_CODES.CONVERSATION_NOT_FOUND,
  ERROR_CODES.CHANNEL_CAPABILITY_UNSUPPORTED,
]);

/** The conversation events the thread shows between the messages, as the Geta app does: who has the conversation now. */
export const THREAD_EVENT_TYPES: readonly string[] = ['assigned', 'reassigned', 'unassigned'];

/** One thing in the thread: a message, a private note written between messages, or an assignment event. */
export type ThreadItem =
  | { kind: 'message'; message: MessageResponse }
  | { kind: 'note'; note: ConversationNote }
  | { kind: 'event'; event: ConversationEvent };

/**
 * The messages (oldest first), the notes and the assignment events in one thread, oldest first: a note or an event stands after the last
 * message written before it, and several of them keep their own time order. A note or event and a message from the same instant keep
 * the message first. Events of any other type (status changes, tags, SLA...) are not drawn here: they are in the chat details timeline.
 */
export function mergeThread(
  messages: readonly MessageResponse[],
  notes: readonly ConversationNote[],
  events: readonly ConversationEvent[] = [],
): ThreadItem[] {
  const between: { at: number; item: ThreadItem }[] = [
    ...notes.map((note) => ({
      at: Date.parse(note.createdAt),
      item: { kind: 'note', note } as const,
    })),
    ...events
      .filter((event) => THREAD_EVENT_TYPES.includes(event.type))
      .map((event) => ({
        at: Date.parse(event.createdAt),
        item: { kind: 'event', event } as const,
      })),
  ].sort((a, b) => a.at - b.at);
  const merged: ThreadItem[] = [];
  let next = 0;
  for (const message of messages) {
    const at = Date.parse(message.createdAt);
    while (next < between.length && between[next]!.at < at) {
      merged.push(between[next]!.item);
      next += 1;
    }
    merged.push({ kind: 'message', message });
  }
  while (next < between.length) {
    merged.push(between[next]!.item);
    next += 1;
  }
  return merged;
}
