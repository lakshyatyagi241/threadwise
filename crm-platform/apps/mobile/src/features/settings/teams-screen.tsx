import type { WspTeam } from '@crm/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { StackHeader } from '@/components/ui/stack-header';
import { Text } from '@/components/ui/text';
import { messageForError } from '@/lib/api/error-message';
import { spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { TeamCard } from './team-card';
import { useMembersSummary, membersKey } from './use-members';
import { useTeamList } from './use-teams';

/**
 * Settings, Teams (TW-WSP-022): the groups of agents the inbox routes conversations to, each with its colour, how it assigns and who is in
 * it. Every member may read the list; creating and editing show only to a person who may manage teams (the summary's `canManageTeams`),
 * and the server stays the authority. Creating and editing is a screen of its own.
 */
export function TeamsScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const summaryQuery = useMembersSummary();
  const list = useTeamList();
  const [refreshing, setRefreshing] = useState(false);

  const canManage = summaryQuery.data?.me.canManageTeams ?? false;
  const rows = useMemo(() => list.data?.pages.flatMap((p) => p.data) ?? [], [list.data]);
  // The access summary fails fast while the list retries: whichever fails is shown.
  const failed = summaryQuery.isError ? summaryQuery.error : list.isError ? list.error : null;
  const loading = summaryQuery.isPending || list.isPending;

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/menu'));
  const edit = (team: WspTeam) =>
    router.push({ pathname: '/team-form', params: { teamId: team.id } });
  const create = () => router.push('/team-form');

  const refresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: membersKey });
    setRefreshing(false);
  };

  let body;
  if (loading && rows.length === 0) {
    body = (
      <ActivityIndicator accessibilityLabel={t('settings.teams.loading')} style={styles.loading} />
    );
  } else if (failed !== null) {
    body = (
      <View style={styles.pad}>
        <Card>
          <Text danger accessibilityRole="alert">
            {messageForError(failed, t)}
          </Text>
          <Button
            variant="secondary"
            label={t('common.retry')}
            onPress={() => {
              void summaryQuery.refetch();
              void list.refetch();
            }}
          />
        </Card>
      </View>
    );
  } else {
    body = (
      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <TeamCard team={item} canEdit={canManage} onEdit={edit} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
        }}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text muted>{t('settings.teams.subtitle')}</Text>
            {canManage ? (
              <Button label={t('settings.teams.create')} testID="team-create" onPress={create} />
            ) : null}
            <Card>
              <Text variant="label" accessibilityRole="header">
                {t('settings.teams.howTitle')}
              </Text>
              <Text muted>{`1. ${t('settings.teams.how.one')}`}</Text>
              <Text muted>{`2. ${t('settings.teams.how.two')}`}</Text>
              <Text muted>{`3. ${t('settings.teams.how.three')}`}</Text>
            </Card>
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon="people-circle-outline"
            title={t('settings.teams.emptyTitle')}
            hint={t('settings.teams.emptyMessage')}
          />
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
      <StackHeader title={t('settings.teams.title')} onBack={goBack} />
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  loading: { marginTop: spacing.xl },
  pad: { padding: spacing.lg },
  header: { gap: spacing.md, padding: spacing.lg },
  footer: { paddingVertical: spacing.lg },
  listContent: { flexGrow: 1, paddingBottom: spacing.xxl },
});
