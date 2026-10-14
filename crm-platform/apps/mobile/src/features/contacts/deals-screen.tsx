import type { DealResponse } from '@crm/contracts';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { EmptyState } from '@/components/ui/empty-state';
import { StackHeader } from '@/components/ui/stack-header';
import { Text } from '@/components/ui/text';
import { can, useSession } from '@/lib/session/use-session';
import { radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { ErrorCard } from './record-parts';
import { failureKindOf, firstParam, joinMeta } from './record-support';
import { useContactDeals } from './use-deals';

function DealRowBase({ deal }: { deal: DealResponse }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text numberOfLines={2}>{deal.title}</Text>
      <Text variant="caption" muted>
        {joinMeta([deal.stage.name, `${deal.value} ${deal.currency}`])}
      </Text>
    </View>
  );
}
const DealRow = memo(DealRowBase);

/**
 * A contact's deals (/contact-deals?contactId=…), open ones first, read only. The API answers with one list of at most 50 and
 * the open and won totals, not pages. Reading them needs `record.deals.read`; a workspace without the sales pipeline is
 * refused the same way and sees the "can't view" message.
 */
export function ContactDealsScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ contactId?: string | string[] }>();
  const contactId = firstParam(params.contactId);
  const session = useSession();
  const canRead = can(session.data, 'record.deals.read');
  const list = useContactDeals(contactId, canRead);
  const [refreshing, setRefreshing] = useState(false);

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
      title={t('contactDeals.denied.title')}
      hint={t('contactDeals.denied.hint')}
    />
  );
  const missing = <EmptyState icon="people-outline" title={t('contactDeals.contactMissing')} />;

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
  } else if (list.isError) {
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
        testID="deals-list"
        data={list.data.deals}
        keyExtractor={(deal) => deal.id}
        renderItem={({ item }) => <DealRow deal={item} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
        ListEmptyComponent={
          <EmptyState icon="cash-outline" title={t('contactDeals.empty.title')} />
        }
        contentContainerStyle={styles.listContent}
      />
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <StackHeader title={t('contactDeals.title')} onBack={back} />
      <View style={styles.fill}>{body}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  pad: { padding: spacing.lg },
  loading: { marginTop: spacing.xxl },
  listContent: { flexGrow: 1, padding: spacing.lg, gap: spacing.sm },
  row: { gap: spacing.xs, borderRadius: radius.lg, borderWidth: 1, padding: spacing.lg },
});
