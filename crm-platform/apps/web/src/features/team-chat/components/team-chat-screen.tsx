'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo, useState } from 'react';
import { Badge, Button, ConfirmDialog, cn, useToast } from '@crm/ui';
import type { TchatChannelResponse, TchatMember, TchatMessageResponse } from '@crm/contracts';
import {
  refreshChannels,
  useActivity,
  useChannels,
  useInvitations,
  usePresencePing,
  useRoster,
  useThread,
} from '../api/hooks';
import { chatApi } from '../api/service';
import { mentionToken } from '../lib/mention';
import { Composer } from './composer';
import {
  ChannelMembersDialog,
  CreateChannelDialog,
  InvitationsDialog,
  InviteDialog,
} from './dialogs';
import { BackIcon, HashIcon, LockIcon, PinIcon, SearchIcon, TrashIcon, UsersIcon } from './icons';
import { MembersRail } from './members-rail';
import { MessageStream } from './message-stream';
import { useErrorText, useNow } from './parts';
import { Sidebar } from './sidebar';
import { SidePanel } from './side-panel';

/**
 * `/team-chat`: channels, a members rail and the conversation (WD-TCHAT-001..030). On a phone the channel list is the home
 * screen and the conversation slides over it; the first channel is selected without opening it, so a person lands on the list.
 */
export function TeamChatScreen({ initialChannelId }: { initialChannelId?: string } = {}) {
  const t = useTranslations('team-chat.screen');
  const qc = useQueryClient();
  const { toast } = useToast();
  const errorText = useErrorText();
  const now = useNow();
  usePresencePing();

  const channelsQ = useChannels();
  const rosterQ = useRoster();
  const invitationsQ = useInvitations();
  const channels = channelsQ.data?.data;
  const me = channelsQ.data?.me ?? null;

  // The selection is screen state only: a reload goes back to #general (WaDesk did the same).
  // A notification's link (`?c=<channel>`) opens that channel, and on a phone straight into its conversation. An id the person cannot
  // see matches no channel, so the default (#general) is selected as usual.
  const [selected, setSelected] = useState<string | null>(initialChannelId ?? null);
  const [mobileThread, setMobileThread] = useState(Boolean(initialChannelId));
  const current: TchatChannelResponse | null = useMemo(() => {
    if (!channels?.length) return null;
    return (
      channels.find((c) => c.id === selected) ??
      channels.find((c) => c.slug === 'general') ??
      channels[0]!
    );
  }, [channels, selected]);
  const channelId = current?.id ?? null;

  const onChanged = useCallback(() => void refreshChannels(qc), [qc]);
  const thread = useThread(channelId, onChanged);
  const activity = useActivity(channelId);

  const [panel, setPanel] = useState<'search' | 'pinned' | null>(null);
  const [replyTo, setReplyTo] = useState<TchatMessageResponse | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [insertion, setInsertion] = useState<{ text: string; nonce: number } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [pendingOpen, setPendingOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Another channel: the panel, the reply and the draft's file belong to the one just left.
  const [seenChannel, setSeenChannel] = useState(channelId);
  if (seenChannel !== channelId) {
    setSeenChannel(channelId);
    setPanel(null);
    setReplyTo(null);
    setFile(null);
  }

  const roster = rosterQ.data?.data ?? null;
  const byId = useMemo(() => new Map((roster ?? []).map((m) => [m.id, m])), [roster]);
  const online = useMemo(() => new Set(activity.data?.online ?? []), [activity.data]);
  const typingNames = useMemo(
    () =>
      (activity.data?.typing ?? [])
        .map((id) => byId.get(id)?.name)
        .filter((n): n is string => Boolean(n)),
    [activity.data, byId],
  );
  const people = useMemo(
    () => (roster ?? []).map((m) => ({ id: m.id, name: m.name, email: m.email })),
    [roster],
  );

  const open = (id: string) => {
    setSelected(id);
    setMobileThread(true);
  };

  const openDirect = async (member: TchatMember) => {
    try {
      const dm = await chatApi.openDirect(member.id);
      await refreshChannels(qc);
      open(dm.id);
    } catch (e) {
      toast(errorText(e), 'danger');
    }
  };

  const mention = (member: TchatMember) =>
    setInsertion({ text: `${mentionToken(member)} `, nonce: Date.now() });

  const jump = (m: TchatMessageResponse) => {
    const el = document.getElementById(`msg-${m.id}`);
    if (el) el.scrollIntoView({ block: 'center' });
    else toast(t('olderMessage'), 'info');
  };

  async function deleteChannel() {
    if (!current) return;
    setBusy(true);
    try {
      await chatApi.deleteChannel(current.id);
      setDeleteOpen(false);
      setSelected(null);
      setMobileThread(false);
      await refreshChannels(qc);
    } catch (e) {
      toast(errorText(e), 'danger');
    } finally {
      setBusy(false);
    }
  }

  const pendingCount = invitationsQ.data?.pendingCount ?? 0;
  const iconButton =
    'flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary';

  return (
    <div className="space-y-3">
      <h1 className="sr-only">{t('title')}</h1>
      <div
        data-testid="tchat-frame"
        className="flex h-[calc(100dvh-9rem)] min-h-[30rem] overflow-hidden rounded-xl border border-border bg-background"
      >
        <div
          className={cn(
            'w-full shrink-0 border-border lg:flex lg:w-60 lg:border-e',
            mobileThread ? 'hidden' : 'flex',
          )}
        >
          <div className="min-h-0 w-full">
            <Sidebar
              channels={channels ?? []}
              activeId={channelId}
              loading={channelsQ.isPending}
              failed={channelsQ.isError}
              canCreate={me?.canManageChannels ?? false}
              pendingCount={pendingCount}
              onSelect={open}
              onCreate={() => setCreateOpen(true)}
              onInvite={() => setInviteOpen(true)}
              onPending={() => setPendingOpen(true)}
            />
          </div>
        </div>

        <div className="hidden w-60 shrink-0 border-e border-border lg:block">
          <MembersRail
            members={roster}
            meId={me?.id ?? ''}
            online={online}
            onMention={mention}
            onDirect={(m) => void openDirect(m)}
          />
        </div>

        <section
          aria-label={current ? current.name : t('title')}
          className={cn('min-w-0 flex-1 flex-col lg:flex', mobileThread ? 'flex' : 'hidden')}
        >
          {current && me ? (
            <>
              <header className="flex items-center gap-2 border-b border-border px-3 py-2">
                <button
                  type="button"
                  aria-label={t('back')}
                  onClick={() => setMobileThread(false)}
                  className={cn(iconButton, 'lg:hidden')}
                >
                  <BackIcon />
                </button>
                <span className="hidden text-muted-foreground sm:block">
                  {current.type === 'private' ? <LockIcon /> : <HashIcon />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="truncate text-base font-semibold" data-testid="tchat-title">
                      {current.type === 'dm' ? (current.peer?.name ?? current.name) : current.name}
                    </h2>
                    <Badge className="hidden sm:inline-flex">{t(`type.${current.type}`)}</Badge>
                  </div>
                  {current.description && (
                    <p className="truncate text-xs text-muted-foreground">{current.description}</p>
                  )}
                </div>
                <button
                  type="button"
                  aria-label={t('search')}
                  aria-pressed={panel === 'search'}
                  className={iconButton}
                  onClick={() => setPanel((p) => (p === 'search' ? null : 'search'))}
                >
                  <SearchIcon />
                </button>
                <button
                  type="button"
                  aria-label={t('pinned')}
                  aria-pressed={panel === 'pinned'}
                  className={iconButton}
                  onClick={() => setPanel((p) => (p === 'pinned' ? null : 'pinned'))}
                >
                  <PinIcon />
                </button>
                {current.type === 'private' && (
                  <button
                    type="button"
                    aria-label={t('members')}
                    className={iconButton}
                    onClick={() => setMembersOpen(true)}
                  >
                    <UsersIcon />
                  </button>
                )}
                {me.canManageChannels && current.type !== 'dm' && current.slug !== 'general' && (
                  <button
                    type="button"
                    aria-label={t('deleteChannel')}
                    className={iconButton}
                    onClick={() => setDeleteOpen(true)}
                  >
                    <TrashIcon />
                  </button>
                )}
              </header>

              {panel && (
                <SidePanel
                  key={panel}
                  mode={panel}
                  channelId={current.id}
                  onClose={() => setPanel(null)}
                  onJump={jump}
                />
              )}

              <MessageStream
                channelId={current.id}
                channelName={
                  current.type === 'dm' ? (current.peer?.name ?? current.name) : current.name
                }
                messages={thread.messages}
                pending={thread.pending}
                loaded={thread.loaded}
                error={thread.error}
                hasOlder={thread.hasOlder}
                olderLoading={thread.olderLoading}
                me={me}
                now={now}
                dragging={dragging}
                onLoadOlder={() => void thread.loadOlder()}
                onReply={setReplyTo}
                onPatched={thread.patch}
                onRemoved={(id) => {
                  thread.remove(id);
                  onChanged();
                }}
                onPinChanged={() =>
                  void qc.invalidateQueries({ queryKey: ['team-chat', 'pinned'] })
                }
                onRetry={thread.retry}
                onDismiss={thread.dismiss}
                onDragState={setDragging}
                onDropFile={setFile}
              />

              <Composer
                channelName={
                  current.type === 'dm' ? (current.peer?.name ?? current.name) : current.name
                }
                people={people}
                meId={me.id}
                replyTo={replyTo}
                onCancelReply={() => setReplyTo(null)}
                file={file}
                onFile={setFile}
                insertion={insertion}
                onSend={thread.send}
                onTyping={() => void chatApi.typing(current.id).catch(() => undefined)}
                typingNames={typingNames}
              />
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
              {channelsQ.isError ? (
                <div className="space-y-3 text-center">
                  <p role="alert">{t('loadFailed')}</p>
                  <Button variant="secondary" onClick={() => void channelsQ.refetch()}>
                    {t('retry')}
                  </Button>
                </div>
              ) : (
                <p role="status">{t('loading')}</p>
              )}
            </div>
          )}
        </section>
      </div>

      <CreateChannelDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(c) => {
          void refreshChannels(qc);
          open(c.id);
        }}
      />
      <InviteDialog open={inviteOpen} onClose={() => setInviteOpen(false)} channel={current} />
      <InvitationsDialog
        open={pendingOpen}
        onClose={() => setPendingOpen(false)}
        onDecided={() => {
          void refreshChannels(qc);
          void qc.invalidateQueries({ queryKey: ['team-chat', 'roster'] });
        }}
      />
      {current && current.type === 'private' && me && (
        <ChannelMembersDialog
          open={membersOpen}
          onClose={() => setMembersOpen(false)}
          channel={current}
          roster={roster ?? []}
          meId={me.id}
          canManage={me.canManageChannels}
          onLeft={() => {
            setSelected(null);
            setMobileThread(false);
            void refreshChannels(qc);
          }}
        />
      )}
      <ConfirmDialog
        open={deleteOpen}
        title={t('deleteTitle')}
        message={t('deleteMessage', { name: current?.name ?? '' })}
        confirmLabel={t('deleteConfirm')}
        cancelLabel={t('cancel')}
        tone="danger"
        busy={busy}
        onConfirm={() => void deleteChannel()}
        onClose={() => setDeleteOpen(false)}
      />
    </div>
  );
}
