'use client';

import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Button, Spinner, cn } from '@crm/ui';
import type { TchatMe, TchatMessageResponse } from '@crm/contracts';
import { dayKey, formatDay, nearBottom } from '../lib/format';
import { groupByDay, type Pending } from '../lib/thread';
import { ChatBubbleIcon } from './icons';
import { MessageItem, PendingItem } from './message-item';

export interface MessageStreamProps {
  channelId: string;
  channelName: string;
  messages: TchatMessageResponse[];
  pending: Pending[];
  loaded: boolean;
  error: string | null;
  hasOlder: boolean;
  olderLoading: boolean;
  me: TchatMe;
  now: Date;
  dragging: boolean;
  onLoadOlder: () => void;
  onReply: (m: TchatMessageResponse) => void;
  onPatched: (m: TchatMessageResponse) => void;
  onRemoved: (id: string) => void;
  onPinChanged: () => void;
  onRetry: (key: string) => void;
  onDismiss: (key: string) => void;
  onDragState: (on: boolean) => void;
  onDropFile: (file: File) => void;
}

/**
 * The scrolling list of one channel: day separators, the messages, then the sends in flight. It jumps to the bottom on the first
 * load and on the caller's own send, and follows new messages only while the reader is already near the bottom, so reading
 * older history is never yanked away. A file dropped on it becomes the attachment.
 */
export function MessageStream(props: MessageStreamProps) {
  const t = useTranslations('team-chat.stream');
  const locale = useLocale();
  const timeZone = useTimeZone();
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const prevCount = useRef({ messages: 0, pending: 0, channel: '' });
  const groups = useMemo(
    () => groupByDay(props.messages, (iso: string) => dayKey(iso, timeZone)),
    [props.messages, timeZone],
  );

  // Follow rules, applied after the list changed and before the browser paints.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const prev = prevCount.current;
    const channelChanged = prev.channel !== props.channelId;
    const sentOwn = props.pending.length > prev.pending;
    const grew = props.messages.length > prev.messages;
    if (channelChanged || sentOwn || (grew && stick.current)) {
      // Older history is added above and must not move the view: only a newer tail scrolls.
      const appendedAtEnd = channelChanged || sentOwn || prev.messages === 0 || grew;
      if (appendedAtEnd) el.scrollTop = el.scrollHeight;
    }
    prevCount.current = {
      messages: props.messages.length,
      pending: props.pending.length,
      channel: props.channelId,
    };
  }, [props.messages, props.pending.length, props.channelId]);

  useEffect(() => {
    stick.current = true;
  }, [props.channelId]);

  const onScroll = () => {
    const el = ref.current;
    if (el) stick.current = nearBottom(el.scrollHeight, el.scrollTop, el.clientHeight);
  };

  // Older history keeps the reader's place: the height added above is added to the scroll offset.
  const before = useRef<{ height: number; top: number } | null>(null);
  const loadOlder = () => {
    const el = ref.current;
    if (el) before.current = { height: el.scrollHeight, top: el.scrollTop };
    props.onLoadOlder();
  };
  useLayoutEffect(() => {
    const el = ref.current;
    const b = before.current;
    if (el && b && !props.olderLoading) {
      el.scrollTop = b.top + (el.scrollHeight - b.height);
      before.current = null;
    }
  }, [props.messages, props.olderLoading]);

  const empty = props.loaded && props.messages.length === 0 && props.pending.length === 0;

  return (
    <div
      ref={ref}
      onScroll={onScroll}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          props.onDragState(true);
        }
      }}
      onDragLeave={() => props.onDragState(false)}
      onDrop={(e) => {
        e.preventDefault();
        props.onDragState(false);
        const file = e.dataTransfer.files[0];
        if (file) props.onDropFile(file);
      }}
      data-testid="tchat-stream"
      className={cn(
        'min-h-0 flex-1 overflow-y-auto bg-muted/30 px-5 py-4',
        props.dragging && 'outline-2 -outline-offset-4 outline-dashed outline-primary',
      )}
    >
      {!props.loaded && !props.error && (
        <p role="status" className="py-12 text-center font-mono text-xs text-muted-foreground">
          {t('loading')}
        </p>
      )}
      {props.error && (
        <p role="alert" className="text-sm text-danger">
          {t('loadFailed')}
        </p>
      )}

      {props.hasOlder && (
        <div className="mb-3 flex justify-center">
          <Button variant="secondary" size="sm" onClick={loadOlder} disabled={props.olderLoading}>
            {props.olderLoading && <Spinner />}
            {t('loadOlder')}
          </Button>
        </div>
      )}

      {empty && (
        <div className="flex h-full min-h-[40vh] flex-col items-center justify-center px-6 text-center">
          <ChatBubbleIcon className="mb-3 size-8 text-muted-foreground/60" strokeWidth={1.5} />
          <p className="text-[13px] text-muted-foreground">
            {t('emptyTitle', { name: props.channelName })}
          </p>
          <p className="mt-1 text-[11.5px] text-muted-foreground/80">{t('emptyMessage')}</p>
        </div>
      )}

      {groups.map((g) => (
        <section key={g.key} aria-label={formatDay(g.at, locale, timeZone)} className="mb-2">
          <div className="my-3 text-center">
            <span className="rounded-full bg-muted px-2.5 py-0.5 font-mono text-[10.5px] text-muted-foreground">
              {formatDay(g.at, locale, timeZone)}
            </span>
          </div>
          <ul className="space-y-1">
            {g.messages.map((m) => (
              <MessageItem
                key={m.id}
                message={m}
                me={props.me}
                now={props.now}
                onReply={props.onReply}
                onPatched={props.onPatched}
                onRemoved={props.onRemoved}
                onPinChanged={props.onPinChanged}
              />
            ))}
          </ul>
        </section>
      ))}

      {props.pending.length > 0 && (
        <ul className="mt-3 space-y-3">
          {props.pending.map((p) => (
            <PendingItem
              key={p.key}
              authorName={props.me.name}
              authorId={props.me.id}
              body={p.body}
              file={p.file}
              status={p.status}
              progress={p.progress}
              error={p.error}
              createdAt={p.createdAt}
              now={props.now}
              meId={props.me.id}
              onRetry={() => props.onRetry(p.key)}
              onDismiss={() => props.onDismiss(p.key)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
