import type { InfiniteData } from '@tanstack/react-query';
import {
  ERROR_CODES,
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

/** One thing in the thread: a message, or a private note written between messages. */
export type ThreadItem =
  { kind: 'message'; message: MessageResponse } | { kind: 'note'; note: ConversationNote };

/**
 * The messages (oldest first) and the notes in one thread, oldest first: a note stands after the last message written before it.
 * A note and a message from the same instant keep the message first.
 */
export function mergeThread(
  messages: readonly MessageResponse[],
  notes: readonly ConversationNote[],
): ThreadItem[] {
  const pending = [...notes].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const merged: ThreadItem[] = [];
  let next = 0;
  for (const message of messages) {
    const at = Date.parse(message.createdAt);
    while (next < pending.length && Date.parse(pending[next]!.createdAt) < at) {
      merged.push({ kind: 'note', note: pending[next]! });
      next += 1;
    }
    merged.push({ kind: 'message', message });
  }
  while (next < pending.length) {
    merged.push({ kind: 'note', note: pending[next]! });
    next += 1;
  }
  return merged;
}
