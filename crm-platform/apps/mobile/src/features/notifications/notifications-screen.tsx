import type { NotificationResponse } from '@crm/contracts';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, RefreshControl, SectionList, StyleSheet, View } from 'react-native';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { HeaderIconButton } from '@/components/ui/screen-header';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { StackHeader } from '@/components/ui/stack-header';
import { Text } from '@/components/ui/text';
import { messageForError } from '@/lib/api/error-message';
import { spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { groupByDay, notificationTarget } from './notification-model';
import { NotificationRow } from './notification-row';
import { NotificationSkeleton } from './notification-skeleton';
import { translatorFor } from './notification-text';
import { useDismiss, useMarkAllRead, useMarkRead, useNotificationList } from './use-notifications';

type View_ = 'all' | 'unread';

/**
 * The person's own notifications (the web bell and its Notifications page): newest first in day sections, a page at a time, All or
 * Unread. Opening a row marks it read and goes to what it is about (a chat, a task, a contact); the cross dismisses it; the header's
 * tick marks everything read. Every signed-in person has their own feed, so there is no permission gate.
 */
export function NotificationsScreen() {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const [view, setView] = useState<View_>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const list = useNotificationList(view === 'unread');
  const rows = useMemo(() => list.data?.pages.flatMap((page) => page.data) ?? [], [list.data]);
  const sections = useMemo(() => groupByDay(rows, new Date()), [rows]);
  const unread = list.data?.pages[0]?.meta.unread ?? 0;

  const markRead = useMarkRead();
  const markAll = useMarkAllRead();
  const dismiss = useDismiss();
  const readRow = markRead.mutate;
  const dismissRow = dismiss.mutate;
  const dismissingId = dismiss.isPending ? dismiss.variables : undefined;

  // The words are chosen from the message files by the type. Rows re-render on a language change (useTranslation), so they read the new language.
  const translate = useMemo(() => translatorFor(i18n), [i18n]);

  const open = useCallback(
    (row: NotificationResponse) => {
      setNotice(null);
      if (row.readAt === null) {
        readRow(row.id, { onError: (error) => setNotice(messageForError(error, t)) });
      }
      const target = notificationTarget(row);
      if (target) router.push(target);
    },
    [readRow, router, t],
  );
  const remove = useCallback(
    (row: NotificationResponse) => {
      setNotice(null);
      dismissRow(row.id, { onError: (error) => setNotice(messageForError(error, t)) });
    },
    [dismissRow, t],
  );
  const readAll = () => {
    setNotice(null);
    markAll.mutate(undefined, { onError: (error) => setNotice(messageForError(error, t)) });
  };

  const refresh = async () => {
    setRefreshing(true);
    await list.refetch();
    setRefreshing(false);
  };
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/menu'));

  let body;
  if (list.isPending) {
    body = <NotificationSkeleton />;
  } else if (list.isError && rows.length === 0) {
    body = (
      <View style={styles.error}>
        <Card>
          <Text danger accessibilityRole="alert">
            {messageForError(list.error, t)}
          </Text>
          <Button
            variant="secondary"
            label={t('common.retry')}
            onPress={() => void list.refetch()}
          />
        </Card>
      </View>
    );
  } else {
    body = (
      <SectionList
        testID="notifications-list"
        sections={sections}
        extraData={dismissingId}
        keyExtractor={(row) => row.id}
        stickySectionHeadersEnabled={false}
        initialNumToRender={15}
        renderSectionHeader={({ section }) => (
          <View style={[styles.sectionBand, { backgroundColor: colors.background }]}>
            <Text variant="label" muted accessibilityRole="header">
              {t(`notifications.sections.${section.section}`)}
            </Text>
          </View>
        )}
        renderItem={({ item, section }) => (
          <NotificationRow
            row={item}
            section={section.section}
            translate={translate}
            busy={dismissingId === item.id}
            onOpen={open}
            onDismiss={remove}
          />
        )}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
        }}
        ListEmptyComponent={
          view === 'unread' ? (
            <EmptyState
              icon="notifications-off-outline"
              title={t('notifications.emptyFiltered')}
              hint={t('notifications.emptyFilteredHint')}
            />
          ) : (
            <EmptyState
              icon="notifications-outline"
              title={t('notifications.empty')}
              hint={t('notifications.emptyHint')}
            />
          )
        }
        ListFooterComponent={
          list.isFetchingNextPage ? (
            <ActivityIndicator accessibilityLabel={t('common.loading')} style={styles.footer} />
          ) : null
        }
        contentContainerStyle={styles.listContent}
      />
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <StackHeader
        title={t('notifications.title')}
        onBack={goBack}
        actions={
          unread > 0 ? (
            <HeaderIconButton
              icon="checkmark-done-outline"
              label={t('notifications.markAll')}
              onPress={readAll}
              testID="notifications-mark-all"
            />
          ) : null
        }
      />
      <View style={styles.filter}>
        <SegmentedControl
          label={t('notifications.filter.label')}
          value={view}
          onChange={setView}
          options={[
            { value: 'all', label: t('notifications.filter.all') },
            { value: 'unread', label: t('notifications.filter.unread') },
          ]}
        />
      </View>
      {notice ? (
        <View style={styles.notice}>
          <Banner tone="warning" message={notice} />
        </View>
      ) : null}
      <View style={styles.fill}>{body}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  filter: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  notice: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  error: { padding: spacing.lg },
  footer: { paddingVertical: spacing.lg },
  sectionBand: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  listContent: { flexGrow: 1 },
});
