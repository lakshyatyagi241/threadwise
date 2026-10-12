'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button, Spinner, cn } from '@crm/ui';
import type { ConversationNote, MessageResponse } from '@crm/contracts';
import { agentReactions, buildItems, lastSeq, type ThreadState } from '../lib/thread';
import { dayLabel } from '../lib/time';
import { MessageBubble, NoteBubble, PendingBubble } from './message-bubble';
import { ArrowDownIcon } from './icons';
import { MessageLogDialog } from './message-log-dialog';
import { useErrorText } from './parts';

/** Keep following new messages only when the reader is already this close to the bottom. */
const NEAR_BOTTOM_PX = 120;
/** Ask for older history when the reader gets this close to the top. */
const NEAR_TOP_PX = 80;

export function nearBottom(scrollHeight: number, scrollTop: number, clientHeight: number): boolean {
  return scrollHeight - scrollTop - clientHeight < NEAR_BOTTOM_PX;
}

export interface MessageStreamProps {
  conversationId: string;
  state: ThreadState;
  notes: ConversationNote[];
  progress: Record<string, number>;
  olderLoading: boolean;
  nowMs: number;
  canDeleteNote: (note: ConversationNote) => boolean;
  /** Changes when the agent added something of their own (a note): the view goes to the bottom to show it. */
  bottomSignal: number;
  /** Called when the newest message is on screen in a visible tab: the thread has been read. */
  onSeenLatest: (seq: number) => void;
  onLoadOlder: () => void;
  onRetryMessage: (id: string) => Promise<void>;
  /** Starts a reply to a message; absent when the person may not reply (no Reply button then). */
  onReply?: (message: MessageResponse) => void;
  /** Puts an emoji on a message (`''` takes it back); absent when the person or the channel cannot react. */
  onReact?: (message: MessageResponse, emoji: string) => Promise<void>;
  canManageChannel: boolean;
  /** The person may export the delivery log (`inbox.logs.export`): its dialog links to the export page. */
  canExportLogs?: boolean;
  onRetryPending: (clientMessageId: string) => void;
  onDismissPending: (clientMessageId: string) => void;
  onDeleteNote: (id: string) => void;
  onReload: () => void;
}

/**
 * The scrolling thread. It jumps to the bottom on the first load and on the agent's own send, follows new messages only while
 * the reader is already near the bottom (reading history is never yanked away; a "jump to latest" pill with a count appears
 * instead), keeps the reader's place when older history is added above, and reports when the newest message has been seen.
 * A polite live region announces each new customer message to a screen reader.
 */
export function MessageStream(props: MessageStreamProps) {
  const t = useTranslations('team-inbox-conversations.thread');
  const locale = useLocale();
  const errorText = useErrorText();
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const stick = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  // The message whose delivery log is open (the dialog fetches it when this is set).
  const [logMessageId, setLogMessageId] = useState<string | null>(null);
  const [unseen, setUnseen] = useState(0);
  const [announcement, setAnnouncement] = useState('');
  const prev = useRef({ conversationId: '', lastSeq: 0, pending: 0, loaded: false });
  const before = useRef<{ height: number; top: number } | null>(null);

  const { state } = props;
  const items = useMemo(
    () => buildItems(state.messages, props.notes, state.pending, state.hasMoreBefore),
    [state.messages, props.notes, state.pending, state.hasMoreBefore],
  );
  const byId = useMemo(() => new Map(state.messages.map((m) => [m.id, m])), [state.messages]);
  const reactions = useMemo(() => agentReactions(state.messages), [state.messages]);
  const newestSeq = lastSeq(state.messages);

  // Follow rules, applied after the list changed and before the browser paints.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const p = prev.current;
    const switched = p.conversationId !== props.conversationId;
    const firstLoad = state.loaded && !p.loaded;
    const sentOwn = state.pending.length > p.pending;
    const grew = newestSeq > p.lastSeq;
    if (switched || firstLoad || sentOwn || (grew && stick.current)) {
      el.scrollTop = el.scrollHeight;
      stick.current = true;
    }
    prev.current = {
      conversationId: props.conversationId,
      lastSeq: switched ? 0 : newestSeq,
      pending: state.pending.length,
      loaded: state.loaded,
    };
  }, [props.conversationId, newestSeq, state.pending.length, state.loaded]);

  // Announce and count what arrived while the reader was away from the bottom.
  const announced = useRef({ conversationId: '', seq: 0 });
  useEffect(() => {
    const a = announced.current;
    if (a.conversationId !== props.conversationId || !state.loaded) {
      announced.current = { conversationId: props.conversationId, seq: newestSeq };
      return;
    }
    if (newestSeq <= a.seq) return;
    const fresh = state.messages.filter((m) => m.seq > a.seq && m.direction === 'in');
    announced.current = { conversationId: props.conversationId, seq: newestSeq };
    if (fresh.length === 0) return;
    const last = fresh[fresh.length - 1]!;
    setAnnouncement(t('newMessageAnnounce', { text: last.body ?? t('attachment') }));
    if (!stick.current) setUnseen((n) => n + fresh.length);
  }, [newestSeq, state.messages, state.loaded, props.conversationId, t]);

  // Pictures and the like take their height after the first paint: while the reader is following the bottom, keep following it.
  useEffect(() => {
    const list = listRef.current;
    const el = ref.current;
    if (!list || !el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (stick.current && before.current === null) el.scrollTop = el.scrollHeight;
    });
    ro.observe(list);
    return () => ro.disconnect();
  }, []);

  const seenSignal = useRef(props.bottomSignal);
  useLayoutEffect(() => {
    if (seenSignal.current === props.bottomSignal) return;
    seenSignal.current = props.bottomSignal;
    stick.current = true;
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [props.bottomSignal, props.notes.length]);

  // Another conversation: nothing is unseen yet and the view follows the bottom.
  const [seenConversation, setSeenConversation] = useState(props.conversationId);
  if (seenConversation !== props.conversationId) {
    setSeenConversation(props.conversationId);
    setAtBottom(true);
    setUnseen(0);
    setAnnouncement('');
  }
  useEffect(() => {
    stick.current = true;
  }, [props.conversationId]);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    const near = nearBottom(el.scrollHeight, el.scrollTop, el.clientHeight);
    stick.current = near;
    setAtBottom(near);
    if (near) setUnseen(0);
    if (el.scrollTop < NEAR_TOP_PX && state.hasMoreBefore && !props.olderLoading && state.loaded) {
      before.current = { height: el.scrollHeight, top: el.scrollTop };
      props.onLoadOlder();
    }
  };

  // Older history keeps the reader's place: the height added above is added to the scroll offset.
  useLayoutEffect(() => {
    const el = ref.current;
    const b = before.current;
    if (el && b && !props.olderLoading) {
      el.scrollTop = b.top + (el.scrollHeight - b.height);
      before.current = null;
    }
  }, [state.messages, props.olderLoading]);

  // The thread counts as read when its newest message is in view in a visible tab.
  const seen = useRef(props.onSeenLatest);
  useEffect(() => {
    seen.current = props.onSeenLatest;
  });
  useEffect(() => {
    if (!state.loaded || newestSeq === 0 || !atBottom) return;
    const tell = () => {
      if (document.visibilityState === 'visible') seen.current(newestSeq);
    };
    tell();
    document.addEventListener('visibilitychange', tell);
    return () => document.removeEventListener('visibilitychange', tell);
  }, [state.loaded, newestSeq, atBottom, props.conversationId]);

  const jump = () => {
    const el = ref.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    stick.current = true;
    setUnseen(0);
  };

  const empty =
    state.loaded &&
    !state.error &&
    state.messages.length === 0 &&
    state.pending.length === 0 &&
    items.length === 0;

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={ref}
        onScroll={onScroll}
        data-testid="inbox-thread-scroll"
        className="thin-scrollbar h-full overflow-y-auto overflow-x-hidden bg-muted/30 px-3 py-3 sm:px-5"
      >
        {!state.loaded && !state.error && (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> {t('loading')}
          </p>
        )}
        {state.error && (
          <div className="space-y-2 text-center">
            <p role="alert" className="text-sm text-danger">
              {errorText(state.error)}
            </p>
            <Button variant="secondary" size="sm" onClick={props.onReload}>
              {t('retry')}
            </Button>
          </div>
        )}

        {state.hasMoreBefore && (
          <div className="mb-3 flex justify-center">
            <Button
              variant="secondary"
              size="sm"
              data-testid="inbox-load-older"
              disabled={props.olderLoading}
              onClick={() => {
                const el = ref.current;
                if (el) before.current = { height: el.scrollHeight, top: el.scrollTop };
                props.onLoadOlder();
              }}
            >
              {props.olderLoading && <Spinner />}
              {t('loadOlder')}
            </Button>
          </div>
        )}

        {empty && <p className="py-10 text-center text-sm text-muted-foreground">{t('empty')}</p>}

        <ul ref={listRef} className="space-y-2.5" aria-label={t('messagesLabel')}>
          {items.map((item) => {
            switch (item.kind) {
              case 'day':
                return (
                  <li
                    key={item.key}
                    role="separator"
                    aria-label={dayLabel(item.at, props.nowMs, locale)}
                    className="flex justify-center py-1"
                  >
                    <span className="rounded-full bg-background px-3 py-0.5 text-[11px] font-medium capitalize text-muted-foreground shadow-sm">
                      {dayLabel(item.at, props.nowMs, locale)}
                    </span>
                  </li>
                );
              case 'message':
                return (
                  <MessageBubble
                    key={item.key}
                    message={item.message}
                    quoted={quotedOf(item.message, byId)}
                    onReply={props.onReply}
                    onReact={props.onReact}
                    agentReaction={reactions.get(item.message.id) ?? null}
                    onRetry={props.onRetryMessage}
                    canManageChannel={props.canManageChannel}
                    onOpenLog={setLogMessageId}
                  />
                );
              case 'note':
                return (
                  <NoteBubble
                    key={item.key}
                    note={item.note}
                    canDelete={props.canDeleteNote(item.note)}
                    onDelete={props.onDeleteNote}
                  />
                );
              case 'pending':
                return (
                  <PendingBubble
                    key={item.key}
                    pending={item.pending}
                    progress={props.progress[item.pending.clientMessageId]}
                    onRetry={props.onRetryPending}
                    onDismiss={props.onDismissPending}
                  />
                );
            }
          })}
        </ul>
      </div>

      <MessageLogDialog
        messageId={logMessageId}
        onClose={() => setLogMessageId(null)}
        canExport={props.canExportLogs === true}
      />

      <div role="status" aria-live="polite" className="sr-only" data-testid="inbox-live">
        {announcement}
      </div>

      {!atBottom && (
        <button
          type="button"
          data-testid="inbox-jump-latest"
          onClick={jump}
          className={cn(
            'absolute bottom-3 end-4 flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium shadow-lg hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary',
          )}
        >
          <ArrowDownIcon width={14} height={14} />
          {unseen > 0 ? t('jumpLatestNew', { count: unseen }) : t('jumpLatest')}
        </button>
      )}
    </div>
  );
}

function quotedOf(m: MessageResponse, byId: Map<string, MessageResponse>): MessageResponse | null {
  return m.replyToMessageId ? (byId.get(m.replyToMessageId) ?? null) : null;
}
