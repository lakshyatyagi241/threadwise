import type { ContactMeetingResponse } from '@crm/contracts';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { Banner } from '@/components/ui/banner';
import { EmptyState } from '@/components/ui/empty-state';
import { StackHeader } from '@/components/ui/stack-header';
import { Text } from '@/components/ui/text';
import { messageForError } from '@/lib/api/error-message';
import { can, useSession } from '@/lib/session/use-session';
import { radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { formatMoment } from './contact-display';
import { ErrorCard } from './record-parts';
import { failureKindOf, firstParam, joinMeta } from './record-support';
import { useContactMeetings } from './use-meetings';

function MeetingRowBase({ meeting, locale }: { meeting: ContactMeetingResponse; locale: string }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const when = meeting.startsAt
    ? formatMoment(meeting.startsAt, locale)
    : t('contactMeetings.noDate');
  return (
    <View style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text numberOfLines={2}>{meeting.title}</Text>
      <Text variant="caption" muted>
        {joinMeta([when, meeting.location])}
      </Text>
    </View>
  );
}
const MeetingRow = memo(MeetingRowBase);

/**
 * A contact's logged meetings (/contact-meetings?contactId=…, WD-CON-007's Activities > Meetings sub-tab), newest first, read
 * only for now. Reading them needs the same permission as reading the contact: the API gates this route behind
 * `record.contacts.read`, not a permission of its own.
 */
export function ContactMeetingsScreen() {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ contactId?: string | string[] }>();
  const contactId = firstParam(params.contactId);
  const session = useSession();
  const canRead = can(session.data, 'record.contacts.read');
  const list = useContactMeetings(contactId, canRead);
  const [refreshing, setRefreshing] = useState(false);

  const meetings = useMemo(() => list.data?.pages.flatMap((page) => page.data) ?? [], [list.data]);
  const locale = i18n.language;

  const back = () => {
    if (router.canGoBack()) router.back();
    else if (contactId) router.replace({ pathname: '/contact/[id]', params: { id: contactId } });
    else router.replace('/contacts');
  };
  const refresh = async () => {
    setRefreshing(true);
    await list.refetch();
    setRefreshing(false);
  };

  const denied = (
    <EmptyState
      icon="lock-closed-outline"
      title={t('contactMeetings.denied.title')}
      hint={t('contactMeetings.denied.hint')}
    />
  );
  const missing = <EmptyState icon="people-outline" title={t('contactMeetings.contactMissing')} />;

  let body;
  if (session.data === undefined) {
    body = session.isError ? (
      <View style={styles.pad}>
        <ErrorCard error={session.error} onRetry={() => void session.refetch()} />
      </View>
    ) : (
      <ActivityIndicator accessibilityLabel={t('common.loading')} style={styles.loading} />
    );
  } else if (!canRead) {
    body = denied;
  } else if (contactId === '') {
    body = missing;
  } else if (list.isPending) {
    body = <ActivityIndicator accessibilityLabel={t('common.loading')} style={styles.loading} />;
  } else if (list.isError && meetings.length === 0) {
    const kind = failureKindOf(list.error);
    body =
      kind === 'missing' ? (
        missing
      ) : kind === 'denied' ? (
        denied
      ) : (
        <View style={styles.pad}>
          <ErrorCard error={list.error} onRetry={() => void list.refetch()} />
        </View>
      );
  } else {
    body = (
      <FlatList
        testID="meetings-list"
        data={meetings}
        keyExtractor={(meeting) => meeting.id}
        renderItem={({ item }) => <MeetingRow meeting={item} locale={locale} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
        }}
        ListHeaderComponent={
          list.isError && meetings.length > 0 ? (
            <Banner tone="danger" message={messageForError(list.error, t)} />
          ) : null
        }
        ListEmptyComponent={
          <EmptyState icon="calendar-outline" title={t('contactMeetings.empty.title')} />
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
      <StackHeader title={t('contactMeetings.title')} onBack={back} />
      <View style={styles.fill}>{body}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  pad: { padding: spacing.lg },
  loading: { marginTop: spacing.xxl },
  footer: { paddingVertical: spacing.lg },
  listContent: { flexGrow: 1, padding: spacing.lg, gap: spacing.sm },
  row: {
    gap: spacing.xs,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
  },
});
