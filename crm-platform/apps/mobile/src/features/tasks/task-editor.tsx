import { useRef, useState } from 'react';
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
import { SegmentedControl } from '@/components/ui/segmented-control';
import { StackHeader } from '@/components/ui/stack-header';
import { Text } from '@/components/ui/text';
import { TextField, type TextFieldHandle } from '@/components/ui/text-field';
import { MIN_TOUCH_TARGET, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { ContactField } from './contact-field';
import { PRIORITY_CHOICES } from './filters';
import { OwnerField } from './owner-field';
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
 * The form to add a task and to edit one, under its own header whose check button saves. Fields in order: title, description,
 * priority, due date and time (two plain fields, since the app has no native picker), owner, and the linked contact. The client
 * checks what the API's schema checks; everything else is the server's answer, shown under the field or above the form.
 */
export function TaskEditor({
  mode,
  initial,
  fixedContact,
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
  const dateInput = useRef<TextFieldHandle>(null);
  const timeInput = useRef<TextFieldHandle>(null);

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
            value={values.title}
            onChangeText={(v) => change('title', v)}
            error={error('title')}
            autoCapitalize="sentences"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => dateInput.current?.focus()}
          />
          <TextField
            label={t('tasks.form.description')}
            value={values.notes}
            onChangeText={(v) => change('notes', v)}
            error={error('notes')}
            autoCapitalize="sentences"
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
          <View style={styles.group}>
            <Text variant="label">{t('tasks.form.priority')}</Text>
            <SegmentedControl
              label={t('tasks.form.priority')}
              value={values.priority}
              onChange={(v) => change('priority', v)}
              options={PRIORITY_CHOICES.map((value) => ({
                value,
                label: t(`tasks.priority.${value}`),
              }))}
            />
          </View>
          <TextField
            label={t('tasks.form.date')}
            hint={t('tasks.form.dateHint')}
            value={values.date}
            onChangeText={(v) => change('date', v)}
            error={error('date')}
            inputRef={dateInput}
            keyboardType="numbers-and-punctuation"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => timeInput.current?.focus()}
          />
          <TextField
            label={t('tasks.form.time')}
            hint={t('tasks.form.timeHint')}
            value={values.time}
            onChangeText={(v) => change('time', v)}
            error={error('time')}
            inputRef={timeInput}
            keyboardType="numbers-and-punctuation"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={submit}
          />
          <OwnerField
            value={values.assignee}
            onChange={(v) => change('assignee', v)}
            canListTeam={canListTeam}
            myId={myId}
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
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.lg },
  group: { gap: spacing.xs },
  saving: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
