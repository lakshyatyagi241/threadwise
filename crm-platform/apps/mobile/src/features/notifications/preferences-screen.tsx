import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { StackHeader } from '@/components/ui/stack-header';
import { Text } from '@/components/ui/text';
import { radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { PreferenceRow } from './preference-row';
import { customCount, groupRows, preferencesKey, type PrefChannel } from './preferences-model';
import { usePreferenceActions, usePreferences, usePushDeployment } from './use-preferences';

/**
 * Account, Notifications (the web's notification preferences): for each kind of notification, whether it reaches the bell, pops up, plays
 * a sound and (where the deployment sends browser notifications) reaches the person's devices. The choices are the person's own: the
 * workspace only sets which events start out on. The server's answer is the effective value (their choice, else the workspace's toggle,
 * else the default); a change shows at once and is undone with a message when saving fails. The web's per-browser alert switches have no
 * counterpart on a phone.
 */
export function PreferencesScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const query = usePreferences();
  const actions = usePreferenceActions();
  const push = usePushDeployment();
  const [allReset, setAllReset] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const state = query.data;
  const groups = useMemo(() => (state ? groupRows(state.entries) : []), [state]);
  const changed = state ? customCount(state) : 0;
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/menu'));

  const change = (type: string, channel: PrefChannel, value: boolean) => {
    setAllReset(false);
    actions.change(type, channel, value);
  };
  const reset = (type: string) => {
    setAllReset(false);
    actions.reset(type);
  };
  const resetEverything = () => {
    actions.resetEverything();
    setAllReset(true);
  };
  const refresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: preferencesKey });
    setRefreshing(false);
  };

  let body;
  if (query.isPending) {
    body = (
      <ActivityIndicator
        accessibilityLabel={t('notificationPrefs.loading')}
        style={styles.loading}
      />
    );
  } else if (query.isError || !state) {
    body = (
      <View style={styles.pad}>
        <Card>
          <Text danger accessibilityRole="alert">
            {t('notificationPrefs.failed')}
          </Text>
          <Button
            variant="secondary"
            label={t('common.retry')}
            onPress={() => void query.refetch()}
          />
        </Card>
      </View>
    );
  } else {
    body = (
      <FlatList
        data={groups}
        keyExtractor={(group) => group.group}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text muted>{t('notificationPrefs.description')}</Text>
            {actions.failed ? (
              <View style={styles.failed}>
                <Banner tone="danger" message={t('notificationPrefs.saveFailed')} />
                <Button
                  variant="secondary"
                  label={t('notificationPrefs.dismiss')}
                  onPress={actions.clearFailed}
                />
              </View>
            ) : null}
            {allReset && !actions.failed ? (
              <Banner tone="info" message={t('notificationPrefs.resetAllDone')} />
            ) : null}
            {groups.length > 0 ? (
              <Button
                variant="secondary"
                label={t('notificationPrefs.resetAll')}
                testID="pref-reset-all"
                disabled={changed === 0}
                onPress={resetEverything}
              />
            ) : null}
          </View>
        }
        renderItem={({ item: group }) => (
          <View style={styles.group} accessibilityRole="none">
            <Text variant="label" accessibilityRole="header" style={styles.groupTitle}>
              {t(`notificationPrefs.groups.${group.group}`)}
            </Text>
            <View
              style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}
            >
              {group.rows.map((row) => (
                <PreferenceRow
                  key={row.type}
                  row={row}
                  entry={state.entries.find((e) => e.type === row.type)!}
                  pushEnabled={push.configured}
                  onChange={change}
                  onReset={reset}
                />
              ))}
            </View>
          </View>
        )}
        ListEmptyComponent={
          <EmptyState icon="notifications-off-outline" title={t('notificationPrefs.empty')} />
        }
        contentContainerStyle={styles.listContent}
      />
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <StackHeader title={t('notificationPrefs.title')} onBack={goBack} />
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  loading: { marginTop: spacing.xl },
  pad: { padding: spacing.lg },
  header: { gap: spacing.md, padding: spacing.lg },
  failed: { gap: spacing.sm },
  group: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  groupTitle: { paddingStart: spacing.xs },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, overflow: 'hidden' },
  listContent: { flexGrow: 1, paddingBottom: spacing.xxl },
});
