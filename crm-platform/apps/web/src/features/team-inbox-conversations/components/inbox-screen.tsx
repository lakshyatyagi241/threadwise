'use client';

import { useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTimeZone, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ConfirmDialog, cn, useToast } from '@crm/ui';
import {
  uuidSchema,
  type ConversationPriority,
  type ConversationSummary,
  type EmailReplyExtras,
  type MessageResponse,
  type WaGroupMention,
} from '@crm/contracts';
import { useCan, useSession } from '@/features/auth-registration-security/shared/session-context';
import { ApiError } from '@/lib/api/errors';
import { useRealtimeEvent } from '@/lib/realtime';
import { useStoredValue } from '@/lib/use-stored-value';
import { KEYS, useChannels, useNotes, useNowMs, useOpenConversation } from '../api/hooks';
import { useBulkSelection } from '../api/use-bulk';
import { snoozeUntil, type SnoozePreset } from '../lib/selection';
import { offerChannels } from '@/lib/unofficial-whatsapp';
import { useUnofficialWhatsapp } from '@/lib/use-unofficial-whatsapp';
import { inboxApi } from '../api/service';
import { useThread } from '../api/use-thread';
import { useConversationList } from '../api/use-list';
import { cloudGroupBlock, isGroupSendBlocked } from '../lib/group-thread';
import { DEFAULT_FILTERS, filtersKey, tagsFromParam, type ListFilters } from '../lib/list';
import { isTypingTarget, shortcutAction } from '../lib/shortcuts';
import type { ComposerHandle, ComposerMode } from './composer';
import type { AiModelChoice } from './composer-toolbar';
import { useAiModels } from '@/features/ai-keys-usage-admin';
import { ContactPanel } from './contact-panel';
import { BulkBar } from './bulk-bar';
import { ConversationList } from './conversation-list';
import { InboxIcon } from './icons';
import { Drawer, useErrorText } from './parts';
import { SimulatorDrawer, withFault, type SendFault } from './simulator-drawer';
import { ThreadPane } from './thread-pane';

/** The current query string with one parameter set (or removed with null), so opening a thread keeps the tag filter. */
function withParam(key: string, value: string | null): string {
  const next = new URLSearchParams(window.location.search);
  if (value === null) next.delete(key);
  else next.set(key, value);
  return next.toString();
}

/** The three panes sit side by side from here; below it the contact panel is a slide-over. */
const XL_QUERY = '(min-width: 1280px)';
const LG_QUERY = '(min-width: 1024px)';

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/**
 * `/inbox`: the three-pane team inbox (Reference's Team Inbox, rebuilt). The list, the open thread and the contact panel share one
 * screen on a wide window; on a phone the list is the home screen and the thread slides over it with a back button. The open
 * conversation is the `c` query parameter, so a link (a notification, a message) opens it directly.
 */
export function InboxScreen() {
  const t = useTranslations('team-inbox-conversations.screen');
  const timeZone = useTimeZone();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const qc = useQueryClient();
  const { toast } = useToast();
  const errorText = useErrorText();
  const session = useSession();
  const meId = session.user.id;
  const nowMs = useNowMs(30_000);

  const can = {
    reply: useCan('inbox.conversation.reply'),
    note: useCan('inbox.conversation.note'),
    assign: useCan('inbox.conversation.assign'),
    assignSelf: useCan('inbox.conversation.assign_self'),
    resolve: useCan('inbox.conversation.resolve'),
    bulk: useCan('inbox.conversation.bulk'),
    priority: useCan('inbox.conversation.priority'),
    snooze: useCan('inbox.conversation.snooze'),
    tag: useCan('inbox.conversation.tag'),
    tagManage: useCan('inbox.tag.manage'),
    editContact: useCan('record.contacts.update'),
    manageChannels: useCan('inbox.channel.manage'),
  };

  // --- what is open ---
  const rawId = params.get('c');
  const selectedId = rawId && uuidSchema.safeParse(rawId).success ? rawId.toLowerCase() : null;

  // `/inbox?channel=<id>` (the "Open in inbox" link of a mailbox, TW-MAIL-024) starts filtered by that channel.
  const [filters, setFilters] = useState<ListFilters>(() => {
    const channel = params.get('channel');
    // `/inbox?tags=<id>,<id>&tagScope=conversation|contact`: the tag filter lives in the address, so a filtered view can be shared or
    // reloaded. `labels` is the original name of `tags`: saved links that use it keep working.
    const tags = tagsFromParam(
      [params.get('tags'), params.get('labels')].filter(Boolean).join(','),
    );
    return {
      ...DEFAULT_FILTERS,
      tags,
      tagScope:
        params.get('tagScope') === 'contact' ? ('contact' as const) : ('conversation' as const),
      ...(channel && /^[0-9a-f-]{36}$/i.test(channel) ? { channelId: channel } : {}),
    };
  });
  const patchFilters = useCallback(
    (patch: Partial<ListFilters>) => {
      setFilters((f) => ({ ...f, ...patch }));
      if (patch.tags || patch.tagScope) {
        const next = new URLSearchParams(window.location.search);
        next.delete('labels');
        if (patch.tags) {
          if (patch.tags.length > 0) next.set('tags', patch.tags.join(','));
          else next.delete('tags');
        }
        if (patch.tagScope) {
          if (patch.tagScope === 'contact') next.set('tagScope', 'contact');
          else next.delete('tagScope');
        }
        const qs = next.toString();
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      }
    },
    [router, pathname],
  );
  const list = useConversationList(filters, meId);
  const bulk = useBulkSelection(list.state.rows, filtersKey(filters), list.refresh);
  const channelsQ = useChannels();
  // The Smart AI Assistant of the composer asks the first model of a vendor the rewrite route can call.
  const aiModels = useAiModels();
  const aiModel = useMemo(
    () =>
      aiModels.data?.data
        .map((m) => ({ provider: m.provider as string, value: m.value }))
        .find(
          (m): m is AiModelChoice =>
            m.provider === 'openai' ||
            m.provider === 'anthropic' ||
            m.provider === 'gemini' ||
            m.provider === 'openrouter',
        ) ?? null,
    [aiModels.data],
  );
  const channels = channelsQ.data?.data;
  const unofficial = useUnofficialWhatsapp();
  // The channel filter and picker offer personal-number (QR) channels only while the platform has that engine on.
  const filterChannels = channels ? offerChannels(channels, unofficial) : channels;
  const simulatorAvailable = (channels ?? []).some((c) => c.kind === 'simulator');

  const detail = useOpenConversation(selectedId, list.placeRow);
  const thread = useThread(selectedId, {
    onWindowClosed: () => void detail.refetch(),
    onSent: () => list.refreshCounts(),
  });
  const notesQ = useNotes(selectedId);
  // The API answers newest first; the thread wants oldest first.
  const notes = useMemo(
    () =>
      (notesQ.data?.data ?? [])
        .slice()
        .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0)),
    [notesQ.data],
  );
  const channel = channels?.find((c) => c.id === detail.detail?.channel.id);

  const [mode, setMode] = useState<ComposerMode>('reply');
  const composerRef = useRef<ComposerHandle>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [bottomSignal, setBottomSignal] = useState(0);
  const [fault, setFault] = useState<SendFault>('none');
  const [simulatorOpen, setSimulatorOpen] = useState(false);

  // --- the contact panel ---
  const isXl = useMediaQuery(XL_QUERY);
  const [stored, setStored] = useStoredValue('inbox.panel');
  const inlineOpen = stored !== 'closed';
  const [drawerOpen, setDrawerOpen] = useState(false);
  const panelOpen = isXl ? inlineOpen : drawerOpen;
  const togglePanel = () =>
    isXl ? setStored(inlineOpen ? 'closed' : 'open') : setDrawerOpen((v) => !v);

  // --- opening and closing a thread ---
  const focusNext = useRef(false);
  const lastOpened = useRef<string | null>(null);
  const open = useCallback(
    (id: string, opts?: { focus?: boolean }) => {
      focusNext.current = opts?.focus ?? true;
      router.push(`${pathname}?${withParam('c', id)}`, { scroll: false });
    },
    [router, pathname],
  );
  const back = useCallback(() => {
    router.replace(
      (() => {
        const qs = withParam('c', null);
        return qs ? `${pathname}?${qs}` : pathname;
      })(),
      { scroll: false },
    );
  }, [router, pathname]);

  // Another conversation: the composer goes back to a reply and the slide-over closes.
  const [shownId, setShownId] = useState(selectedId);
  if (shownId !== selectedId) {
    setShownId(selectedId);
    setMode('reply');
    setDrawerOpen(false);
  }

  // ...and focus goes where the reader's eyes are.
  useEffect(() => {
    if (selectedId) {
      lastOpened.current = selectedId;
      if (focusNext.current) {
        focusNext.current = false;
        requestAnimationFrame(() => {
          if (window.matchMedia(LG_QUERY).matches) composerRef.current?.focus();
          else document.querySelector<HTMLElement>('[data-testid="inbox-back"]')?.focus();
        });
      }
    } else if (lastOpened.current) {
      // Back on the list: the row that was open takes the focus.
      const id = lastOpened.current;
      lastOpened.current = null;
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>(`[data-conversation-id="${id}"]`)?.focus(),
      );
    }
  }, [selectedId]);

  // --- reading ---
  const seen = useRef<{ id: string; marked: number } | null>(null);
  const onSeenLatest = useCallback(
    (seq: number) => {
      if (!selectedId) return;
      if (seen.current?.id !== selectedId) {
        const unread =
          detail.detail?.unreadCount ??
          list.state.rows.find((r) => r.id === selectedId)?.unreadCount ??
          1;
        seen.current = { id: selectedId, marked: unread > 0 ? 0 : seq };
      }
      if (seq <= seen.current.marked) return;
      seen.current.marked = seq;
      list.setUnread(selectedId, 0);
      qc.setQueryData(KEYS.conversation(selectedId), (d: unknown) =>
        d && typeof d === 'object' ? { ...d, unreadCount: 0 } : d,
      );
      inboxApi
        .markRead(selectedId, seq)
        .then((out) => list.setUnread(out.conversationId, out.unreadCount))
        .catch(() => undefined);
    },
    [selectedId, detail.detail?.unreadCount, list, qc],
  );

  // --- changes made here ---
  const [assigning, setAssigning] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [noteToDelete, setNoteToDelete] = useState<string | null>(null);
  const [deletingNote, setDeletingNote] = useState(false);

  /** A change the server may refuse because someone else changed the row first: reload instead of retrying blindly. */
  const guarded = useCallback(
    async (run: () => Promise<unknown>) => {
      try {
        await run();
        await detail.refetch();
        list.refreshCounts();
        return true;
      } catch (e) {
        toast(
          e instanceof ApiError && e.isRowVersionConflict ? t('conflict') : errorText(e),
          'danger',
        );
        await detail.refetch();
        return false;
      }
    },
    [detail, list, toast, t, errorText],
  );

  const assign = useCallback(
    async (change: { userId?: string | null; teamId?: string | null }) => {
      const d = detail.detail;
      if (!d) return;
      setAssigning(true);
      const ok = await guarded(async () => {
        const row = await inboxApi.assign(d.id, { rowVersion: d.rowVersion, ...change });
        list.placeRow(row);
      });
      setAssigning(false);
      if (!ok) return;
      toast(
        change.userId === undefined
          ? t('teamChanged')
          : change.userId === null
            ? t('unassigned')
            : change.userId === meId
              ? t('assignedToYou')
              : t('assigned'),
      );
    },
    [detail.detail, guarded, list, toast, t, meId],
  );

  const toggleResolved = useCallback(async () => {
    const d = detail.detail;
    if (!d || !can.resolve) return;
    const reopen = d.status === 'resolved' || d.status === 'closed';
    setResolving(true);
    const ok = await guarded(() =>
      inboxApi.setStatus(d.id, d.rowVersion, reopen ? 'open' : 'resolved'),
    );
    setResolving(false);
    if (ok) toast(reopen ? t('reopened') : t('resolved'));
  }, [detail.detail, can.resolve, guarded, toast, t]);

  const [triaging, setTriaging] = useState(false);
  const setPriority = useCallback(
    async (priority: ConversationPriority) => {
      const d = detail.detail;
      if (!d || !can.priority || d.priority === priority) return;
      setTriaging(true);
      const ok = await guarded(async () => {
        list.placeRow(await inboxApi.setPriority(d.id, d.rowVersion, priority));
      });
      setTriaging(false);
      if (ok) toast(t('priorityChanged'));
    },
    [detail.detail, can.priority, guarded, list, toast, t],
  );
  // The row's three-dot menu: the same priority change as the thread header, for any row in the list.
  const setRowPriority = useCallback(
    async (row: ConversationSummary, priority: ConversationPriority) => {
      if (!can.priority || row.priority === priority) return;
      const ok = await guarded(async () => {
        list.placeRow(await inboxApi.setPriority(row.id, row.rowVersion, priority));
      });
      if (ok) toast(t('priorityChanged'));
    },
    [can.priority, guarded, list, toast, t],
  );
  const snooze = useCallback(
    async (preset: SnoozePreset) => {
      const d = detail.detail;
      if (!d || !can.snooze) return;
      setTriaging(true);
      const ok = await guarded(async () => {
        list.placeRow(
          await inboxApi.snooze(d.id, d.rowVersion, snoozeUntil(preset, new Date(), timeZone)),
        );
      });
      setTriaging(false);
      if (ok) toast(t('snoozed'));
    },
    [detail.detail, can.snooze, guarded, list, toast, t, timeZone],
  );
  const wake = useCallback(async () => {
    const d = detail.detail;
    if (!d || !can.resolve) return;
    setTriaging(true);
    const ok = await guarded(() => inboxApi.setStatus(d.id, d.rowVersion, 'open'));
    setTriaging(false);
    if (ok) toast(t('reopened'));
  }, [detail.detail, can.resolve, guarded, toast, t]);

  const markSpam = useCallback(async () => {
    const d = detail.detail;
    if (!d || !can.resolve || d.status === 'spam') return;
    setTriaging(true);
    const ok = await guarded(async () => {
      list.placeRow(await inboxApi.markSpam(d.id, d.rowVersion));
    });
    setTriaging(false);
    if (ok) toast(t('spammed'));
  }, [detail.detail, can.resolve, guarded, list, toast, t]);

  const [tagging, setTagging] = useState(false);
  const applyTag = useCallback(
    async (input: { tagId: string } | { name: string }) => {
      const d = detail.detail;
      if (!d || !can.tag) return;
      setTagging(true);
      const ok = await guarded(async () => {
        list.placeRow(await inboxApi.applyTag(d.id, input));
        if ('name' in input) await qc.invalidateQueries({ queryKey: KEYS.tags });
      });
      setTagging(false);
      if (ok) toast(t('tagAdded'));
    },
    [detail.detail, can.tag, guarded, list, qc, toast, t],
  );
  const withdrawTag = useCallback(
    async (tagId: string) => {
      const d = detail.detail;
      if (!d || !can.tag) return;
      setTagging(true);
      const ok = await guarded(async () => {
        list.placeRow(await inboxApi.withdrawTag(d.id, tagId));
      });
      setTagging(false);
      if (ok) toast(t('tagRemoved'));
    },
    [detail.detail, can.tag, guarded, list, toast, t],
  );

  const addNote = useCallback(
    async (body: string) => {
      if (!selectedId) return false;
      try {
        await inboxApi.addNote(selectedId, { body, mentions: [] });
        await Promise.all([
          qc.invalidateQueries({ queryKey: KEYS.notes(selectedId) }),
          qc.invalidateQueries({ queryKey: KEYS.events(selectedId) }),
        ]);
        setBottomSignal((n) => n + 1);
        return true;
      } catch (e) {
        toast(errorText(e), 'danger');
        return false;
      }
    },
    [selectedId, qc, toast, errorText],
  );

  async function confirmDeleteNote() {
    if (!selectedId || !noteToDelete) return;
    setDeletingNote(true);
    try {
      await inboxApi.deleteNote(selectedId, noteToDelete);
      await qc.invalidateQueries({ queryKey: KEYS.notes(selectedId) });
      setNoteToDelete(null);
    } catch (e) {
      toast(errorText(e), 'danger');
    } finally {
      setDeletingNote(false);
    }
  }

  const retryMessage = useCallback(
    async (messageId: string) => {
      try {
        await thread.retryMessage(messageId);
      } catch (e) {
        toast(errorText(e), 'danger');
      }
    },
    [thread, toast, errorText],
  );

  const onReact = useCallback(
    async (message: MessageResponse, emoji: string) => {
      try {
        await thread.react(message, emoji);
      } catch (e) {
        toast(errorText(e), 'danger');
      }
    },
    [thread, toast, errorText],
  );

  // Read once, outside the callback: the compiler can then keep the memoization exactly as written.
  const openPeerKey = detail.detail?.peerKey;
  const openChannelKind = detail.detail?.channel.kind;
  // A Cloud API group the composer is off for (suspended, plan, not eligible): never sent to from here either.
  const cloudGroupOff = cloudGroupBlock(detail.detail?.cloudGroup) !== null;
  const onSend = useCallback(
    (draft: {
      body: string;
      file: File | null;
      replyToMessageId?: string | null;
      email?: EmailReplyExtras;
      mentions?: WaGroupMention[];
    }) => {
      // A group thread on a channel that cannot send to a group is never sent to (the composer is off; this is the belt to that braces).
      // A personal-number group is not one of them; its own refusals (left, admins only) come from the API.
      if (isGroupSendBlocked(openPeerKey, openChannelKind) || cloudGroupOff) return;
      // The simulator's one-shot fault goes in as a prefix on the text (or the caption of a file).
      const body = withFault(draft.body, fault);
      if (fault !== 'none') setFault('none');
      thread.send({
        body,
        file: draft.file,
        replyToMessageId: draft.replyToMessageId,
        ...(draft.email ? { email: draft.email } : {}),
        ...(draft.mentions ? { mentions: draft.mentions } : {}),
      });
    },
    [fault, thread, openPeerKey, openChannelKind, cloudGroupOff],
  );

  // --- presence ---
  const [presence, setPresence] = useState<ReadonlyMap<string, string>>(new Map());
  useRealtimeEvent('inbox.presence', (e) =>
    setPresence((cur) => new Map(cur).set(e.payload.userId, e.payload.state)),
  );

  // --- keyboard ---
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTypingTarget(e.target)) return;
      const action = shortcutAction(e);
      if (!action) return;
      const rows = list.state.rows;
      if (action === 'search') {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (action === 'resolve') {
        if (selectedId) {
          e.preventDefault();
          void toggleResolved();
        }
        return;
      }
      if (rows.length === 0) return;
      const at = rows.findIndex((r) => r.id === selectedId);
      const next =
        action === 'next' ? Math.min(rows.length - 1, at + 1) : Math.max(0, at < 0 ? 0 : at - 1);
      const row = rows[next];
      if (!row || row.id === selectedId) return;
      e.preventDefault();
      open(row.id, { focus: false });
      requestAnimationFrame(() =>
        document
          .querySelector(`[data-conversation-id="${row.id}"]`)
          ?.scrollIntoView({ block: 'nearest' }),
      );
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [list.state.rows, selectedId, open, toggleResolved]);

  /** A note is deleted by its author, or by someone who may manage assignments (the API's rule). */
  const canDeleteNote = useCallback(
    (n: { author: { userId: string | null } }) => n.author.userId === meId || can.assign,
    [meId, can.assign],
  );

  const panel = detail.detail ? (
    <ContactPanel
      detail={detail.detail}
      meId={meId}
      can={{
        assign: can.assign,
        assignSelf: can.assignSelf,
        resolve: can.resolve,
      }}
      presence={presence}
      nowMs={nowMs}
      assigning={assigning}
      resolving={resolving}
      onAssign={(change) => void assign(change)}
      onToggleResolved={() => void toggleResolved()}
      onOpenConversation={(id) => open(id, { focus: false })}
      canEditContact={can.editContact}
      tags={
        can.tag
          ? {
              busy: tagging,
              canCreate: can.tagManage,
              onApply: (input) => void applyTag(input),
              onWithdraw: (tagId) => void withdrawTag(tagId),
            }
          : undefined
      }
    />
  ) : null;

  return (
    <div className="space-y-2">
      <div
        data-testid="inbox-frame"
        className="relative flex h-[calc(100dvh-7.5rem)] min-h-[30rem] overflow-hidden rounded-xl border border-border bg-background md:h-[calc(100dvh-9rem)]"
      >
        <aside
          aria-label={t('listRegion')}
          className={cn(
            'min-h-0 w-full shrink-0 border-border md:w-80 md:border-e xl:w-[22rem]',
            selectedId ? 'hidden md:block' : 'block',
          )}
        >
          <ConversationList
            list={list.state}
            filters={filters}
            onFilters={patchFilters}
            channels={filterChannels}
            channelsLoaded={channelsQ.isSuccess}
            activeId={selectedId}
            nowMs={nowMs}
            onOpen={(id) => open(id)}
            onRowPriority={can.priority ? (r, p) => void setRowPriority(r, p) : undefined}
            onLoadMore={list.loadMore}
            onRefresh={() => {
              list.refresh();
              void qc.invalidateQueries({ queryKey: KEYS.channels });
            }}
            searchRef={searchRef}
            canManageChannels={can.manageChannels}
            simulatorAvailable={simulatorAvailable}
            onOpenSimulator={() => setSimulatorOpen((v) => !v)}
            bulk={
              can.bulk
                ? {
                    selecting: bulk.selecting,
                    selection: bulk.selection,
                    onToggleSelecting: bulk.toggleSelecting,
                    onSelect: bulk.select,
                    onPick: bulk.pick,
                    bar: (
                      <BulkBar
                        count={bulk.selection.size}
                        inView={list.state.rows.length}
                        allInViewSelected={bulk.allInView}
                        busy={bulk.busy}
                        can={{
                          resolve: can.resolve,
                          assign: can.assign,
                          assignSelf: can.assignSelf,
                          priority: can.priority,
                          snooze: can.snooze,
                          tag: can.tag,
                        }}
                        meId={meId}
                        onToggleAll={bulk.toggleAll}
                        onClear={bulk.toggleSelecting}
                        onRun={bulk.run}
                      />
                    ),
                  }
                : undefined
            }
          />
        </aside>

        <main
          className={cn('min-h-0 min-w-0 flex-1 flex-col', selectedId ? 'flex' : 'hidden md:flex')}
        >
          {selectedId ? (
            <ThreadPane
              key={selectedId}
              conversationId={selectedId}
              detail={detail.detail}
              fetchedAt={detail.fetchedAt}
              detailPending={detail.isPending}
              notFound={detail.notFound}
              thread={thread}
              notes={notes}
              channel={channel}
              nowMs={nowMs}
              can={{
                reply: can.reply,
                note: can.note,
                resolve: can.resolve,
                assignSelf: can.assignSelf || can.assign,
                priority: can.priority,
                snooze: can.snooze,
              }}
              tags={
                can.tag
                  ? {
                      busy: tagging,
                      canCreate: can.tagManage,
                      onApply: (input) => void applyTag(input),
                      onWithdraw: (tagId) => void withdrawTag(tagId),
                    }
                  : undefined
              }
              triage={{
                busy: triaging,
                onPriority: (p) => void setPriority(p),
                onSnooze: (p) => void snooze(p),
                onWake: () => void wake(),
                onSpam: () => void markSpam(),
              }}
              mode={mode}
              onMode={setMode}
              composerRef={composerRef}
              aiModel={aiModel}
              panelOpen={panelOpen}
              onTogglePanel={togglePanel}
              onBack={back}
              onSeenLatest={onSeenLatest}
              onSend={onSend}
              onReact={onReact}
              onNote={addNote}
              onDeleteNote={setNoteToDelete}
              canDeleteNote={canDeleteNote}
              bottomSignal={bottomSignal}
              onToggleResolved={() => void toggleResolved()}
              onRetryMessage={retryMessage}
              resolving={resolving}
              onAssignSelf={() => void assign({ userId: meId })}
              assignMenu={{
                meId,
                canAssign: can.assign,
                busy: assigning,
                onAssign: (change) => void assign(change),
              }}
              handoff={{
                canClaim: can.assignSelf || can.assign,
                canSend: can.assign,
                canReturn: can.reply,
                onPlaced: (row) => {
                  list.placeRow(row);
                  void detail.refetch();
                },
              }}
              onRetryDetail={() => void detail.refetch()}
            />
          ) : (
            <Placeholder />
          )}
        </main>

        {selectedId && isXl && inlineOpen && panel && (
          <aside
            aria-label={t('panelRegion')}
            className="relative hidden min-h-0 w-80 shrink-0 overflow-y-auto border-s border-border xl:block thin-scrollbar"
          >
            {panel}
          </aside>
        )}
      </div>

      {!isXl && (
        <Drawer
          open={drawerOpen && selectedId !== null}
          onClose={() => setDrawerOpen(false)}
          title={t('panelRegion')}
          closeLabel={t('close')}
        >
          {panel}
        </Drawer>
      )}

      {simulatorAvailable && (
        <SimulatorDrawer
          open={simulatorOpen}
          onClose={() => setSimulatorOpen(false)}
          channels={channels ?? []}
          fault={fault}
          onFault={setFault}
        />
      )}

      <ConfirmDialog
        open={noteToDelete !== null}
        title={t('deleteNoteTitle')}
        message={t('deleteNoteMessage')}
        confirmLabel={t('deleteNoteConfirm')}
        cancelLabel={t('cancel')}
        tone="danger"
        busy={deletingNote}
        onConfirm={() => void confirmDeleteNote()}
        onClose={() => setNoteToDelete(null)}
      />
    </div>
  );
}

/** The right of the list when nothing is open (a window wide enough to show both). */
function Placeholder() {
  const t = useTranslations('team-inbox-conversations.screen');
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-muted-foreground">
      <span className="flex size-14 items-center justify-center rounded-full bg-muted">
        <InboxIcon width={26} height={26} />
      </span>
      <p className="text-base font-medium text-foreground">{t('pickTitle')}</p>
      <p className="max-w-sm text-sm">{t('pickMessage')}</p>
      <p className="text-xs">{t('shortcuts')}</p>
    </div>
  );
}
