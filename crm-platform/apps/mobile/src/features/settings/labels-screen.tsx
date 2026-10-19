import type { InboxTag } from '@crm/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import { StackHeader } from '@/components/ui/stack-header';
import { Text } from '@/components/ui/text';
import { messageForError } from '@/lib/api/error-message';
import { can, useSession } from '@/lib/session/use-session';
import { MIN_TOUCH_TARGET, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { isLabelGone } from './label-errors';
import { LabelDot } from './label-dot';
import { labelLibraryKey, useDeleteLabel, useLabelList } from './use-label-library';

const FAB_SIZE = 52;
const FAB_MARGIN = 24;

/**
 * Settings, Labels (the web's "Conversation tags"): the workspace's label library, each with its colour and how many conversations carry
 * it. A row opens to edit, the bin deletes (after asking: the label also leaves every conversation and contact that has it), and the
 * round button adds one. Needs `inbox.tag.manage`, like the web screen.
 */
export function LabelsScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const session = useSession();
  const allowed = can(session.data, 'inbox.tag.manage');
  const library = useLabelList(allowed);
  const remove = useDeleteLabel();
  const [deleting, setDeleting] = useState<InboxTag | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/menu'));
  const edit = (label: InboxTag) =>
    router.push({ pathname: '/label-form', params: { labelId: label.id } });

  const refresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: labelLibraryKey });
    setRefreshing(false);
  };

  const confirmDelete = async () => {
    const label = deleting;
    if (!label) return;
    try {
      await remove.mutateAsync(label);
      setNotice(t('settings.labels.deleted'));
    } catch (e) {
      // Already gone (deleted by someone else): the list was read again, which is the answer the person wanted.
      setNotice(isLabelGone(e) ? t('settings.labels.deleted') : messageForError(e, t));
    } finally {
      setDeleting(null);
    }
  };

  let body;
  if (session.data === undefined || (allowed && library.isPending)) {
    body = <ActivityIndicator accessibilityLabel={t('common.loading')} style={styles.loading} />;
  } else if (!allowed) {
    body = <EmptyState icon="lock-closed-outline" title={t('settings.labels.noAccess')} />;
  } else if (library.isError) {
    body = (
      <View style={styles.pad}>
        <Card>
          <Text danger accessibilityRole="alert">
            {messageForError(library.error, t)}
          </Text>
          <Button
            variant="secondary"
            label={t('common.retry')}
            onPress={() => void library.refetch()}
          />
        </Card>
      </View>
    );
  } else {
    body = (
      <FlatList
        data={library.data?.data ?? []}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={[styles.row, { borderBottomColor: colors.border }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={item.name}
              accessibilityHint={t('settings.labels.inUse', { count: item.conversationCount })}
              onPress={() => edit(item)}
              style={styles.main}
            >
              <LabelDot color={item.color} />
              <View style={styles.text}>
                <Text variant="label" numberOfLines={1}>
                  {item.name}
                </Text>
                {item.description ? (
                  <Text muted numberOfLines={2}>
                    {item.description}
                  </Text>
                ) : null}
                <Text variant="caption" muted>
                  {t('settings.labels.inUse', { count: item.conversationCount })}
                </Text>
              </View>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${t('settings.labels.delete')} ${item.name}`}
              onPress={() => setDeleting(item)}
              style={styles.bin}
            >
              <Icon name="trash-outline" size={20} color="danger" />
            </Pressable>
          </View>
        )}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
        ListEmptyComponent={
          <EmptyState
            icon="pricetag-outline"
            title={t('settings.labels.empty.title')}
            hint={t('settings.labels.empty.hint')}
          />
        }
        contentContainerStyle={styles.listContent}
      />
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <StackHeader title={t('inbox.filter.labels')} onBack={goBack} />
      {notice ? (
        <View style={styles.notice}>
          <Banner tone="info" message={notice} />
        </View>
      ) : null}
      <View style={styles.fill}>{body}</View>
      {allowed ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('inbox.thread.labels.newLabel')}
          onPress={() => router.push('/label-form')}
          style={[styles.fab, { backgroundColor: colors.primary, shadowColor: colors.shadow }]}
        >
          <Icon name="add" size={24} color="onPrimary" />
        </Pressable>
      ) : null}
      <ConfirmDialog
        visible={deleting !== null}
        title={t('settings.labels.deleteTitle')}
        message={t('settings.labels.deleteMessage', { name: deleting?.name ?? '' })}
        confirmLabel={t('settings.labels.delete')}
        cancelLabel={t('settings.labels.cancel')}
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
  row: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  main: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingStart: spacing.lg,
  },
  text: { flex: 1, gap: spacing.xs },
  bin: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Room under the last row for the round button, so it never covers a label.
  listContent: { flexGrow: 1, paddingBottom: FAB_SIZE + FAB_MARGIN * 2 },
  fab: {
    position: 'absolute',
    end: FAB_MARGIN,
    bottom: FAB_MARGIN,
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
});
