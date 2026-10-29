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
import { Icon } from '@/components/ui/icon';
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
import { firstParam } from './route-params';
import { isNotFound, isPlanLocked } from './task-errors';
import { taskTypeName } from './task-type-name';
import { CompleteTaskSheet } from './task-outcome';
import { useDeleteTask, useTask, useTaskCompletion, useToggleTask } from './use-tasks';

/** What a row without a value shows, as the Geta app draws it. */
const NO_VALUE = '--';

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
  const completion = useTaskCompletion(canRead);
  const [picking, setPicking] = useState(false);
  const remove = useDeleteTask();
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/tasks'));
  const data = task.data;
  const done = data?.status === 'done';

  /** Completing asks for the outcome first when the workspace has outcomes; reopening and a workspace without outcomes go straight through. */
  const changeStatus = (outcomeId?: string | null) => {
    if (!data) return;
    if (!done && outcomeId === undefined && completion.outcomes.length > 0) {
      setPicking(true);
      return;
    }
    setPicking(false);
    setNotice(null);
    toggle.mutate(
      { id: data.id, rowVersion: data.rowVersion, status: data.status, outcomeId },
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
          {notice ? (
            <View style={styles.notice}>
              <Banner tone="warning" message={notice} />
            </View>
          ) : null}
          <View style={[styles.hero, { borderBottomColor: colors.border }]}>
            <View
              style={[
                styles.avatar,
                {
                  borderColor: done ? colors.success : colors.action,
                  backgroundColor: done ? colors.success : colors.successSoft,
                },
              ]}
            >
              <Icon
                name={done ? 'checkmark' : 'list-outline'}
                size={22}
                color={done ? 'onAction' : 'action'}
              />
            </View>
            <View style={styles.heroText}>
              <Text
                variant="heading"
                accessibilityRole="header"
                muted={done}
                style={done ? styles.struck : undefined}
              >
                {data.title}
              </Text>
              <Text variant="caption" danger={data.overdue} muted={!data.overdue}>
                {due ?? t('tasks.details.noDue')}
              </Text>
              {done || data.overdue ? (
                <View style={styles.badges}>
                  {done ? <Badge tone="success" label={t('tasks.status.done')} /> : null}
                  {data.overdue ? <Badge tone="danger" label={t('tasks.status.overdue')} /> : null}
                </View>
              ) : null}
            </View>
          </View>
          <DetailRow
            label={t('tasks.details.description')}
            value={data.notes?.trim() || t('tasks.details.noDescription')}
          />
          <DetailRow
            label={t('tasks.form.type')}
            value={data.taskType ? taskTypeName(t, data.taskType) : NO_VALUE}
          />
          <DetailRow
            label={t('tasks.details.priority')}
            value={t(`tasks.priority.${data.priority}`)}
          />
          <DetailRow label={t('tasks.outcome.label')} value={data.outcome?.name ?? NO_VALUE} />
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
                <Text variant="caption" color="primary">
                  {contactName}
                </Text>
              </Pressable>
            ) : (
              <Text variant="caption" muted>
                {contact ? contactName : NO_VALUE}
              </Text>
            )}
          </DetailRow>
          <DetailRow
            label={t('tasks.details.owner')}
            value={data.assignee?.name || t('tasks.details.unassigned')}
          />
        </ScrollView>
        {canUpdate && (done || completion.allowComplete) ? (
          <View style={[styles.footer, { borderTopColor: colors.border }]}>
            <Button
              variant={done ? 'secondary' : 'primary'}
              label={done ? t('tasks.details.reopen') : t('tasks.details.markComplete')}
              loading={toggle.isPending}
              onPress={() => changeStatus()}
            />
          </View>
        ) : null}
      </>
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: colors.surface }]}>
      <StackHeader
        title={t('tasks.details.title')}
        onBack={goBack}
        centered
        actionCount={2}
        actions={
          data ? (
            <>
              {canUpdate && !done ? (
                <HeaderIconButton
                  icon="create-outline"
                  color="action"
                  label={t('tasks.details.edit')}
                  onPress={() =>
                    router.push({ pathname: '/task-form', params: { taskId: data.id } })
                  }
                />
              ) : null}
              {canDelete ? (
                <HeaderIconButton
                  icon="trash-outline"
                  color="action"
                  label={t('tasks.details.delete')}
                  onPress={() => setConfirming(true)}
                />
              ) : null}
            </>
          ) : null
        }
      />
      {body}
      <CompleteTaskSheet
        title={picking && data ? data.title : null}
        outcomes={completion.outcomes}
        pending={toggle.isPending}
        onConfirm={(outcomeId) => changeStatus(outcomeId)}
        onCancel={() => setPicking(false)}
      />
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
  content: { paddingBottom: spacing.lg },
  notice: { padding: spacing.lg },
  pad: { padding: spacing.lg },
  loading: { marginTop: spacing.xxl },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    padding: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  heroText: { flex: 1, gap: spacing.xs },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  struck: { textDecorationLine: 'line-through' },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  link: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
  footer: { padding: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth },
});
