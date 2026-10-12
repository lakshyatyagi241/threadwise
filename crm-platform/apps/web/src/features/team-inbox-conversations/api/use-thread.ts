'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  messageResponseSchema,
  type EmailReplyExtras,
  type MessageResponse,
  type SendMessageInput,
} from '@crm/contracts';
import type { ShareInput } from '../lib/share';
import { useRealtimeEvent, useResync, useRoom } from '@/lib/realtime';
import { errorCode } from '../lib/errors';
import {
  EMPTY_THREAD,
  firstSeq,
  hasGap,
  lastSeq,
  threadReducer,
  type PendingSend,
  type ThreadState,
} from '../lib/thread';
import { anyMediaPending } from '@/features/channel-whatsapp-cloud';
import { inboxApi, uploadMedia } from './service';

const PAGE = 50;
/** A gap fill stops after this many pages; the screen then reloads the tail instead of looping on a huge backlog. */
const MAX_FILL_PAGES = 20;
/** How often, and how many times, a thread with a message still queued asks for its tail again. */
const STUCK_CHECK_MS = 8_000;
const STUCK_TRIES = 6;

export interface SendDraft {
  body: string;
  file: File | null;
  /** The message this send answers (its `id`). */
  replyToMessageId?: string | null;
  /** Email conversations: cc, bcc and subject of the reply. */
  email?: EmailReplyExtras;
}

export interface Thread {
  state: ThreadState;
  /** `joined` once the server accepted this conversation's room. */
  room: 'idle' | 'joining' | 'joined' | 'denied';
  loadOlder: () => Promise<void>;
  olderLoading: boolean;
  send: (draft: SendDraft) => void;
  /**
   * Sends an approved template with the values for its variables. Resolves with the stored message merged into the thread and
   * rejects with the API error, so the picker that asked can show it and stay open.
   */
  /** Puts an emoji on a message (`''` takes it back). Rejects with the API error so the screen can say why. */
  react: (target: MessageResponse, emoji: string) => Promise<void>;
  sendTemplate: (input: { templateId: string; variables: Record<string, string> }) => Promise<void>;
  /** Sends a place, contact cards or buttons. Rejects with the API error so the dialog can say why. */
  sendShare: (input: ShareInput) => Promise<void>;
  /** Send again a request that never produced a stored message. */
  retryPending: (clientMessageId: string) => void;
  dismissPending: (clientMessageId: string) => void;
  /** Re-enqueue a stored outbound message that failed at the provider. */
  retryMessage: (messageId: string) => Promise<void>;
  /** Fetch whatever is newer than what is held (and refresh the ticks of the tail). */
  sync: () => Promise<void>;
  /** The upload progress of each pending media send, 0..100. */
  progress: Record<string, number>;
}

/**
 * One thread: the newest page, older history on request, live messages and ticks over the conversation's room, and the sends in
 * flight. Order is by `seq`; a message that skips ahead (or a reconnect, or a returning tab) fetches what is between instead of
 * trusting that nothing was missed. `onWindowChanged` is called when a send was refused because the 24 hour window had closed,
 * so the screen refetches the thread's detail.
 */
export function useThread(
  conversationId: string | null,
  options: { onWindowClosed: () => void; onSent: () => void },
): Thread {
  const [state, dispatch] = useReducer(threadReducer, EMPTY_THREAD);
  const [olderLoading, setOlderLoading] = useState(false);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const files = useRef(new Map<string, File>());
  const latest = useRef({ state, conversationId, options });
  const filling = useRef(false);
  useEffect(() => {
    latest.current = { state, conversationId, options };
  });

  const { state: room } = useRoom(conversationId ? { kind: 'conv', id: conversationId } : null);

  // Load the newest page whenever another conversation is opened.
  useEffect(() => {
    dispatch({ type: 'reset', conversationId });
    files.current.clear();
    if (!conversationId) return;
    const abort = new AbortController();
    inboxApi
      .messages(conversationId, { limit: PAGE }, abort.signal)
      .then((page) =>
        dispatch({ type: 'loaded', messages: page.data, hasMoreBefore: page.page.hasMoreBefore }),
      )
      .catch((e) => {
        if (abort.signal.aborted) return;
        dispatch({ type: 'loadFailed', error: errorCode(e) });
      });
    return () => abort.abort();
  }, [conversationId]);

  const sync = useCallback(async () => {
    const { state: s, conversationId: id } = latest.current;
    if (!id || !s.loaded || filling.current) return;
    filling.current = true;
    try {
      let after = lastSeq(s.messages);
      // The newest page also refreshes the ticks of the tail (a receipt missed while the socket was down).
      const tail = await inboxApi.messages(id, { limit: PAGE });
      if (latest.current.conversationId !== id) return;
      dispatch({ type: 'merge', messages: tail.data });
      const tailFirst = tail.data[0]?.seq ?? Number.POSITIVE_INFINITY;
      if (after > 0 && tailFirst > after + 1) {
        // The burst was bigger than a page: walk forward from what is held.
        for (let i = 0; i < MAX_FILL_PAGES; i++) {
          const page = await inboxApi.messages(id, { afterSeq: after, limit: PAGE });
          if (latest.current.conversationId !== id) return;
          dispatch({ type: 'merge', messages: page.data });
          if (!page.page.hasMoreAfter || page.data.length === 0) break;
          after = page.data[page.data.length - 1]!.seq;
        }
      }
    } catch {
      // A failed refresh keeps what is on screen; the next signal tries again.
    } finally {
      filling.current = false;
    }
  }, []);

  // Events published before the join were not delivered: fetch the tail once the room is held.
  useEffect(() => {
    if (room === 'joined' && state.loaded) void sync();
    // Only the moment the room becomes joined (or the first page arrives) matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, state.loaded]);

  // A tick that is still "sending" after a while may be one whose event never arrived (the socket was down, or the provider's answer
  // was published before this screen joined the room): ask for the tail again, a few times, instead of showing a clock for ever.
  // The same goes for a file still being downloaded from the provider: its completion is a change the thread has to go and read.
  const waiting =
    state.messages.some((m) => m.direction === 'out' && m.status === 'queued') ||
    anyMediaPending(state.messages);
  useEffect(() => {
    if (!waiting) return;
    let tries = 0;
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void sync();
      if (++tries >= STUCK_TRIES) window.clearInterval(id);
    }, STUCK_CHECK_MS);
    return () => window.clearInterval(id);
  }, [waiting, sync]);

  useResync(
    () => void sync(),
    conversationId ? [`conv:${conversationId.toLowerCase()}` as const, 'user'] : [],
  );

  useRealtimeEvent('inbox.message.new', (e) => {
    const { conversationId: id, message } = e.payload;
    if (id !== latest.current.conversationId) return;
    const parsed = messageResponseSchema.safeParse(message);
    // A message with a file is read again over REST: only there is its link minted (the event cannot carry a usable one).
    if (!parsed.success || parsed.data.media !== null) {
      void sync();
      return;
    }
    // A template message is drawn from its stored template, which only a thread read carries: show it now, then read the page.
    if (parsed.data.kind === 'template' && !parsed.data.template?.preview) {
      dispatch({ type: 'merge', messages: [parsed.data] });
      void sync();
      return;
    }
    if (hasGap(latest.current.state.messages, parsed.data.seq)) {
      dispatch({ type: 'merge', messages: [parsed.data] });
      void sync();
      return;
    }
    dispatch({ type: 'merge', messages: [parsed.data] });
  });

  useRealtimeEvent('inbox.message.status', (e) => {
    if (e.payload.conversationId !== latest.current.conversationId) return;
    dispatch({
      type: 'status',
      messageId: e.payload.messageId,
      clientMessageId: e.payload.clientMessageId,
      status: e.payload.status,
      at: e.payload.at,
    });
  });

  const loadOlder = useCallback(async () => {
    const { state: s, conversationId: id } = latest.current;
    const before = firstSeq(s.messages);
    if (!id || before === null || !s.hasMoreBefore) return;
    setOlderLoading(true);
    try {
      const page = await inboxApi.messages(id, { before, limit: PAGE });
      if (latest.current.conversationId !== id) return;
      dispatch({ type: 'older', messages: page.data, hasMoreBefore: page.page.hasMoreBefore });
    } catch {
      // Stays as is; the button is still there to try again.
    } finally {
      setOlderLoading(false);
    }
  }, []);

  /** Posts one pending send (uploading the file first when it has one) and swaps it for the stored message. */
  const post = useCallback(async (p: PendingSend) => {
    const id = latest.current.conversationId;
    if (!id) return;
    try {
      let mediaId = p.media?.mediaId ?? '';
      if (p.kind === 'media' && !mediaId) {
        const file = files.current.get(p.clientMessageId);
        if (!file) throw new TypeError('missing file');
        const up = await uploadMedia(file, (percent) =>
          setProgress((cur) => ({ ...cur, [p.clientMessageId]: percent })),
        );
        mediaId = up.id;
        // Kept on the pending item so a retry after a failed send does not upload again.
        dispatch({
          type: 'send',
          pending: { ...p, media: { ...p.media!, mediaId } },
        });
      }
      const message =
        p.kind === 'media'
          ? await inboxApi.send(id, {
              kind: 'media',
              clientMessageId: p.clientMessageId,
              mediaId,
              caption: p.body || undefined,
              ...(p.replyToMessageId ? { replyToMessageId: p.replyToMessageId } : {}),
            })
          : await inboxApi.send(id, {
              kind: 'text',
              clientMessageId: p.clientMessageId,
              body: p.body,
              ...(p.replyToMessageId ? { replyToMessageId: p.replyToMessageId } : {}),
              ...(p.email ? { email: p.email } : {}),
            });
      files.current.delete(p.clientMessageId);
      if (latest.current.conversationId === id) dispatch({ type: 'merge', messages: [message] });
      latest.current.options.onSent();
    } catch (e) {
      const code = errorCode(e);
      if (latest.current.conversationId === id) {
        dispatch({ type: 'sendFailed', clientMessageId: p.clientMessageId, error: code });
      }
      if (code === 'SERVICE_WINDOW_CLOSED') latest.current.options.onWindowClosed();
    } finally {
      setProgress((cur) => {
        const { [p.clientMessageId]: _gone, ...rest } = cur;
        return rest;
      });
    }
  }, []);

  const send = useCallback(
    (draft: SendDraft) => {
      const body = draft.body.trim();
      if (!body && !draft.file) return;
      const clientMessageId = crypto.randomUUID();
      const pending: PendingSend = {
        clientMessageId,
        kind: draft.file ? 'media' : 'text',
        body,
        replyToMessageId: draft.replyToMessageId ?? null,
        ...(draft.email ? { email: draft.email } : {}),
        media: draft.file
          ? {
              mediaId: '',
              name: draft.file.name,
              mime: draft.file.type || 'application/octet-stream',
              sizeBytes: draft.file.size,
            }
          : null,
        status: 'sending',
        error: null,
        createdAt: new Date().toISOString(),
      };
      if (draft.file) files.current.set(clientMessageId, draft.file);
      dispatch({ type: 'send', pending });
      void post(pending);
    },
    [post],
  );

  const sendTemplate = useCallback(
    async (input: { templateId: string; variables: Record<string, string> }) => {
      const id = latest.current.conversationId;
      if (!id) return;
      const message = await inboxApi.send(id, {
        kind: 'template',
        clientMessageId: crypto.randomUUID(),
        templateId: input.templateId,
        variables: input.variables,
      });
      if (latest.current.conversationId === id) dispatch({ type: 'merge', messages: [message] });
      latest.current.options.onSent();
    },
    [],
  );

  const sendShare = useCallback(async (input: ShareInput) => {
    const id = latest.current.conversationId;
    if (!id) return;
    try {
      const message = await inboxApi.send(id, {
        ...input,
        clientMessageId: crypto.randomUUID(),
      } as SendMessageInput);
      if (latest.current.conversationId === id) dispatch({ type: 'merge', messages: [message] });
      latest.current.options.onSent();
    } catch (e) {
      if (errorCode(e) === 'SERVICE_WINDOW_CLOSED') latest.current.options.onWindowClosed();
      throw e;
    }
  }, []);

  const react = useCallback(async (target: MessageResponse, emoji: string) => {
    const id = latest.current.conversationId;
    if (!id) return;
    try {
      const message = await inboxApi.send(id, {
        kind: 'reaction',
        clientMessageId: crypto.randomUUID(),
        targetMessageId: target.id,
        emoji,
      });
      if (latest.current.conversationId === id) dispatch({ type: 'merge', messages: [message] });
    } catch (e) {
      if (errorCode(e) === 'SERVICE_WINDOW_CLOSED') latest.current.options.onWindowClosed();
      throw e;
    }
  }, []);

  const retryPending = useCallback(
    (clientMessageId: string) => {
      const p = latest.current.state.pending.find((x) => x.clientMessageId === clientMessageId);
      if (!p) return;
      dispatch({ type: 'sendRetry', clientMessageId });
      void post({ ...p, status: 'sending', error: null });
    },
    [post],
  );

  const dismissPending = useCallback((clientMessageId: string) => {
    files.current.delete(clientMessageId);
    dispatch({ type: 'dismiss', clientMessageId });
  }, []);

  const retryMessage = useCallback(async (messageId: string) => {
    const message = await inboxApi.retry(messageId);
    dispatch({ type: 'merge', messages: [message] });
  }, []);

  // The reducer is reset in an effect, one render after another conversation is chosen: never show the old thread under the new one.
  return useMemo(
    () => ({
      state: state.conversationId === conversationId ? state : { ...EMPTY_THREAD, conversationId },
      room,
      loadOlder,
      olderLoading,
      send,
      sendTemplate,
      sendShare,
      react,
      retryPending,
      dismissPending,
      retryMessage,
      sync,
      progress,
    }),
    [
      state,
      conversationId,
      room,
      loadOlder,
      olderLoading,
      send,
      sendTemplate,
      sendShare,
      react,
      retryPending,
      dismissPending,
      retryMessage,
      sync,
      progress,
    ],
  );
}
