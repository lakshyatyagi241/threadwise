import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { HeaderIconButton } from '@/components/ui/screen-header';
import { StackHeader } from '@/components/ui/stack-header';
import { Text } from '@/components/ui/text';
import { isApiError } from '@/lib/api';
import { messageForError } from '@/lib/api/error-message';
import { can, useSession } from '@/lib/session/use-session';
import { MIN_TOUCH_TARGET, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { formatMoment } from '@/lib/format/dates';
import { DetailRow } from './detail-row';
import { PriorityBadge } from './priority-badge';
import { firstParam } from './route-params';
import { isNotFound, isPlanLocked } from './task-errors';
import { useDeleteTask, useTask, useToggleTask } from './use-tasks';

/**
 * One task: its title and due date, then the description, priority, status, owner and the contact it belongs to (a link to that
 * contact). People who may update tasks can edit an open task and mark it complete or reopen it from the button at the bottom;
 * people who may delete can delete it after a confirmation.
 */
export function TaskDetailsScreen() {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = firstParam(params.id);
  const session = useSession();
  const canRead = can(session.data, 'record.tasks.read');
  const canUpdate = can(session.data, 'record.tasks.update');
  const canDelete = can(session.data, 'record.tasks.delete');
  const canOpenContact = can(session.data, 'record.contacts.read');
  const task = useTask(id, canRead);
  const toggle = useToggleTask();
  const remove = useDeleteTask();
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/tasks'));
  const data = task.data;
  const done = data?.status === 'done';

  const changeStatus = () => {
    if (!data) return;
    setNotice(null);
    toggle.mutate(
      { id: data.id, rowVersion: data.rowVersion, status: data.status },
      {
        onError: (error) => {
          if (isApiError(error) && error.isRowVersionConflict) {
            setNotice(t('tasks.details.conflict'));
            void task.refetch();
          } else {
            setNotice(isNotFound(error) ? t('tasks.notFound') : messageForError(error, t));
          }
        },
      },
    );
  };

  const confirmDelete = () =>
    remove.mutate(id, {
      onSuccess: () => {
        setConfirming(false);
        goBack();
      },
      onError: (error) => {
        setConfirming(false);
        setNotice(isNotFound(error) ? t('tasks.notFound') : messageForError(error, t));
      },
    });

  let body;
  if (session.data === undefined) {
    body = <ActivityIndicator accessibilityLabel={t('common.loading')} style={styles.loading} />;
  } else if (!canRead) {
    body = (
      <EmptyState
        icon="lock-closed-outline"
        title={t('tasks.denied.title')}
        hint={t('tasks.denied.hint')}
      />
    );
  } else if (!data) {
    if (task.isPending) {
      body = <ActivityIndicator accessibilityLabel={t('common.loading')} style={styles.loading} />;
    } else if (isPlanLocked(task.error)) {
      body = (
        <EmptyState
          icon="lock-closed-outline"
          title={t('tasks.planLocked.title')}
          hint={t('tasks.planLocked.hint')}
        />
      );
    } else {
      const missing = isNotFound(task.error);
      body = (
        <View style={styles.pad}>
          <Card>
            <Text danger accessibilityRole="alert">
              {missing ? t('tasks.notFound') : messageForError(task.error, t)}
            </Text>
            {missing ? null : (
              <Button
                variant="secondary"
                label={t('common.retry')}
                onPress={() => void task.refetch()}
              />
            )}
          </Card>
        </View>
      );
    }
  } else {
    const due = data.dueAt ? formatMoment(data.dueAt, i18n.language) : null;
    const contact = data.contact;
    const contactName = contact?.name?.trim() || t('tasks.unknownContact');
    body = (
      <>
        <ScrollView contentContainerStyle={styles.content}>
          {notice ? <Banner tone="warning" message={notice} /> : null}
          <View style={styles.hero}>
            <Text
              variant="title"
              accessibilityRole="header"
              muted={done}
              style={done ? styles.struck : undefined}
            >
              {data.title}
            </Text>
            <Text danger={data.overdue} muted={!data.overdue}>
              {due ?? t('tasks.details.noDue')}
            </Text>
          </View>
          <Card>
            <DetailRow
              label={t('tasks.details.description')}
              value={data.notes?.trim() || t('tasks.details.noDescription')}
              empty={!data.notes?.trim()}
            />
            <DetailRow label={t('tasks.details.priority')}>
              <PriorityBadge priority={data.priority} />
            </DetailRow>
            <DetailRow label={t('tasks.details.status')}>
              <View style={styles.badges}>
                <Badge
                  tone={done ? 'success' : 'info'}
                  label={done ? t('tasks.status.done') : t('tasks.status.open')}
                />
                {data.overdue ? <Badge tone="danger" label={t('tasks.status.overdue')} /> : null}
              </View>
            </DetailRow>
            <DetailRow
              label={t('tasks.details.owner')}
              value={data.assignee?.name || t('tasks.details.unassigned')}
              empty={!data.assignee}
            />
            <DetailRow label={t('tasks.details.relatedTo')}>
              {contact && canOpenContact ? (
                <Pressable
                  accessibilityRole="link"
                  accessibilityLabel={t('tasks.details.openContact', { name: contactName })}
                  onPress={() =>
                    router.push({ pathname: '/contact/[id]', params: { id: contact.id } })
                  }
                  style={styles.link}
                >
                  <Text color="primary">{contactName}</Text>
                </Pressable>
              ) : (
                <Text muted={!contact}>{contact ? contactName : t('tasks.details.noContact')}</Text>
              )}
            </DetailRow>
          </Card>
        </ScrollView>
        {canUpdate ? (
          <View style={[styles.footer, { borderTopColor: colors.border }]}>
            <Button
              variant={done ? 'secondary' : 'primary'}
              label={done ? t('tasks.details.reopen') : t('tasks.details.markComplete')}
              loading={toggle.isPending}
              onPress={changeStatus}
            />
          </View>
        ) : null}
      </>
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <StackHeader
        title={t('tasks.details.title')}
        onBack={goBack}
        actions={
          data ? (
            <>
              {canUpdate && !done ? (
                <HeaderIconButton
                  icon="create-outline"
                  label={t('tasks.details.edit')}
                  onPress={() =>
                    router.push({ pathname: '/task-form', params: { taskId: data.id } })
                  }
                />
              ) : null}
              {canDelete ? (
                <HeaderIconButton
                  icon="trash-outline"
                  label={t('tasks.details.delete')}
                  onPress={() => setConfirming(true)}
                />
              ) : null}
            </>
          ) : null
        }
      />
      {body}
      <ConfirmDialog
        visible={confirming}
        title={t('tasks.delete.title')}
        message={t('tasks.delete.message')}
        confirmLabel={t('tasks.delete.confirm')}
        cancelLabel={t('tasks.cancel')}
        pending={remove.isPending}
        onConfirm={confirmDelete}
        onCancel={() => setConfirming(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.lg },
  pad: { padding: spacing.lg },
  loading: { marginTop: spacing.xxl },
  hero: { gap: spacing.sm, paddingVertical: spacing.sm },
  struck: { textDecorationLine: 'line-through' },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  link: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
  footer: { padding: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth },
});
