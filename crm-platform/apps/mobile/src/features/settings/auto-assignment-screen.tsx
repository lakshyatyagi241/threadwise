import type { RoutingRule } from '@crm/contracts';
import { ERROR_CODES } from '@crm/contracts';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { StackHeader } from '@/components/ui/stack-header';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { Toggle } from '@/components/ui/toggle';
import { isApiError } from '@/lib/api';
import { messageForError } from '@/lib/api/error-message';
import { SEARCH_DEBOUNCE_MS, useDebounced } from '@/lib/hooks/use-debounced';
import { can, useSession } from '@/lib/session/use-session';
import { spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { RoutingRuleCard } from './routing-rule-card';
import {
  routingKey,
  useDeleteRule,
  useDuplicateRule,
  useReorderRules,
  useRoutingSettings,
  useRules,
  useSaveRoutingSettings,
  useTargetNames,
  useToggleRule,
} from './use-routing';

const isPlanLocked = (error: unknown): boolean =>
  isApiError(error) && error.code === ERROR_CODES.PLAN_FEATURE_LOCKED;

/**
 * Settings, Auto-assignment (TW-TIB2-001; the Geta app's "Chat assignment"): the rules that give each new conversation to the right agent,
 * tried in order from the top, and the setting that keeps a returning contact with their agent. A rule has a switch, two arrows that change
 * its priority, Copy (the copy goes last, switched off) and Delete. Needs the plan feature `inbox_routing`, `inbox.settings.read` to see and
 * `inbox.routing.manage` to change. Creating and editing a rule is not here yet (see README).
 */
export function AutoAssignmentScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const session = useSession();
  const canRead = can(session.data, 'inbox.settings.read');
  const canManage = can(session.data, 'inbox.routing.manage');
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim(), SEARCH_DEBOUNCE_MS);
  const rules = useRules(q, canRead);
  const settings = useRoutingSettings(canRead);
  const names = useTargetNames(can(session.data, 'inbox.conversation.read'));
  const toggle = useToggleRule();
  const reorder = useReorderRules();
  const duplicate = useDuplicateRule();
  const remove = useDeleteRule();
  const saveSettings = useSaveRoutingSettings();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<RoutingRule | null>(null);
  const [notice, setNotice] = useState<{ tone: 'info' | 'danger'; message: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const rows = useMemo(() => rules.data?.pages.flatMap((p) => p.data) ?? [], [rules.data]);
  const first = rules.data?.pages[0];
  const limit = first?.limit ?? null;
  const total = first?.total ?? 0;
  const atLimit = limit !== null && limit > 0 && total >= limit;
  const locked = isPlanLocked(rules.error) || isPlanLocked(settings.error);

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/menu'));
  const fail = (message: string) => setNotice({ tone: 'danger', message });
  const done = (message: string) => setNotice({ tone: 'info', message });

  /** Runs one change to one rule and says how it went; the list is read again either way (the mutations do it). */
  const run = async (id: string, action: () => Promise<unknown>, failed: string, ok?: string) => {
    setBusyId(id);
    setNotice(null);
    try {
      await action();
      if (ok) done(ok);
    } catch (e) {
      fail(
        isApiError(e) && e.status < 500 && e.code !== 'CLIENT_NETWORK'
          ? failed
          : messageForError(e, t),
      );
    } finally {
      setBusyId(null);
    }
  };

  const move = (rule: RoutingRule, direction: -1 | 1) => {
    const index = rows.findIndex((r) => r.id === rule.id);
    const other = rows[index + direction];
    if (!other) return;
    const ids = direction === -1 ? [rule.id, other.id] : [other.id, rule.id];
    void run(rule.id, () => reorder.mutateAsync(ids), t('settings.routing.reorderFailed'));
  };

  const keep = settings.data?.keepContactAgent ?? false;
  const setKeep = async (on: boolean) => {
    setNotice(null);
    try {
      await saveSettings.mutateAsync(on);
    } catch (e) {
      fail(
        isApiError(e) && e.status < 500
          ? t('settings.routing.settingsFailed')
          : messageForError(e, t),
      );
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: routingKey });
    setRefreshing(false);
  };

  const confirmDelete = async () => {
    const rule = deleting;
    if (!rule) return;
    await run(
      rule.id,
      () => remove.mutateAsync(rule),
      t('settings.routing.deleteFailed'),
      t('settings.routing.deleted'),
    );
    setDeleting(null);
  };

  let body;
  if (session.data === undefined || (canRead && rules.isPending && !locked)) {
    body = <ActivityIndicator accessibilityLabel={t('common.loading')} style={styles.loading} />;
  } else if (!canRead) {
    body = <EmptyState icon="lock-closed-outline" title={t('settings.routing.noAccess')} />;
  } else if (locked) {
    body = <EmptyState icon="lock-closed-outline" title={t('settings.routing.planLocked')} />;
  } else if (rules.isError) {
    body = (
      <View style={styles.pad}>
        <Card>
          <Text danger accessibilityRole="alert">
            {messageForError(rules.error, t)}
          </Text>
          <Button
            variant="secondary"
            label={t('common.retry')}
            onPress={() => void rules.refetch()}
          />
        </Card>
      </View>
    );
  } else {
    body = (
      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => (
          <View style={styles.item}>
            <RoutingRuleCard
              rule={item}
              canManage={canManage}
              reorderable={q === ''}
              first={index === 0}
              last={index === rows.length - 1 && !rules.hasNextPage}
              busy={busyId === item.id}
              names={names}
              onToggle={(rule, isActive) =>
                void run(
                  rule.id,
                  () => toggle.mutateAsync({ rule, isActive }),
                  t('settings.routing.toggleFailed'),
                )
              }
              onMove={move}
              onDuplicate={(rule) =>
                void run(
                  rule.id,
                  () => duplicate.mutateAsync(rule),
                  t('settings.routing.duplicateFailed'),
                  t('settings.routing.duplicated'),
                )
              }
              onDelete={setDeleting}
            />
          </View>
        )}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (rules.hasNextPage && !rules.isFetchingNextPage) void rules.fetchNextPage();
        }}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text muted>{t('settings.routing.subtitle')}</Text>
            <Card>
              <View style={styles.keep}>
                <View style={styles.keepText}>
                  <Text variant="heading">{t('settings.routing.keepTitle')}</Text>
                  <Text muted>{t('settings.routing.keepBody')}</Text>
                </View>
                <Toggle
                  label={t('settings.routing.keepTitle')}
                  value={keep}
                  disabled={!canManage || settings.isPending || saveSettings.isPending}
                  onValueChange={(on) => void setKeep(on)}
                />
              </View>
            </Card>
            <Button
              variant="secondary"
              label={t('settings.routing.businessHours')}
              onPress={() => router.push('/business-hours')}
            />
            {limit !== null && limit > 0 ? (
              <Text variant="caption" muted>
                {atLimit
                  ? t('settings.routing.limitReached', { limit })
                  : t('settings.routing.limitUsed', { used: total, limit })}
              </Text>
            ) : null}
            <Text variant="heading">{t('settings.routing.rulesTitle')}</Text>
            <TextField
              label={t('settings.routing.searchLabel')}
              placeholder={t('settings.routing.searchPlaceholder')}
              value={search}
              onChangeText={setSearch}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
            />
            <Text variant="caption" muted>
              {t('settings.routing.howItWorks')}
            </Text>
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon="git-branch-outline"
            title={q ? t('settings.routing.noMatchTitle') : t('settings.routing.emptyTitle')}
            hint={q ? t('settings.routing.noMatch', { q }) : t('settings.routing.empty')}
          />
        }
        ListFooterComponent={
          rules.isFetchingNextPage ? (
            <ActivityIndicator accessibilityLabel={t('common.loading')} style={styles.footer} />
          ) : null
        }
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
      />
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <StackHeader title={t('settings.routing.title')} onBack={goBack} />
      {notice ? (
        <View style={styles.notice}>
          <Banner tone={notice.tone} message={notice.message} />
        </View>
      ) : null}
      <View style={styles.fill}>{body}</View>
      <ConfirmDialog
        visible={deleting !== null}
        title={t('settings.routing.deleteTitle')}
        message={t('settings.routing.deleteMessage', { name: deleting?.name ?? '' })}
        confirmLabel={t('settings.routing.delete')}
        cancelLabel={t('settings.routing.cancel')}
        pending={remove.isPending}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleting(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  loading: { marginTop: spacing.xl },
  pad: { padding: spacing.lg },
  notice: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  header: { gap: spacing.md, padding: spacing.lg },
  keep: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  keepText: { flex: 1, gap: spacing.xs },
  item: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  footer: { paddingVertical: spacing.lg },
  listContent: { flexGrow: 1, paddingBottom: spacing.xxl },
});
