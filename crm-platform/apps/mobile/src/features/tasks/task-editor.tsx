import type { ActivityOptionRef, TaskPriority } from '@crm/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Banner } from '@/components/ui/banner';
import { HeaderIconButton } from '@/components/ui/screen-header';
import { DateField, TimeField } from '@/components/ui/date-time-fields';
import { SelectField } from '@/components/ui/select-field';
import { StackHeader } from '@/components/ui/stack-header';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { MIN_TOUCH_TARGET, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { ContactField } from './contact-field';
import { PRIORITY_CHOICES } from './filters';
import { OwnerField } from './owner-field';
import { TaskTypeField } from './task-type-field';
import {
  validateTask,
  type ContactChoice,
  type TaskField,
  type TaskFormValues,
} from './task-validation';

interface Props {
  /** `create` or `edit`: only the header title differs. */
  mode: 'create' | 'edit';
  initial: TaskFormValues;
  /** The contact the task belongs to when it cannot be changed here (opened from a contact, or the person may not list contacts). */
  fixedContact: ContactChoice | null;
  /** The task type the task holds now (edit), so one removed since still shows. */
  currentType: ActivityOptionRef | null;
  /** The fixed contact's name is still on its way. */
  contactLoading: boolean;
  canListTeam: boolean;
  canPickContact: boolean;
  myId: string | undefined;
  pending: boolean;
  /** A message about the whole form (a failed save), shown above the fields. */
  banner?: string | null;
  /** Something for the person to look at before saving again (someone else changed the task). */
  notice?: string | null;
  /** What the server refused, by field, in the person's language. */
  serverErrors?: Partial<Record<TaskField, string>>;
  onBack: () => void;
  /** Called with checked values, the fixed contact already in place. */
  onSubmit: (values: TaskFormValues) => void;
}

/**
 * The form to add a task and to edit one, under its own header whose check button saves, in the order of the Geta app's: title,
 * description, the linked contact, the task type, priority, the due date and time side by side (each a field with a picker in a
 * sheet), and the owner. The client
 * checks what the API's schema checks; everything else is the server's answer, shown under the field or above the form.
 */
export function TaskEditor({
  mode,
  initial,
  fixedContact,
  currentType,
  contactLoading,
  canListTeam,
  canPickContact,
  myId,
  pending,
  banner,
  notice,
  serverErrors,
  onBack,
  onSubmit,
}: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [values, setValues] = useState(initial);
  const [checked, setChecked] = useState<Partial<Record<TaskField, string>>>({});

  const change = <K extends keyof TaskFormValues>(field: K, value: TaskFormValues[K]) => {
    setValues({ ...values, [field]: value });
    setChecked({ ...checked, [field]: undefined });
  };

  const submit = () => {
    if (pending) return;
    const problems = validateTask(values);
    const messages: Partial<Record<TaskField, string>> = {};
    for (const [field, key] of Object.entries(problems) as [
      TaskField,
      NonNullable<(typeof problems)[TaskField]>,
    ][]) {
      messages[field] = t(key);
    }
    setChecked(messages);
    if (Object.keys(messages).length === 0) {
      onSubmit({ ...values, contact: fixedContact ?? values.contact });
    }
  };

  const error = (field: TaskField) => checked[field] ?? serverErrors?.[field];

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <StackHeader
        title={mode === 'edit' ? t('tasks.form.editTitle') : t('tasks.form.addTitle')}
        onBack={onBack}
        actions={
          pending ? (
            <View style={styles.saving}>
              <ActivityIndicator accessibilityLabel={t('tasks.form.saving')} />
            </View>
          ) : (
            <HeaderIconButton icon="checkmark" label={t('tasks.form.save')} onPress={submit} />
          )
        }
      />
      <KeyboardAvoidingView style={styles.fill} behavior="padding">
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {notice ? <Banner tone="warning" message={notice} /> : null}
          {banner ? <Banner tone="danger" message={banner} /> : null}
          <TextField
            label={t('tasks.form.title')}
            placeholder={t('tasks.form.titlePlaceholder')}
            value={values.title}
            onChangeText={(v) => change('title', v)}
            error={error('title')}
            autoCapitalize="sentences"
            returnKeyType="next"
          />
          <TextField
            label={t('tasks.form.description')}
            placeholder={t('tasks.form.descriptionPlaceholder')}
            value={values.notes}
            onChangeText={(v) => change('notes', v)}
            error={error('notes')}
            autoCapitalize="sentences"
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
          {fixedContact ? (
            <View style={styles.group}>
              <Text variant="label">{t('tasks.form.contact')}</Text>
              <Text accessibilityRole="text">
                {contactLoading
                  ? t('common.loading')
                  : fixedContact.name || t('tasks.unknownContact')}
              </Text>
              {error('contact') ? (
                <Text variant="caption" danger accessibilityRole="alert">
                  {error('contact')}
                </Text>
              ) : null}
            </View>
          ) : canPickContact ? (
            <ContactField
              value={values.contact}
              onChange={(v) => change('contact', v)}
              error={error('contact')}
            />
          ) : null}
          <TaskTypeField
            value={values.taskTypeId}
            current={currentType}
            onChange={(v) => change('taskTypeId', v)}
          />
          <View style={styles.group}>
            <Text variant="label">{t('tasks.form.priority')}</Text>
            <SelectField
              label={t('tasks.form.priority')}
              placeholder={t('tasks.form.priority')}
              value={values.priority}
              onChange={(v) => change('priority', v as TaskPriority)}
              options={PRIORITY_CHOICES.map((value) => ({
                value,
                label: t(`tasks.priority.${value}`),
              }))}
            />
          </View>
          <View style={styles.pair}>
            <View style={styles.half}>
              <DateField
                label={t('contactProps.editor.date')}
                placeholder={t('tasks.form.datePlaceholder')}
                clearLabel={t('common.clear')}
                value={values.date}
                onChange={(v) => change('date', v)}
                error={error('date')}
              />
            </View>
            <View style={styles.half}>
              <TimeField
                label={t('contactProps.editor.time')}
                placeholder={t('tasks.form.timePlaceholder')}
                clearLabel={t('common.clear')}
                hourLabel={t('tasks.form.hour')}
                minuteLabel={t('tasks.form.minute')}
                doneLabel={t('tasks.status.done')}
                value={values.time}
                onChange={(v) => change('time', v)}
                error={error('time')}
              />
            </View>
          </View>
          <OwnerField
            value={values.assignee}
            onChange={(v) => change('assignee', v)}
            canListTeam={canListTeam}
            myId={myId}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.lg },
  group: { gap: spacing.sm },
  pair: { flexDirection: 'row', gap: spacing.md },
  half: { flex: 1 },
  saving: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
