import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { StackHeader } from '@/components/ui/stack-header';
import { Text } from '@/components/ui/text';
import { messageForError } from '@/lib/api/error-message';
import { can, useSession } from '@/lib/session/use-session';
import { spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { firstParam } from './route-params';
import { describeTaskFailure, isNotFound, isPlanLocked, type TaskFailure } from './task-errors';
import { TaskEditor } from './task-editor';
import {
  newTaskValues,
  buildCreateBody,
  buildUpdateBody,
  contractProblems,
  valuesOfTask,
  type ContactChoice,
  type TaskField,
  type TaskFormProblems,
  type TaskFormValues,
} from './task-validation';
import { taskKey, useCreateTask, useLinkedContact, useTask, useUpdateTask } from './use-tasks';

/** The name to show for the contact a task is added for: its name, else first and last name, else its phone or email. */
function contactNameOf(contact: {
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
}): string {
  const full =
    contact.name?.trim() || `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim();
  return full || contact.phone || contact.email || '';
}

/**
 * Add a task (`?contactId=` adds it for that contact) or edit one (`?taskId=`). Saving a new task sends it once, whatever the
 * connection does; saving an edit sends only what changed with the version that was read, and a task changed by someone else
 * in the meantime is reloaded with a note to review it and save again.
 */
export function TaskFormScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{
    contactId?: string | string[];
    taskId?: string | string[];
  }>();
  const contactId = firstParam(params.contactId);
  const taskId = firstParam(params.taskId);
  const editing = taskId !== '';
  const session = useSession();
  const canReadTasks = can(session.data, 'record.tasks.read');
  const canWrite = can(session.data, editing ? 'record.tasks.update' : 'record.tasks.create');
  const canReadContacts = can(session.data, 'record.contacts.read');
  const myId = session.data?.user.id;

  const task = useTask(taskId, editing && canWrite && canReadTasks);
  const linked = useLinkedContact(contactId, canReadContacts);
  const create = useCreateTask();
  const update = useUpdateTask(taskId);
  const [failure, setFailure] = useState<TaskFailure | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/tasks'));

  const header = (
    <StackHeader
      title={editing ? t('tasks.form.editTitle') : t('tasks.form.addTitle')}
      onBack={goBack}
    />
  );

  const showProblems = (problems: TaskFormProblems) => {
    const fields: Partial<Record<TaskField, string>> = {};
    for (const [field, key] of Object.entries(problems) as [
      TaskField,
      NonNullable<TaskFormProblems[TaskField]>,
    ][]) {
      fields[field] = t(key);
    }
    setFailure({ banner: null, fields, conflict: false });
  };

  let body;
  if (session.data === undefined) {
    body = <ActivityIndicator accessibilityLabel={t('common.loading')} style={styles.loading} />;
  } else if (!canWrite || (editing && !canReadTasks)) {
    body = (
      <EmptyState
        icon="lock-closed-outline"
        title={editing ? t('tasks.denied.editTitle') : t('tasks.denied.createTitle')}
        hint={editing ? t('tasks.denied.editHint') : t('tasks.denied.createHint')}
      />
    );
  } else if (editing && !task.data) {
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
    const current = task.data;
    const initial: TaskFormValues = current ? valuesOfTask(current, myId) : newTaskValues();

    // A contact that cannot be changed here: the one the task was opened for, or the task's own when contacts cannot be listed.
    let fixedContact: ContactChoice | null = null;
    if (contactId) {
      fixedContact = { id: contactId, name: linked.data ? contactNameOf(linked.data) : '' };
    } else if (current?.contact && !canReadContacts) {
      fixedContact = { id: current.contact.id, name: current.contact.name ?? '' };
    }

    const onSubmit = (values: TaskFormValues) => {
      setFailure(null);
      setNotice(null);
      if (current) {
        const changes = buildUpdateBody(current, values, myId);
        if (Object.keys(changes).length === 0) {
          goBack();
          return;
        }
        const payload = { ...changes, rowVersion: current.rowVersion };
        const problems = contractProblems(payload, 'update');
        if (Object.keys(problems).length > 0) return showProblems(problems);
        update.mutate(payload, {
          onSuccess: goBack,
          onError: (error) => {
            const described = describeTaskFailure(error, t);
            if (described.conflict) {
              setNotice(t('tasks.form.conflict'));
              void queryClient.invalidateQueries({ queryKey: taskKey(taskId) });
            } else {
              setFailure(described);
            }
          },
        });
        return;
      }
      const payload = buildCreateBody(values);
      const problems = contractProblems(payload, 'create');
      if (Object.keys(problems).length > 0) return showProblems(problems);
      create.mutate(payload, {
        onSuccess: goBack,
        onError: (error) => setFailure(describeTaskFailure(error, t)),
      });
    };

    return (
      <TaskEditor
        // Keyed by the version, so a reload after a conflict shows the other person's values.
        key={current?.rowVersion ?? 'new'}
        mode={editing ? 'edit' : 'create'}
        initial={initial}
        fixedContact={fixedContact}
        currentType={current?.taskType ?? null}
        contactLoading={Boolean(contactId) && canReadContacts && linked.isPending}
        canListTeam={canReadContacts}
        canPickContact={canReadContacts}
        myId={myId}
        pending={create.isPending || update.isPending}
        banner={failure?.banner}
        notice={notice}
        serverErrors={failure?.fields}
        onBack={goBack}
        onSubmit={onSubmit}
      />
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      {header}
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  pad: { padding: spacing.lg },
  loading: { marginTop: spacing.xxl },
});
