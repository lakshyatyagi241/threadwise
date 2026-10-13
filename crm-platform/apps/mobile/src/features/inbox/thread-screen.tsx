import {
  canMoveConversationStatus,
  ERROR_CODES,
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
import { BotBar } from './bot-bar';
import { Composer } from './composer';
import { LabelsSheet } from './labels-sheet';
import { Bubble, MessageBubble } from './message-bubble';
import { isBotConversation, menuActionsFor, type MenuAction } from './thread-actions';
import { sendErrorMessage } from './thread-errors';
import { ThreadHeader } from './thread-header';
import type { ThreadMenuItem } from './thread-menu';
import { flattenMessages, REFUSED_SEND_CODES, type PendingMessage } from './thread-model';
import { useNow } from './use-now';
import {
  useAssign,
  useConversationDetail,
  useMarkRead,
  useRetryMessage,
  useSendMessage,
  useSetStatus,
  useThreadMessages,
} from './use-inbox';

type Row =
  | { kind: 'pending'; pending: PendingMessage }
  | { kind: 'message'; message: ReturnType<typeof flattenMessages>[number] };

/** The status a header button moves the thread to: finish a live thread, reopen a finished one. */
const nextStatus = (from: ConversationStatus): 'resolved' | 'open' =>
  from === 'resolved' || from === 'closed' || from === 'spam' ? 'open' : 'resolved';

/**
 * One conversation (route /conversation/[id]): the header (who, which channel, the reply-window timer, resolve or reopen, and the
 * three dots), the labels button, the messages, and a box to answer. While an AI agent has the conversation the box is replaced by
 * a bar that offers to take it over. Opening the thread marks it read. While the screen is in front it asks for news every 15
 * seconds (realtime replaces that later).
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

  const detail = useConversationDetail(id, focused, canRead);
  const thread = useThreadMessages(id, focused, canRead);
  const send = useSendMessage(id);
  const retry = useRetryMessage(id);
  const setStatus = useSetStatus(id);
  const assign = useAssign(id);
  const markRead = useMarkRead(id);

  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [labelsOpen, setLabelsOpen] = useState(false);

  const messages = useMemo(() => flattenMessages(thread.data), [thread.data]);
  const lastSeq = messages.at(-1)?.seq ?? 0;
  const conversation = detail.data;
  const labelNames = (conversation?.labels ?? []).map((label) => label.name).join(', ');

  // Newest first, because the list is inverted (it opens at the newest message). A bubble we sent stays pending until the stored one is in the list.
  const rows = useMemo<Row[]>(() => {
    const stored = new Set(messages.map((m) => m.clientMessageId).filter(Boolean));
    const waiting = pending.filter((p) => !stored.has(p.clientMessageId));
    return [
      ...waiting.map((p): Row => ({ kind: 'pending', pending: p })).reverse(),
      ...messages.map((m): Row => ({ kind: 'message', message: m })).reverse(),
    ];
  }, [messages, pending]);

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

  const resendPending = (item: PendingMessage) => {
    setNotice(null);
    setPending((list) =>
      list.map((p) =>
        p.clientMessageId === item.clientMessageId ? { ...p, state: 'sending' } : p,
      ),
    );
    void attempt(item.clientMessageId, item.body);
  };

  /** Runs a change to the conversation; the hook reads it again either way, so the next press carries the current row version. */
  const change = async (action: () => Promise<unknown>) => {
    setNotice(null);
    try {
      await action();
    } catch (error) {
      setNotice(
        isApiError(error) && error.code === ERROR_CODES.ROW_VERSION_CONFLICT
          ? t('inbox.thread.conflict')
          : sendErrorMessage(error, t),
      );
    }
  };
  const moveTo = (status: SetConversationStatusInput['status']) => {
    if (conversation) {
      void change(() => setStatus.mutateAsync({ rowVersion: conversation.rowVersion, status }));
    }
  };
  const assignTo = (userId: string | null) => {
    if (conversation) {
      void change(() => assign.mutateAsync({ rowVersion: conversation.rowVersion, userId }));
    }
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

  const MENU_ITEM: Record<
    MenuAction,
    Omit<ThreadMenuItem, 'key' | 'onPress'> & { run: () => void }
  > = {
    assignToMe: {
      label: t('inbox.thread.menu.assignToMe'),
      icon: 'person-add-outline',
      run: () => assignTo(meId),
    },
    unassign: {
      label: t('inbox.thread.menu.unassign'),
      icon: 'person-remove-outline',
      run: () => assignTo(null),
    },
    pending: {
      label: t('inbox.thread.menu.pending'),
      icon: 'time-outline',
      run: () => moveTo('pending'),
    },
    close: {
      label: t('inbox.thread.menu.closeConversation'),
      icon: 'lock-closed-outline',
      run: () => moveTo('closed'),
    },
  };
  const menuItems: ThreadMenuItem[] = conversation
    ? menuActionsFor({
        status: conversation.status,
        assignment: conversation.assignment,
        meId,
        canAssign,
        canAssignSelf,
        canResolve,
      }).map((action) => ({
        key: action,
        label: MENU_ITEM[action].label,
        icon: MENU_ITEM[action].icon,
        onPress: MENU_ITEM[action].run,
      }))
    : [];

  const header = (
    <ThreadHeader
      conversation={conversation}
      now={now}
      onBack={() => router.back()}
      primary={
        showStatusAction && target
          ? {
              icon: target === 'resolved' ? 'checkmark-circle-outline' : 'refresh-outline',
              label: target === 'resolved' ? t('inbox.thread.resolve') : t('inbox.thread.reopen'),
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
    return (
      <FlatList
        testID="thread-list"
        inverted
        accessibilityLabel={t('inbox.thread.messages')}
        data={rows}
        keyExtractor={(row) =>
          row.kind === 'pending' ? row.pending.clientMessageId : row.message.id
        }
        renderItem={({ item }) =>
          item.kind === 'pending' ? (
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
        ListEmptyComponent={
          // An inverted list draws its empty state upside down; turn it back.
          <View style={styles.flip}>
            <EmptyState
              icon="chatbubbles-outline"
              title={t('inbox.thread.emptyTitle')}
              hint={t('inbox.thread.emptyHint')}
            />
          </View>
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
      {windowClosed && canReply ? (
        <View style={styles.pad}>
          <Banner tone="warning" message={t('inbox.thread.windowClosed')} />
        </View>
      ) : null}
      {notice && !(windowClosed && notice === t('inbox.thread.windowClosed')) ? (
        <View style={styles.pad}>
          <Banner tone="danger" message={notice} />
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
      {canRead && conversation ? (
        isBotConversation(conversation.assignment) ? (
          <BotBar
            canAssign={canAssign || canAssignSelf}
            assigning={assign.isPending}
            onAssign={() => assignTo(meId)}
          />
        ) : canReply ? (
          <Composer value={draft} onChange={setDraft} onSend={onSend} closed={windowClosed} />
        ) : null
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
  flip: { transform: [{ scaleY: -1 }] },
});
