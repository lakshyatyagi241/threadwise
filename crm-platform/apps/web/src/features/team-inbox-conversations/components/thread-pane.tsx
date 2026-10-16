'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type Ref } from 'react';
import { Badge, Button, EmptyState, Spinner, cn } from '@crm/ui';
import type {
  ConversationPriority,
  ChannelResponse,
  EmailReplyExtras,
  ConversationNote,
  InboxConversationDetail,
  MessageResponse,
  WaGroupMention,
} from '@crm/contracts';
import {
  defaultReplySubject,
  latestEmailSubject,
} from '@/features/channel-email/lib/composer-extras';
import { emailSendProblem } from '@/features/channel-email/lib/composer-errors';
import { ReconnectBanner } from '@/features/channel-whatsapp-cloud';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { CallButton } from '@/features/calling-voice';
import { useRealtimeEvent } from '@/lib/realtime';
import type { Thread } from '../api/use-thread';
import { inboxApi } from '../api/service';
import {
  cloudGroupBlock,
  isGroupLimited,
  isGroupSendBlocked,
  isPersonalGroupThread,
  personalGroupBlock,
} from '../lib/group-thread';
import type { MentionMember } from '../lib/mentions';
import type { SnoozePreset } from '../lib/selection';
import { computeWindow, formatWindowLeft, type WindowView } from '../lib/window';
import { Composer, type ComposerHandle, type ComposerMode } from './composer';
import { GroupCostLine } from './group-cost-line';
import { ShareDialog, type ShareKind } from './share-dialog';
import { TagChip } from './tag-chip';
import { SlaBadge } from './sla-badge';
import { TagMenu } from './tag-menu';
import { TemplatePicker } from './template-picker';
import { AssignMenu } from './assign-menu';
import { TriageMenu } from './triage-menu';
import {
  AlertIcon,
  BackIcon,
  CheckCircleIcon,
  ClockIcon,
  PanelIcon,
  RefreshIcon,
  SearchIcon,
} from './icons';
import { MessageStream } from './message-stream';
import { ThreadSearch } from './thread-search';
import type { AiModelChoice } from './composer-toolbar';
import { Avatar, ChannelTag } from './parts';

const UUID_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  can: {
    reply: boolean;
    note: boolean;
    resolve: boolean;
    assignSelf: boolean;
    priority?: boolean;
    snooze?: boolean;
  };
  mode: ComposerMode;
  onMode: (mode: ComposerMode) => void;
  composerRef: Ref<ComposerHandle>;
  /** The model of the composer's Smart AI Assistant (null: none is enabled). */
  aiModel?: AiModelChoice | null;
  panelOpen: boolean;
  onTogglePanel: () => void;
  onBack: () => void;
  onSeenLatest: (seq: number) => void;
  onSend: (draft: {
    body: string;
    file: File | null;
    replyToMessageId?: string | null;
    email?: EmailReplyExtras;
    mentions?: WaGroupMention[];
  }) => void;
  /** Puts an emoji on a message (`''` takes it back); the screen shows the refusal. */
  onReact: (message: MessageResponse, emoji: string) => Promise<void>;
  onNote: (body: string) => Promise<boolean>;
  onDeleteNote: (id: string) => void;
  canDeleteNote: (note: ConversationNote) => boolean;
  bottomSignal: number;
  onToggleResolved: () => void;
  /** Re-enqueue a failed outbound message; resolves when the server answered (the screen shows a refusal). */
  onRetryMessage: (messageId: string) => Promise<void>;
  resolving: boolean;
  onAssignSelf: () => void;
  /** The assign pill in the header; without it the header keeps its single "Assign to me" button. */
  assignMenu?: {
    meId: string;
    canAssign: boolean;
    busy: boolean;
    onAssign: (change: { userId: string | null }) => void;
  };
  /** Priority, snooze and wake-up of the open conversation (the screen runs the call and shows the refusal). */
  triage?: {
    busy: boolean;
    onPriority: (priority: ConversationPriority) => void;
    onSnooze: (preset: SnoozePreset) => void;
    onWake: () => void;
  };
  /** Tags of the open conversation: present when the caller may put tags on threads. */
  tags?: {
    busy: boolean;
    canCreate: boolean;
    onApply: (input: { tagId: string } | { name: string }) => void;
    onWithdraw: (tagId: string) => void;
  };
  onRetryDetail: () => void;
}

/**
 * The middle pane: the header (who, status, the window countdown, resolve and the panel toggle), the messages, the explanation
 * when free-form replies are off, and the composer. A thread that cannot be found (or that this person may not see) says so
 * and offers the way back instead of an empty frame.
 */
export function ThreadPane(props: ThreadPaneProps) {
  const t = useTranslations('team-inbox-conversations.thread');
  const tg = useTranslations('team-inbox-conversations.groupThread');
  const canManageChannels = useCan('inbox.channel.manage');
  const canExportLogs = useCan('inbox.logs.export');
  const canOpenGroups = useCan('wa.groups.read');
  const { detail, thread } = props;
  const [searching, setSearching] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  // The message the next send answers. It belongs to one thread: another conversation starts without it.
  const [reply, setReply] = useState<{ conversationId: string; message: MessageResponse } | null>(
    null,
  );
  const replyTo = reply && reply.conversationId === props.conversationId ? reply.message : null;

  // A group of a personal (linked) number reads its members from the group directory for the @mention picker.
  const personalGroup = isPersonalGroupThread(detail?.peerKey, detail?.channel.kind);
  const groupBlock = personalGroup ? personalGroupBlock(detail?.personalGroup) : null;
  const mentionsOn = personalGroup && props.can.reply && groupBlock === null;
  const conversationId = props.conversationId;
  const searchMembers = useCallback(
    async (q: string): Promise<MentionMember[]> =>
      (await inboxApi.groupMembers(conversationId, q)).members,
    [conversationId],
  );

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
  // The Cloud API takes only text and files into a group; a personal number takes everything a person can send there.
  const groupLimited = isGroupLimited(detail?.peerKey, detail?.channel.kind);
  // A Cloud API group the composer is off for: Meta suspended it, the plan has no Groups, or the number was refused for Groups.
  const cloudBlock = cloudGroupBlock(detail?.cloudGroup);
  const groupSendBlocked =
    isGroupSendBlocked(detail?.peerKey, detail?.channel.kind) || cloudBlock !== null;
  const replyDisabled = windowClosed || channelDown || groupBlock !== null;
  // A template needs no open window, only a working channel that sends templates and the right to reply.
  const canTemplate =
    Boolean(detail?.capabilities.templates) &&
    props.can.reply &&
    !channelDown &&
    !groupSendBlocked &&
    detail?.channel.kind !== 'email' &&
    props.mode === 'reply';
  // A place, contact cards and buttons are free-form messages: they need the window like text does (the composer disables the button).
  const shareKinds: ShareKind[] =
    detail && props.can.reply && !channelDown && !groupLimited && props.mode === 'reply'
      ? [
          ...(detail.capabilities.media.includes('location') ? (['location'] as const) : []),
          ...(detail.capabilities.media.includes('contact') ? (['contacts'] as const) : []),
          ...(detail.capabilities.interactive ? (['buttons'] as const) : []),
        ]
      : [];
  const resolved = detail?.status === 'resolved' || detail?.status === 'closed';
  // Email: the reply box adds Cc, Bcc and a subject; templates, shares and files are not part of an email reply (yet).
  const isEmail = detail?.channel.kind === 'email';
  const emailSubject = isEmail ? latestEmailSubject(thread.state.messages, detail?.title) : '';

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
            <div className={cn('min-w-0 flex-1', searching && 'hidden')}>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <h2 className="truncate text-base font-semibold" data-testid="inbox-thread-title">
                  {detail.title}
                </h2>
                {resolved && <Badge tone="success">{t(`status.${detail.status}`)}</Badge>}
                {detail.status === 'snoozed' && <Badge tone="warning">{t('status.snoozed')}</Badge>}
                {win && <WindowBadge view={win} />}
                <SlaBadge status={detail.slaStatus} nowMs={props.nowMs} />
              </div>
              <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                {/* A website visitor's key is a generated id: it tells an agent nothing, so it is not shown. */}
                {!UUID_KEY.test(detail.peerKey) && (
                  <span dir="ltr" className="font-mono">
                    {detail.peerKey}
                  </span>
                )}
                <ChannelTag decorative kind={detail.channel.kind} name={detail.channel.name} />
                <span className="truncate">{detail.channel.name}</span>
                {personalGroup && canOpenGroups && (
                  <Link
                    href="/devices/groups"
                    data-testid="inbox-open-group"
                    className="text-primary underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    {tg('openGroup')}
                  </Link>
                )}
                <TypingLine conversationId={detail.id} />
              </p>
              {detail.labels.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1" data-testid="inbox-thread-tags">
                  {detail.labels.map((l) => (
                    <TagChip key={l.id} tag={l} />
                  ))}
                </div>
              )}
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
        {searching && detail ? (
          <ThreadSearch
            key={detail.id}
            messages={thread.state.messages}
            onClose={() => setSearching(false)}
            className="flex-1"
          />
        ) : (
          <div className="flex shrink-0 items-center gap-1">
            {detail && (
              <CallButton
                conversationId={detail.id}
                displayName={detail.title}
                contactId={detail.contact?.id}
              />
            )}
            {detail && props.tags && (
              <TagMenu
                applied={detail.labels}
                busy={props.tags.busy}
                canCreate={props.tags.canCreate}
                onApply={props.tags.onApply}
                onWithdraw={props.tags.onWithdraw}
              />
            )}
            {detail && props.triage && (
              <TriageMenu
                priority={detail.priority}
                snoozed={detail.status === 'snoozed'}
                canPriority={props.can.priority ?? false}
                canSnooze={props.can.snooze ?? false}
                canWake={props.can.resolve}
                busy={props.triage.busy}
                onPriority={props.triage.onPriority}
                onSnooze={props.triage.onSnooze}
                onWake={props.triage.onWake}
              />
            )}
            {detail && props.assignMenu && (props.assignMenu.canAssign || props.can.assignSelf) && (
              <AssignMenu
                current={detail.assignment.user}
                meId={props.assignMenu.meId}
                canAssign={props.assignMenu.canAssign}
                busy={props.assignMenu.busy}
                onAssign={props.assignMenu.onAssign}
              />
            )}
            {detail &&
              !props.assignMenu &&
              !props.panelOpen &&
              !detail.assignment.user &&
              props.can.assignSelf && (
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
                className="h-9 gap-1.5 rounded-full px-3"
                disabled={props.resolving}
                onClick={props.onToggleResolved}
                title={t('resolveShortcut')}
              >
                {props.resolving ? (
                  <Spinner />
                ) : resolved ? (
                  <RefreshIcon width={14} height={14} />
                ) : (
                  <CheckCircleIcon width={14} height={14} />
                )}
                <span>{resolved ? t('reopen') : t('resolve')}</span>
              </Button>
            )}
            {detail && (
              <button
                type="button"
                data-testid="inbox-thread-search-open"
                aria-label={t('searchOpen')}
                title={t('searchOpen')}
                onClick={() => setSearching(true)}
                className="flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
              >
                <SearchIcon />
              </button>
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
        )}
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
        onReply={
          props.can.reply && !replyDisabled && !groupLimited
            ? (message) => {
                setReply({ conversationId: props.conversationId, message });
                props.onMode('reply');
              }
            : undefined
        }
        onReact={
          props.can.reply && !replyDisabled && !groupLimited && detail?.capabilities.reactions
            ? props.onReact
            : undefined
        }
        canManageChannel={canManageChannels}
        canExportLogs={canExportLogs}
        onRetryPending={thread.retryPending}
        onDismissPending={thread.dismissPending}
        onDeleteNote={props.onDeleteNote}
        onReload={() => void thread.sync()}
      />

      {channelDown && props.channel && props.can.reply && props.mode === 'reply' && (
        <ReconnectBanner channel={props.channel} canManage={canManageChannels} />
      )}
      {win &&
        windowClosed &&
        !channelDown &&
        !groupLimited &&
        props.can.reply &&
        props.mode === 'reply' && (
          <div
            role="status"
            data-testid="inbox-window-banner"
            className="flex items-start gap-2 border-t border-danger/30 bg-danger/10 px-4 py-2.5 text-sm text-danger"
          >
            <AlertIcon className="mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">{t('windowBanner.title')}</p>
              <p className="text-xs">{t('windowBanner.message')}</p>
              {canTemplate && (
                <Button
                  type="button"
                  variant="secondary"
                  data-testid="inbox-window-template"
                  className="mt-2"
                  onClick={() => setTemplatesOpen(true)}
                >
                  {t('windowBanner.sendTemplate')}
                </Button>
              )}
            </div>
          </div>
        )}
      {groupBlock !== null && props.can.reply && props.mode === 'reply' && (
        <div
          role="status"
          data-testid="inbox-group-readonly"
          data-reason={groupBlock}
          className="flex items-start gap-2 border-t border-border bg-muted/50 px-4 py-2.5 text-sm"
        >
          <AlertIcon className="mt-0.5 shrink-0 text-muted-foreground" />
          <div>
            <p className="font-medium">{tg(`readOnly.${groupBlock}.title`)}</p>
            <p className="text-xs text-muted-foreground">{tg(`readOnly.${groupBlock}.message`)}</p>
          </div>
        </div>
      )}
      {cloudBlock !== null && props.can.reply && props.mode === 'reply' && (
        <div
          role="status"
          data-testid="inbox-group-cloud-block"
          data-reason={cloudBlock}
          className="flex items-start gap-2 border-t border-border bg-muted/50 px-4 py-2.5 text-sm"
        >
          <AlertIcon className="mt-0.5 shrink-0 text-muted-foreground" />
          <div>
            <p className="font-medium">{tg(`cloudBlock.${cloudBlock}.title`)}</p>
            <p className="text-xs text-muted-foreground">
              {tg(`cloudBlock.${cloudBlock}.message`)}
            </p>
          </div>
        </div>
      )}
      {detail?.cloudGroup &&
        cloudBlock === null &&
        props.can.reply &&
        props.mode === 'reply' &&
        !channelDown && <GroupCostLine group={detail.cloudGroup} />}
      {!props.can.reply && props.mode === 'reply' && (
        <p
          role="status"
          className="border-t border-border bg-muted/40 px-4 py-2 text-xs text-muted-foreground"
        >
          {t('readOnly')}
        </p>
      )}

      <Composer
        aiModel={props.aiModel}
        conversationId={props.conversationId}
        mode={props.mode}
        onMode={props.onMode}
        replyDisabled={replyDisabled}
        canReply={props.can.reply}
        canNote={props.can.note}
        canAttach={isEmail ? props.can.reply : (detail?.capabilities.media.length ?? 0) > 0}
        email={
          isEmail
            ? {
                defaultSubject: defaultReplySubject(emailSubject),
                channelId: detail?.channel.id,
                sendProblem: emailSendProblem(thread.state.pending),
              }
            : undefined
        }
        groupSendBlocked={groupSendBlocked}
        groupBlockedHint={cloudBlock ? tg(`cloudBlock.${cloudBlock}.title`) : undefined}
        groupMentions={mentionsOn ? { search: searchMembers } : undefined}
        attachments={
          detail
            ? { channelKind: detail.channel.kind, allowed: detail.capabilities.media }
            : undefined
        }
        savedReplies={props.can.reply ? { channelKind: detail?.channel.kind } : undefined}
        canTemplate={canTemplate}
        onTemplate={() => setTemplatesOpen(true)}
        canShare={shareKinds.length > 0}
        onShare={() => setShareOpen(true)}
        onSend={(draft) => {
          props.onSend({ ...draft, replyToMessageId: replyTo?.id ?? null });
          setReply(null);
        }}
        replyTo={replyTo}
        onCancelReply={() => setReply(null)}
        onNote={props.onNote}
        handleRef={props.composerRef}
      />
      <ShareDialog
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        kinds={shareKinds}
        onSend={thread.sendShare}
      />
      <TemplatePicker
        conversationId={props.conversationId}
        contactName={detail?.title}
        contactFields={contactFieldsOf(detail?.contactSummary)}
        open={templatesOpen}
        onClose={() => setTemplatesOpen(false)}
        onSend={thread.sendTemplate}
      />
    </section>
  );
}

/** The countdown badge of the header (Reference's "Closes in 3h 20m" / "Window closed"). */
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
    <span
      role="status"
      data-testid="inbox-typing"
      className="inline-flex items-center gap-1 text-primary"
    >
      <span className="inline-flex gap-0.5" aria-hidden="true">
        <span className="size-1 animate-pulse rounded-full bg-primary" />
        <span className="size-1 animate-pulse rounded-full bg-primary [animation-delay:150ms]" />
        <span className="size-1 animate-pulse rounded-full bg-primary [animation-delay:300ms]" />
      </span>
      {t('typing', { count: typing.size })}
    </span>
  );
}

/** The contact's details a template variable can be taken from, only the ones the contact has. */
function contactFieldsOf(
  c: { name: string | null; phone: string | null; email: string | null } | null | undefined,
): Array<{ key: 'name' | 'phone' | 'email'; value: string }> {
  if (!c) return [];
  return (['name', 'phone', 'email'] as const)
    .map((key) => ({ key, value: (c[key] ?? '').trim() }))
    .filter((f) => f.value !== '');
}
