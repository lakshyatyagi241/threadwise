import type { TaskOutcomeRef, TaskOutcomeResponse } from '@crm/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/button';
import { PickerOption } from '@/components/ui/picker-row';
import { SelectField } from '@/components/ui/select-field';
import { Text } from '@/components/ui/text';
import { radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';

type Offered = Pick<TaskOutcomeResponse, 'id' | 'name'>;

interface FieldProps {
  /** The outcomes the workspace offers, in its order. */
  outcomes: readonly Offered[];
  /** The picked outcome id, or null for none. */
  value: string | null;
  /** The outcome the task holds now, so one hidden since still shows. */
  current: TaskOutcomeRef | null;
  onChange: (value: string | null) => void;
}

/** The value of the "No outcome" row; a real outcome is a uuid, so it never collides. */
const NONE = '';

/**
 * The outcome of a task (Settings > Task outcomes: Interested, Left message, ...), a dropdown on the Add/Edit task form. Nothing is
 * drawn when the workspace offers no outcome and the task has none; an outcome the task holds that was since hidden stays in the
 * list, marked, so saving keeps it.
 */
export function OutcomeField({ outcomes, value, current, onChange }: FieldProps) {
  const { t } = useTranslation();
  const kept = current && !outcomes.some((o) => o.id === current.id) ? current : null;
  if (outcomes.length === 0 && !kept) return null;
  return (
    <View style={styles.group}>
      <Text variant="label">{t('tasks.outcome.label')}</Text>
      <SelectField
        label={t('tasks.outcome.label')}
        placeholder={t('tasks.outcome.placeholder')}
        value={value ?? undefined}
        onChange={(v) => onChange(v === NONE ? null : v)}
        options={[
          { value: NONE, label: t('tasks.outcome.none') },
          ...(kept
            ? [{ value: kept.id, label: t('tasks.outcome.hiddenName', { name: kept.name }) }]
            : []),
          ...outcomes.map((o) => ({ value: o.id, label: o.name })),
        ]}
      />
    </View>
  );
}

interface SheetProps {
  /** The task being completed (its title is shown); the sheet is closed when there is none. */
  title: string | null;
  outcomes: readonly Offered[];
  pending?: boolean;
  /** Called with the outcome picked, or null for none. */
  onConfirm: (outcomeId: string | null) => void;
  onCancel: () => void;
}

/**
 * "Mark as complete" with an outcome: a sheet listing the workspace's outcomes (and "No outcome") that completes the task with the
 * one picked. Shown only when the workspace has outcomes to pick from; otherwise a task is completed in one tap.
 */
export function CompleteTaskSheet({ title, outcomes, pending, onConfirm, onCancel }: SheetProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [picked, setPicked] = useState<string | null>(null);
  const visible = title !== null;
  const close = () => {
    setPicked(null);
    onCancel();
  };
  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={close}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('tasks.cancel')}
        style={[styles.scrim, { backgroundColor: colors.scrim }]}
        onPress={close}
      >
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
          <Text variant="heading" accessibilityRole="header">
            {t('tasks.details.markComplete')}
          </Text>
          <Text variant="label" muted numberOfLines={1}>
            {title}
          </Text>
          <Text variant="label">{t('tasks.outcome.label')}</Text>
          <ScrollView contentContainerStyle={styles.list} accessibilityRole="radiogroup">
            <PickerOption
              label={t('tasks.outcome.none')}
              selected={picked === null}
              onPress={() => setPicked(null)}
            />
            {outcomes.map((o) => (
              <PickerOption
                key={o.id}
                label={o.name}
                selected={picked === o.id}
                onPress={() => setPicked(o.id)}
              />
            ))}
          </ScrollView>
          <Button
            label={t('tasks.outcome.completeTitle')}
            loading={pending}
            onPress={() => {
              onConfirm(picked);
              setPicked(null);
            }}
          />
          <Button variant="link" label={t('tasks.cancel')} onPress={close} />
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.sm },
  scrim: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '80%',
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.lg,
    gap: spacing.md,
  },
  list: { gap: spacing.xs },
});
