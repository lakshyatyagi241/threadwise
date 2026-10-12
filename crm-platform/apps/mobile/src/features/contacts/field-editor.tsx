import type { ContactResponse, FieldOptionResponse } from '@crm/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { messageForError } from '@/lib/api/error-message';
import { MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import {
  currentValueOf,
  editorKindOf,
  initialDraftOf,
  keyboardFor,
  parseEdit,
  sameValue,
  updateBodyFor,
  type Draft,
  type Editable,
} from './property-values';
import { contactKey, useUpdateContact } from './use-contacts';
import { describeEditFailure, useFieldOptions } from './use-properties';

interface SheetProps {
  title: string;
  onClose: () => void;
  /** Shows the check button that saves; a sheet that only reads leaves it out. */
  onSave?: () => void;
  saving?: boolean;
  saveDisabled?: boolean;
  children: ReactNode;
}

/**
 * The bottom sheet the About tab's editors share: a dimmed page behind, a header with back, the title and a check that saves,
 * and a scrolling body. Tapping the dimmed page or the phone's back button closes it without saving.
 */
export function EditSheet({ title, onClose, onSave, saving, saveDisabled, children }: SheetProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const inactive = Boolean(saving) || Boolean(saveDisabled);
  return (
    <Modal transparent visible animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('contactProps.close')}
          onPress={onClose}
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]}
        />
        <View
          accessibilityViewIsModal
          style={[
            styles.sheet,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              paddingBottom: insets.bottom + spacing.lg,
            },
          ]}
        >
          <View style={styles.header}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('common.back')}
              onPress={onClose}
              style={styles.iconButton}
            >
              <Icon name="chevron-back" size={24} />
            </Pressable>
            <Text
              variant="heading"
              accessibilityRole="header"
              numberOfLines={1}
              style={styles.title}
            >
              {title}
            </Text>
            {onSave ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('contactProps.save')}
                accessibilityState={{ disabled: inactive, busy: Boolean(saving) }}
                disabled={inactive}
                onPress={onSave}
                style={[styles.iconButton, { opacity: inactive ? 0.5 : 1 }]}
              >
                {saving ? (
                  <ActivityIndicator color={colors.primary} />
                ) : (
                  <Icon name="checkmark" size={26} color="primary" />
                )}
              </Pressable>
            ) : (
              <View style={styles.iconButton} />
            )}
          </View>
          <ScrollView
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** One row of a pick list: a radio (one choice) or a checkbox (many), ticked when chosen. */
export function ChoiceRow({
  label,
  hint,
  selected,
  role,
  onPress,
}: {
  label: string;
  hint?: string;
  selected: boolean;
  role: 'radio' | 'checkbox';
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={[styles.choice, { borderBottomColor: colors.border }]}
    >
      <View style={styles.grow}>
        <Text variant={selected ? 'label' : 'body'}>{label}</Text>
        {hint ? (
          <Text variant="caption" muted>
            {hint}
          </Text>
        ) : null}
      </View>
      {selected ? <Icon name="checkmark" size={20} color="primary" /> : null}
    </Pressable>
  );
}

interface Problem {
  /** Which input it belongs to: the time of a date and time sits in its own input. */
  where: 'main' | 'time';
  message: string;
}

interface Props {
  contact: ContactResponse;
  edit: Editable;
  onClose: () => void;
}

/**
 * Edits one property of a contact in a bottom sheet: the name, email or phone, or one of the workspace's custom properties with
 * the editor its type calls for (text, number, switch, date and time, a list to pick from). Saving sends only that property
 * with the version that was read; the contact in the cache is replaced by the answer, so the tab behind shows it at once.
 */
export function FieldEditor({ contact, edit, onClose }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const update = useUpdateContact(contact.id);
  const field = edit.kind === 'custom' ? edit.field : null;
  const kind = field ? editorKindOf(field.fieldType) : 'text';
  const label = edit.kind === 'custom' ? edit.field.label : t(`contactProps.fields.${edit.key}`);
  const choosing = kind === 'single' || kind === 'multi';
  const fetched = useFieldOptions(field?.id ?? '', choosing && field?.options === undefined);
  const options: FieldOptionResponse[] = [...(field?.options ?? fetched.data ?? [])]
    .filter((o) => !o.isHidden)
    .sort((a, b) => a.position - b.position);

  const [draft, setDraft] = useState<Draft>(() => initialDraftOf(edit, contact));
  const [problem, setProblem] = useState<Problem | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const change = (next: Partial<Draft>) => {
    setDraft({ ...draft, ...next });
    setProblem(null);
  };

  const save = () => {
    setBanner(null);
    setNotice(null);
    const parsed = parseEdit(edit, draft, options, contact);
    if (!parsed.ok) {
      setProblem({
        where: parsed.error === 'time' ? 'time' : 'main',
        message: t(`contactProps.error.${parsed.error}`, parsed.params),
      });
      return;
    }
    if (sameValue(currentValueOf(edit, contact), parsed.value)) {
      onClose();
      return;
    }
    update.mutate(
      { ...updateBodyFor(edit, parsed.value), rowVersion: contact.rowVersion },
      {
        onSuccess: onClose,
        onError: (error) => {
          const failure = describeEditFailure(error, t);
          if (failure.conflict) {
            // Someone else saved first: read the contact again so the next save carries the new version.
            setNotice(t('contactProps.error.conflict'));
            void queryClient.invalidateQueries({ queryKey: contactKey(contact.id) });
            return;
          }
          setBanner(failure.banner);
          if (failure.field) setProblem({ where: 'main', message: failure.field });
        },
      },
    );
  };

  const mainProblem = problem?.where === 'main' ? problem.message : null;
  const timeProblem = problem?.where === 'time' ? problem.message : null;

  let body: ReactNode;
  if (kind === 'boolean') {
    body = (
      <View style={styles.switchRow}>
        <Text style={styles.grow}>{label}</Text>
        <Switch
          accessibilityLabel={label}
          value={draft.on}
          onValueChange={(on) => change({ on })}
          trackColor={{ false: colors.borderStrong, true: colors.primary }}
          thumbColor={colors.surface}
        />
      </View>
    );
  } else if (choosing) {
    const single = kind === 'single';
    const isPicked = (value: string) => draft.picked.includes(value);
    const toggle = (value: string) =>
      change({
        picked: single
          ? [value]
          : isPicked(value)
            ? draft.picked.filter((v) => v !== value)
            : [...draft.picked, value],
      });
    if (field?.options === undefined && fetched.isPending) {
      body = <ActivityIndicator accessibilityLabel={t('common.loading')} />;
    } else if (field?.options === undefined && fetched.isError) {
      body = (
        <View>
          <Banner tone="danger" message={messageForError(fetched.error, t)} />
          <Button
            variant="link"
            align="start"
            label={t('common.retry')}
            onPress={() => void fetched.refetch()}
          />
        </View>
      );
    } else if (options.length === 0) {
      body = <Text muted>{t('contactProps.editor.noOptions')}</Text>;
    } else {
      body = (
        <View accessibilityRole={single ? 'radiogroup' : undefined}>
          {options.map((option) => (
            <ChoiceRow
              key={option.id}
              label={option.label}
              role={single ? 'radio' : 'checkbox'}
              selected={isPicked(option.value)}
              onPress={() => toggle(option.value)}
            />
          ))}
          {single && !field?.isRequired && draft.picked.length > 0 ? (
            <Button
              variant="link"
              align="start"
              label={t('contactProps.clear')}
              onPress={() => change({ picked: [] })}
            />
          ) : null}
          {mainProblem ? (
            <Text variant="caption" danger accessibilityRole="alert">
              {mainProblem}
            </Text>
          ) : null}
        </View>
      );
    }
  } else if (kind === 'date' || kind === 'datetime') {
    const withTime = kind === 'datetime';
    body = (
      <>
        <TextField
          label={withTime ? t('contactProps.editor.date') : label}
          hint={t('contactProps.editor.dateHint')}
          value={draft.text}
          onChangeText={(text) => change({ text })}
          error={mainProblem}
          keyboardType="numbers-and-punctuation"
          autoCorrect={false}
          maxLength={10}
        />
        {withTime ? (
          <TextField
            label={t('contactProps.editor.time')}
            hint={t('contactProps.editor.timeHint')}
            value={draft.time}
            onChangeText={(time) => change({ time })}
            error={timeProblem}
            keyboardType="numbers-and-punctuation"
            autoCorrect={false}
            maxLength={5}
          />
        ) : null}
        {draft.text !== '' || draft.time !== '' ? (
          <Button
            variant="link"
            align="start"
            label={t('contactProps.clear')}
            onPress={() => change({ text: '', time: '' })}
          />
        ) : null}
      </>
    );
  } else {
    const fieldType =
      edit.kind === 'custom' ? edit.field.fieldType : edit.key === 'name' ? 'text' : edit.key;
    const isName = edit.kind === 'standard' && edit.key === 'name';
    body = (
      <TextField
        label={label}
        hint={fieldType === 'phone' ? t('contactProps.editor.phoneHint') : undefined}
        value={draft.text}
        onChangeText={(text) => change({ text })}
        error={mainProblem}
        keyboardType={keyboardFor(fieldType)}
        multiline={kind === 'longText'}
        numberOfLines={kind === 'longText' ? 4 : 1}
        autoCapitalize={isName ? 'words' : 'none'}
        autoCorrect={false}
        textContentType={edit.kind === 'standard' ? STANDARD_CONTENT[edit.key] : undefined}
      />
    );
  }

  return (
    <EditSheet
      title={t('contactProps.editor.title', { label })}
      onClose={onClose}
      onSave={save}
      saving={update.isPending}
    >
      {notice ? <Banner tone="warning" message={notice} /> : null}
      {banner ? <Banner tone="danger" message={banner} /> : null}
      {body}
    </EditSheet>
  );
}

const STANDARD_CONTENT = {
  name: 'name',
  email: 'emailAddress',
  phone: 'telephoneNumber',
} as const;

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '88%',
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.xs,
  },
  iconButton: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { flex: 1 },
  body: { padding: spacing.lg, gap: spacing.lg },
  grow: { flex: 1 },
  choice: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  switchRow: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
});
