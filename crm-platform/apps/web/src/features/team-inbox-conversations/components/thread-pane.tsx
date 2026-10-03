'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type Ref } from 'react';
import { Badge, Button, EmptyState, Spinner, cn } from '@crm/ui';
import type {
  ChannelResponse,
  ConversationNote,
  InboxConversationDetail,
} from '@crm/contracts';
import { ReconnectBanner, TemplatesSoon } from '@/features/channel-whatsapp-cloud';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { CallButton } from '@/features/calling-voice';
import { useRealtimeEvent } from '@/lib/realtime';
import type { Thread } from '../api/use-thread';
import { computeWindow, formatWindowLeft, type WindowView } from '../lib/window';
import { Composer, type ComposerHandle, type ComposerMode } from './composer';
import { AlertIcon, BackIcon, CheckCircleIcon, ClockIcon, PanelIcon } from './icons';
import { MessageStream } from './message-stream';
import { Avatar, ChannelTag } from './parts';

export interface ThreadPaneProps {
  conversationId: string;
  detail: InboxConversationDetail | undefined;
  fetchedAt: number;
  detailPending: boolean;
  notFound: boolean;
  thread: Thread;
  notes: ConversationNote[];
  channel: ChannelResponse | undefined;
  nowMs: number;
  can: { reply: boolean; note: boolean; resolve: boolean; assignSelf: boolean };
  mode: ComposerMode;
  onMode: (mode: ComposerMode) => void;
  composerRef: Ref<ComposerHandle>;
  panelOpen: boolean;
  onTogglePanel: () => void;
  onBack: () => void;
  onSeenLatest: (seq: number) => void;
  onSend: (draft: { body: string; file: File | null }) => void;
  onNote: (body: string) => Promise<boolean>;
  onDeleteNote: (id: string) => void;
  canDeleteNote: (note: ConversationNote) => boolean;
  bottomSignal: number;
  onToggleResolved: () => void;
  /** Re-enqueue a failed outbound message; resolves when the server answered (the screen shows a refusal). */
  onRetryMessage: (messageId: string) => Promise<void>;
  resolving: boolean;
  onAssignSelf: () => void;
  onRetryDetail: () => void;
}

/**
 * The middle pane: the header (who, status, the window countdown, resolve and the panel toggle), the messages, the explanation
 * when free-form replies are off, and the composer. A thread that cannot be found (or that this person may not see) says so
 * and offers the way back instead of an empty frame.
 */
export function ThreadPane(props: ThreadPaneProps) {
  const t = useTranslations('team-inbox-conversations.thread');
  const canManageChannels = useCan('inbox.channel.manage');
  const { detail, thread } = props;

  if (props.notFound) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2 lg:hidden">
          <button
            type="button"
            aria-label={t('back')}
            onClick={props.onBack}
            className="flex size-9 items-center justify-center rounded-md hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
          >
            <BackIcon />
          </button>
        </div>
        <div className="flex flex-1 items-center justify-center p-6">
          <EmptyState title={t('notFound.title')} message={t('notFound.message')} />
        </div>
      </div>
    );
  }

  const win = detail
    ? computeWindow(detail.window, detail.capabilities.windowHours, props.nowMs, props.fetchedAt)
    : null;
  const channelDown = props.channel !== undefined && props.channel.status !== 'connected';
  const windowClosed = win?.state === 'closed';
  const replyDisabled = windowClosed || channelDown;
  const resolved = detail?.status === 'resolved' || detail?.status === 'closed';

  return (
    <section aria-label={detail?.title ?? t('title')} className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <button
          type="button"
          aria-label={t('back')}
          data-testid="inbox-back"
          onClick={props.onBack}
          className="flex size-9 shrink-0 items-center justify-center rounded-md text-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary lg:hidden"
        >
          <BackIcon />
        </button>
        {detail ? (
          <>
            <Avatar id={detail.id} name={detail.title} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <h2 className="truncate text-base font-semibold" data-testid="inbox-thread-title">
                  {detail.title}
                </h2>
                {resolved && <Badge tone="success">{t(`status.${detail.status}`)}</Badge>}
                {detail.status === 'spam' && <Badge tone="danger">{t('status.spam')}</Badge>}
                {detail.status === 'snoozed' && <Badge tone="warning">{t('status.snoozed')}</Badge>}
                {win && <WindowBadge view={win} />}
              </div>
              <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                <span dir="ltr" className="font-mono">
                  {detail.peerKey}
                </span>
                <ChannelTag decorative kind={detail.channel.kind} name={detail.channel.name} />
                <span className="truncate">{detail.channel.name}</span>
                <TypingLine conversationId={detail.id} />
              </p>
            </div>
          </>
        ) : (
          <div className="flex-1">
            {props.detailPending ? (
              <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner /> {t('loading')}
              </p>
            ) : (
              <Button variant="secondary" size="sm" onClick={props.onRetryDetail}>
                {t('retry')}
              </Button>
            )}
          </div>
        )}
        <div className="flex shrink-0 items-center gap-1">
          {detail && (
            <CallButton
              conversationId={detail.id}
              displayName={detail.title}
              contactId={detail.contact?.id}
            />
          )}
          {detail && !props.panelOpen && !detail.assignment.user && props.can.assignSelf && (
            <Button
              variant="secondary"
              size="sm"
              data-testid="inbox-assign-self"
              onClick={props.onAssignSelf}
              className="hidden sm:inline-flex"
            >
              {t('assignToMe')}
            </Button>
          )}
          {detail && props.can.resolve && (
            <Button
              variant="secondary"
              size="sm"
              data-testid="inbox-resolve"
              disabled={props.resolving}
              onClick={props.onToggleResolved}
              title={t('resolveShortcut')}
            >
              {props.resolving ? <Spinner /> : <CheckCircleIcon width={14} height={14} />}
              <span className={props.panelOpen ? 'hidden 2xl:inline' : 'hidden sm:inline'}>
                {resolved ? t('reopen') : t('resolve')}
              </span>
            </Button>
          )}
          <button
            type="button"
            data-testid="inbox-panel-toggle"
            aria-pressed={props.panelOpen}
            aria-label={props.panelOpen ? t('hidePanel') : t('showPanel')}
            title={props.panelOpen ? t('hidePanel') : t('showPanel')}
            onClick={props.onTogglePanel}
            className={cn(
              'flex size-9 items-center justify-center rounded-md hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary',
              props.panelOpen ? 'bg-muted text-foreground' : 'text-muted-foreground',
            )}
          >
            <PanelIcon />
          </button>
        </div>
      </header>

      <MessageStream
        conversationId={props.conversationId}
        state={thread.state}
        notes={props.notes}
        progress={thread.progress}
        olderLoading={thread.olderLoading}
        nowMs={props.nowMs}
        canDeleteNote={props.canDeleteNote}
        bottomSignal={props.bottomSignal}
        onSeenLatest={props.onSeenLatest}
        onLoadOlder={() => void thread.loadOlder()}
        onRetryMessage={props.onRetryMessage}
        canManageChannel={canManageChannels}
        onRetryPending={thread.retryPending}
        onDismissPending={thread.dismissPending}
        onDeleteNote={props.onDeleteNote}
        onReload={() => void thread.sync()}
      />

      {channelDown && props.channel && props.can.reply && props.mode === 'reply' && (
        <ReconnectBanner channel={props.channel} canManage={canManageChannels} />
      )}
      {win && windowClosed && !channelDown && props.can.reply && props.mode === 'reply' && (
        <div
          role="status"
          data-testid="inbox-window-banner"
          className="flex items-start gap-2 border-t border-danger/30 bg-danger/10 px-4 py-2.5 text-sm text-danger"
        >
          <AlertIcon className="mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">{t('windowBanner.title')}</p>
            <p className="text-xs">{t('windowBanner.message')}</p>
            {detail?.capabilities.templates && <TemplatesSoon />}
          </div>
        </div>
      )}
      {!props.can.reply && props.mode === 'reply' && (
        <p role="status" className="border-t border-border bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
          {t('readOnly')}
        </p>
      )}

      <Composer
        conversationId={props.conversationId}
        mode={props.mode}
        onMode={props.onMode}
        replyDisabled={replyDisabled}
        canReply={props.can.reply}
        canNote={props.can.note}
        canAttach={(detail?.capabilities.media.length ?? 0) > 0}
        attachments={
          detail ? { channelKind: detail.channel.kind, allowed: detail.capabilities.media } : undefined
        }
        onSend={props.onSend}
        onNote={props.onNote}
        handleRef={props.composerRef}
      />
    </section>
  );
}

/** The countdown badge of the header (WaDesk's "Closes in 3h 20m" / "Window closed"). */
function WindowBadge({ view }: { view: WindowView }) {
  const t = useTranslations('team-inbox-conversations.thread');
  if (view.state === 'none') return null;
  const left = view.msLeft != null ? formatWindowLeft(view.msLeft) : null;
  return (
    <span
      data-testid="inbox-window-badge"
      data-state={view.state}
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
        view.state === 'closed'
          ? 'bg-danger/15 text-danger'
          : view.state === 'soon'
            ? 'bg-warning/15 text-warning'
            : 'bg-success/15 text-success',
      )}
    >
      <ClockIcon width={11} height={11} />
      {view.state === 'closed'
        ? t('window.closed')
        : left && left.hours >= 1
          ? t('window.closesInHours', { hours: left.hours, minutes: left.minutes })
          : t('window.closesInMinutes', { minutes: left?.minutes ?? 0 })}
    </span>
  );
}

const TYPING_LIFETIME_MS = 6_000;

/** "A teammate is typing" from the typing events of this conversation; each signal expires on its own. */
function TypingLine({ conversationId }: { conversationId: string }) {
  const t = useTranslations('team-inbox-conversations.thread');
  const [typing, setTyping] = useState<ReadonlySet<string>>(new Set());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useRealtimeEvent('inbox.typing', (e) => {
    if (e.payload.conversationId !== conversationId) return;
    const { userId, typing: on } = e.payload;
    const old = timers.current.get(userId);
    if (old) clearTimeout(old);
    timers.current.delete(userId);
    setTyping((cur) => {
      const next = new Set(cur);
      if (on) next.add(userId);
      else next.delete(userId);
      return next;
    });
    if (on) {
      timers.current.set(
        userId,
        setTimeout(() => {
          timers.current.delete(userId);
          setTyping((cur) => {
            const next = new Set(cur);
            next.delete(userId);
            return next;
          });
        }, TYPING_LIFETIME_MS),
      );
    }
  });

  useEffect(() => {
    const live = timers.current;
    return () => {
      for (const id of live.values()) clearTimeout(id);
    };
  }, []);

  if (typing.size === 0) return null;
  return (
    <span role="status" data-testid="inbox-typing" className="inline-flex items-center gap-1 text-primary">
      <span className="inline-flex gap-0.5" aria-hidden="true">
        <span className="size-1 animate-pulse rounded-full bg-primary" />
        <span className="size-1 animate-pulse rounded-full bg-primary [animation-delay:150ms]" />
        <span className="size-1 animate-pulse rounded-full bg-primary [animation-delay:300ms]" />
      </span>
      {t('typing', { count: typing.size })}
    </span>
  );
}
