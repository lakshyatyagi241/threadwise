import {
  canMoveConversationStatus,
  channelKindSchema,
  type ConversationStatus,
  type SetConversationStatusInput,
} from '@crm/contracts';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { isApiError } from '@/lib/api';
import { can, useSession } from '@/lib/session/use-session';
import { spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { AssignmentStrip } from './assignment-strip';
import { AssignSheet } from './assign-sheet';
import { AttachMenu } from './attach-menu';
import { AttachPreviewSheet } from './attach-preview-sheet';
import { formatBytes } from './message-parts';
import { ATTACHMENT_MAX_BYTES } from './attachment';
import { BotBar } from './bot-bar';
import { ChoiceSheet } from './choice-sheet';
import { Composer } from './composer';
import { LabelsSheet } from './labels-sheet';
import { TemplateBar } from './template-bar';
import { Bubble, MessageBubble } from './message-bubble';
import { NoteBubble } from './note-bubble';
import { SavedRepliesSheet } from './saved-replies-sheet';
import {
  isBotConversation,
  menuActionsFor,
  STATUS_TARGETS,
  type MenuAction,
} from './thread-actions';
import { sendErrorMessage } from './thread-errors';
import { ThreadHeader } from './thread-header';
import type { ThreadMenuItem } from './thread-menu';
import {
  flattenMessages,
  mergeThread,
  REFUSED_SEND_CODES,
  type PendingMessage,
  type ThreadItem,
} from './thread-model';
import { useAttachFlow } from './use-attach-flow';
import { useConversationActions } from './use-conversation-actions';
import { useThreadLive } from './use-live';
import { useNotes, useChangeNotes } from './use-notes';
import { useNow } from './use-now';
import {
  useConversationDetail,
  useMarkRead,
  useRetryMessage,
  useSendMessage,
  useThreadMessages,
} from './use-inbox';

type Row = { kind: 'pending'; pending: PendingMessage } | ThreadItem;

/** The status a header button moves the thread to: finish a live thread, reopen a finished one. */
const nextStatus = (from: ConversationStatus): 'resolved' | 'open' =>
  from === 'resolved' || from === 'closed' || from === 'spam' ? 'open' : 'resolved';

/**
 * One conversation (route /conversation/[id]): the header (who, which channel, the reply-window timer, resolve or reopen, and the
 * three dots), the labels button, the messages, and a box to answer. While an AI agent has the conversation the box is replaced by
 * a bar that offers to take it over. Opening the thread marks it read. While the screen is in front it asks for news every 15
 * seconds (only while the live connection is not up: with it, events say when to read again).
 */
export function ThreadScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = (Array.isArray(params.id) ? params.id[0] : params.id) ?? '';

  const session = useSession();
  const canRead = can(session.data, 'inbox.conversation.read');
  const canReply = can(session.data, 'inbox.conversation.reply');
  const canResolve = can(session.data, 'inbox.conversation.resolve');
  const canAssign = can(session.data, 'inbox.conversation.assign');
  const canAssignSelf = can(session.data, 'inbox.conversation.assign_self');
  const canNote = can(session.data, 'inbox.conversation.note');
  // Labels are on the conversation. Making a new one (by typing its name) is a separate permission.
  const canLabel = can(session.data, 'inbox.conversation.tag');
  const canMakeLabels = can(session.data, 'inbox.tag.manage');
  const meId = session.data?.user.id ?? '';
  const now = useNow(30_000);

  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  const live = useThreadLive(id, canRead);
  const polling = focused && !live;
  const detail = useConversationDetail(id, polling, canRead);
  const thread = useThreadMessages(id, polling, canRead);
  const send = useSendMessage(id);
  const retry = useRetryMessage(id);
  const markRead = useMarkRead(id);
  const notes = useNotes(id, canRead, polling);
  const changeNotes = useChangeNotes(id);

  const [draft, setDraft] = useState('');
  // A message goes to the customer; a note stays in the team. Each keeps its own draft, so switching loses nothing.
  const [mode, setMode] = useState<'reply' | 'note'>('reply');
  const [noteDraft, setNoteDraft] = useState('');
  const [repliesOpen, setRepliesOpen] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const attach = useAttachFlow();
  // Which of the "pick one, then Save" sheets is open, and why its last save failed.
  const [sheet, setSheet] = useState<'agent' | 'status' | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);

  const messages = useMemo(() => flattenMessages(thread.data), [thread.data]);
  const lastSeq = messages.at(-1)?.seq ?? 0;
  const conversation = detail.data;
  const actions = useConversationActions(id, conversation);
  const labelNames = (conversation?.labels ?? []).map((label) => label.name).join(', ');

  // Newest first, because the list is inverted (it opens at the newest message). A bubble we sent stays pending until the stored one is in the list.
  const rows = useMemo<Row[]>(() => {
    const stored = new Set(messages.map((m) => m.clientMessageId).filter(Boolean));
    const waiting = pending.filter((p) => !stored.has(p.clientMessageId));
    return [
      ...waiting.map((p): Row => ({ kind: 'pending', pending: p })).reverse(),
      ...mergeThread(messages, notes.data?.data ?? []).reverse(),
    ];
  }, [messages, notes.data, pending]);

  // Mark read once per newest message, only when the API says something is unread.
  const markedSeq = useRef(0);
  const unread = conversation?.unreadCount ?? 0;
  const { mutate: markUpTo } = markRead;
  useEffect(() => {
    if (!canRead || unread === 0 || lastSeq === 0 || lastSeq <= markedSeq.current) return;
    markedSeq.current = lastSeq;
    markUpTo(lastSeq, {
      onError: () => {
        markedSeq.current = 0;
      },
    });
  }, [canRead, unread, lastSeq, markUpTo]);

  const attempt = async (clientMessageId: string, body: string) => {
    try {
      await send.mutateAsync({ clientMessageId, body });
      setPending((list) => list.filter((p) => p.clientMessageId !== clientMessageId));
    } catch (error) {
      setNotice(sendErrorMessage(error, t));
      if (isApiError(error) && REFUSED_SEND_CODES.has(error.code)) {
        // The server will not take this text as it is: the draft goes back in the box instead of waiting for a retry.
        setPending((list) => list.filter((p) => p.clientMessageId !== clientMessageId));
        setDraft((current) => (current === '' ? body : current));
      } else {
        setPending((list) =>
          list.map((p) => (p.clientMessageId === clientMessageId ? { ...p, state: 'failed' } : p)),
        );
      }
    }
  };

  const onSend = () => {
    const body = draft.trim();
    if (!body) return;
    const clientMessageId = Crypto.randomUUID();
    setDraft('');
    setNotice(null);
    setPending((list) => [...list, { clientMessageId, body, state: 'sending' }]);
    void attempt(clientMessageId, body);
  };

  const onSendNote = () => {
    const body = noteDraft.trim();
    if (!body) return;
    setNotice(null);
    changeNotes.add.mutate(body, {
      onSuccess: () => setNoteDraft(''),
      onError: () => setNotice(t('inbox.details.notes.failed')),
    });
  };

  /** A saved reply goes into the box on a new line after what is there; the person reads it and sends it. */
  const insertReply = (text: string, unfilled: string[]) => {
    setDraft((current) =>
      current.trim() === '' ? text : `${current.replace(/\s+$/, '')}\n${text}`,
    );
    setWarning(
      unfilled.length > 0 ? t('inbox.replies.unfilled', { list: unfilled.join(', ') }) : null,
    );
  };

  const resendPending = (item: PendingMessage) => {
    setNotice(null);
    setPending((list) =>
      list.map((p) =>
        p.clientMessageId === item.clientMessageId ? { ...p, state: 'sending' } : p,
      ),
    );
    void attempt(item.clientMessageId, item.body);
  };

  /** A change from a menu line or a button: the sentence of a failure goes in the banner (the lists read again either way). */
  const report = (change: Promise<string | null>) => {
    setNotice(null);
    void change.then((failed) => setNotice(failed));
  };
  const moveTo = (status: SetConversationStatusInput['status']) => report(actions.moveTo(status));
  const assignTo = (userId: string | null) => report(actions.assignTo({ userId }));
  /** A change from a sheet: the sheet closes when it worked, and stays open with the sentence when it did not. */
  const saveFromSheet = async (change: Promise<string | null>) => {
    const failed = await change;
    setSheetError(failed);
    if (!failed) setSheet(null);
  };
  const openSheet = (which: 'agent' | 'status') => {
    setSheetError(null);
    setSheet(which);
  };

  const target = conversation ? nextStatus(conversation.status) : null;
  const showStatusAction =
    canResolve &&
    conversation !== undefined &&
    target !== null &&
    canMoveConversationStatus(conversation.status, target);
  const windowClosed = conversation !== undefined && !conversation.window.open;
  const loadOlder = () => {
    if (thread.hasNextPage && !thread.isFetchingNextPage) void thread.fetchNextPage();
  };

  const openDetails = () => router.push({ pathname: '/conversation-details', params: { id } });
  /** Sending a template takes three pages (choose, set variables, preview), not a sheet over the thread. */
  const openTemplates = () => router.navigate({ pathname: '/template-picker', params: { id } });
  const MENU_ITEM: Record<MenuAction, Omit<ThreadMenuItem, 'key'>> = {
    details: {
      label: t('inbox.thread.menu.details'),
      icon: 'information-circle-outline',
      onPress: openDetails,
    },
    status: {
      label: t('inbox.thread.menu.status'),
      icon: 'swap-horizontal-outline',
      onPress: () => openSheet('status'),
    },
    labels: {
      label: t('inbox.thread.labels.open'),
      icon: 'pricetag-outline',
      onPress: () => setLabelsOpen(true),
    },
    agent: {
      label: t('inbox.thread.menu.agent'),
      icon: 'people-outline',
      onPress: () => openSheet('agent'),
    },
    spam: {
      label: t('inbox.thread.menu.spam'),
      icon: 'ban-outline',
      onPress: () => report(actions.markSpam()),
    },
  };
  const menuItems: ThreadMenuItem[] = conversation
    ? menuActionsFor({
        status: conversation.status,
        canResolve,
        canLabel,
        canAssign,
      }).map((action): ThreadMenuItem => ({ key: action, ...MENU_ITEM[action] }))
    : [];

  const header = (
    <ThreadHeader
      conversation={conversation}
      now={now}
      onBack={() => router.back()}
      onOpenDetails={openDetails}
      primary={
        showStatusAction && target
          ? {
              icon: target === 'resolved' ? 'checkmark-circle-outline' : 'refresh-outline',
              label:
                target === 'resolved'
                  ? t('inbox.thread.resolve')
                  : t(
                      conversation?.status === 'spam'
                        ? 'inbox.thread.notSpam'
                        : 'inbox.thread.reopen',
                    ),
              onPress: () => moveTo(target),
            }
          : null
      }
      menu={menuItems}
    />
  );

  const body = () => {
    if (session.isPending) return <ActivityIndicator accessibilityLabel={t('common.loading')} />;
    if (!canRead) {
      return (
        <View style={styles.pad}>
          <Card>
            <Text variant="subheading" accessibilityRole="header">
              {t('inbox.thread.noAccessTitle')}
            </Text>
            <Text muted>{t('inbox.thread.noAccessBody')}</Text>
          </Card>
        </View>
      );
    }
    const failure = detail.error ?? (thread.data ? null : thread.error);
    if (failure && (!conversation || !thread.data)) {
      return (
        <View style={styles.pad}>
          <Card>
            <Text danger accessibilityRole="alert">
              {sendErrorMessage(failure, t)}
            </Text>
            <Button
              variant="secondary"
              label={t('common.retry')}
              onPress={() => {
                void detail.refetch();
                void thread.refetch();
              }}
            />
          </Card>
        </View>
      );
    }
    if (thread.isPending) {
      return <ActivityIndicator accessibilityLabel={t('common.loading')} style={styles.pad} />;
    }
    // Not the list's own empty slot: an inverted list is drawn upside down and its flip of that slot differs per platform (on Android the
    // text came out upside down), so an empty conversation is drawn as a plain view.
    if (rows.length === 0) {
      return (
        <View style={styles.empty}>
          <EmptyState
            icon="chatbubbles-outline"
            title={t('inbox.thread.emptyTitle')}
            hint={t('inbox.thread.emptyHint')}
          />
        </View>
      );
    }
    return (
      <FlatList
        testID="thread-list"
        inverted
        accessibilityLabel={t('inbox.thread.messages')}
        data={rows}
        keyExtractor={(row) =>
          row.kind === 'pending'
            ? row.pending.clientMessageId
            : row.kind === 'note'
              ? `note-${row.note.id}`
              : row.message.id
        }
        renderItem={({ item }) =>
          item.kind === 'note' ? (
            <NoteBubble note={item.note} />
          ) : item.kind === 'pending' ? (
            <Bubble
              testID={`pending-${item.pending.clientMessageId}`}
              direction="out"
              text={item.pending.body}
              status={item.pending.state === 'failed' ? 'failed' : 'queued'}
              at={null}
              onRetry={() => resendPending(item.pending)}
            />
          ) : (
            <MessageBubble
              message={item.message}
              onRetry={
                canReply
                  ? (m) =>
                      void retry
                        .mutateAsync(m.id)
                        .catch((e: unknown) => setNotice(sendErrorMessage(e, t)))
                  : undefined
              }
            />
          )
        }
        onEndReached={loadOlder}
        onEndReachedThreshold={0.5}
        contentContainerStyle={styles.messages}
        ListFooterComponent={
          thread.isFetchingNextPage ? (
            <ActivityIndicator
              accessibilityLabel={t('inbox.thread.loadingOlder')}
              style={styles.pad}
            />
          ) : null
        }
      />
    );
  };

  return (
    <KeyboardAvoidingView
      behavior="padding"
      style={[styles.screen, { backgroundColor: colors.background }]}
    >
      {header}
      {notice && !(windowClosed && notice === t('inbox.thread.windowClosed')) ? (
        <View style={styles.pad}>
          <Banner tone="danger" message={notice} />
        </View>
      ) : null}
      {attach.notice ? (
        <View style={styles.pad}>
          <Banner
            tone="danger"
            message={
              attach.notice.kind === 'tooLarge'
                ? t('inbox.attach.tooLarge', {
                    limit: formatBytes(ATTACHMENT_MAX_BYTES[attach.notice.attachment.kind]),
                  })
                : t(`inbox.attach.notice.${attach.notice.kind}`)
            }
          />
          {attach.notice.kind === 'cameraOff' ? (
            <Button
              variant="link"
              align="start"
              label={t('inbox.attach.openSettings')}
              onPress={attach.openSettings}
            />
          ) : null}
        </View>
      ) : null}
      {warning ? (
        <View style={styles.pad}>
          <Banner tone="warning" message={warning} />
        </View>
      ) : null}
      {canLabel && conversation ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('inbox.thread.labels.open')}
          accessibilityValue={{ text: labelNames || undefined }}
          onPress={() => setLabelsOpen(true)}
          style={[
            styles.strip,
            { backgroundColor: colors.surface, borderBottomColor: colors.border },
          ]}
        >
          <Icon name="pricetag-outline" size={20} color="primary" />
          <Text variant="label">{t('inbox.thread.labels.open')}</Text>
          {labelNames ? (
            <Text variant="caption" muted numberOfLines={1} style={styles.labelNames}>
              {labelNames}
            </Text>
          ) : null}
        </Pressable>
      ) : null}
      <View style={styles.screen}>{body()}</View>
      {canRead && conversation && !isBotConversation(conversation.assignment) ? (
        <AssignmentStrip
          assignment={conversation.assignment}
          meId={meId}
          canClaim={canAssign || canAssignSelf}
          assigning={actions.assigning}
          onAssignToMe={() => assignTo(meId)}
        />
      ) : null}
      {canRead && conversation ? (
        canNote && (mode === 'note' || !canReply) ? (
          <Composer
            mode="note"
            value={noteDraft}
            onChange={setNoteDraft}
            onSend={onSendNote}
            busy={changeNotes.add.isPending}
            onToggleNote={canReply ? () => setMode('reply') : undefined}
          />
        ) : isBotConversation(conversation.assignment) ? (
          <BotBar
            canAssign={canAssign || canAssignSelf}
            assigning={actions.assigning}
            onAssign={() => assignTo(meId)}
          />
        ) : canReply ? (
          windowClosed ? (
            <TemplateBar onOpen={openTemplates} />
          ) : (
            <Composer
              value={draft}
              onChange={setDraft}
              onSend={onSend}
              onOpenReplies={() => setRepliesOpen(true)}
              onOpenAttach={attach.open}
              onOpenTemplates={openTemplates}
              onToggleNote={canNote ? () => setMode('note') : undefined}
            />
          )
        ) : null
      ) : null}
      {conversation && canReply ? (
        <SavedRepliesSheet
          visible={repliesOpen}
          conversationId={conversation.id}
          // A kind the app does not know is left out of the question, so the list is not refused.
          channelKind={channelKindSchema.safeParse(conversation.channel.kind).data}
          onInsert={insertReply}
          onClose={() => setRepliesOpen(false)}
        />
      ) : null}
      {conversation && canReply ? (
        <AttachMenu
          visible={attach.menuOpen}
          onChoose={attach.choose}
          onClose={attach.closeMenu}
          onDismiss={attach.onMenuDismissed}
        />
      ) : null}
      {conversation && canReply ? (
        <AttachPreviewSheet
          file={attach.file}
          conversationId={conversation.id}
          onClose={attach.closeFile}
        />
      ) : null}
      {conversation && canAssign ? (
        <AssignSheet
          visible={sheet === 'agent'}
          assignment={conversation.assignment}
          saving={actions.assigning}
          error={sheetError}
          onSave={(change) => void saveFromSheet(actions.assignTo(change))}
          onClose={() => setSheet(null)}
        />
      ) : null}
      {conversation && canResolve ? (
        <ChoiceSheet
          visible={sheet === 'status'}
          title={t('inbox.statusSheet.title')}
          groups={[
            {
              key: 'status',
              options: STATUS_TARGETS.filter((to) =>
                canMoveConversationStatus(conversation.status, to),
              ).map((to) => ({ value: to, label: t(`inbox.status.${to}`) })),
            },
          ]}
          initial={{ status: conversation.status }}
          saving={actions.busy}
          error={sheetError}
          onSave={(picked) =>
            void saveFromSheet(
              actions.moveTo(picked.status as SetConversationStatusInput['status']),
            )
          }
          onClose={() => setSheet(null)}
        />
      ) : null}
      {conversation ? (
        <LabelsSheet
          visible={labelsOpen}
          conversationId={conversation.id}
          applied={conversation.labels}
          canCreate={canMakeLabels}
          onClose={() => setLabelsOpen(false)}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  pad: { padding: spacing.sm },
  strip: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  labelNames: { flexShrink: 1 },
  messages: { paddingVertical: spacing.sm },
  empty: { flex: 1, justifyContent: 'center' },
});
