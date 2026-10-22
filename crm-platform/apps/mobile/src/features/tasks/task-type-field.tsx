import type { ActivityOptionRef } from '@crm/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { PickerField, PickerOption } from '@/components/ui/picker-row';
import { Text } from '@/components/ui/text';
import { radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { type TaskTypeChoice } from './task-validation';
import { useTaskTypes } from './use-tasks';

interface Props {
  value: TaskTypeChoice;
  /** The type the task holds now, so one that was since removed from the list still shows. */
  current: ActivityOptionRef | null;
  onChange: (value: TaskTypeChoice) => void;
}

/** "follow_up" is "Follow up": the word for a type of the workspace that has no translation. */
const humanKey = (key: string): string => {
  const words = key
    .replace(/^custom_/, '')
    .replace(/_/g, ' ')
    .trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
};

/**
 * The task type (Settings > Sales activities: Follow up, Call reminder, or the workspace's own), a dropdown under the contact. A
 * default type carries no name, so its word comes from the app's own translations. Nothing is drawn when the workspace offers no
 * types and the task has none; a type the task holds that was since removed stays in the list, marked, so saving keeps it.
 */
export function TaskTypeField({ value, current, onChange }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const types = useTaskTypes(true);
  const offered = types.data ?? [];
  const kept = current && !offered.some((o) => o.id === current.id) ? current : null;
  if (offered.length === 0 && !kept) return null;

  const nameOf = (o: { key: string; name: string | null }) =>
    o.name ?? t(`tasks.form.typeNames.${o.key}`, { defaultValue: humanKey(o.key) });
  const shown = offered.find((o) => o.id === value) ?? (kept && kept.id === value ? kept : null);
  const choose = (next: TaskTypeChoice) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <>
      <PickerField
        label={t('tasks.form.type')}
        value={shown ? nameOf(shown) : t('tasks.form.typePlaceholder')}
        placeholder={shown === null}
        onPress={() => setOpen(true)}
      />
      <Modal transparent visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={[styles.scrim, { backgroundColor: colors.scrim }]}>
          <View
            accessibilityViewIsModal
            style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <Text variant="heading" accessibilityRole="header">
              {t('tasks.form.type')}
            </Text>
            <ScrollView contentContainerStyle={styles.list} accessibilityRole="radiogroup">
              <PickerOption
                label={t('tasks.form.typeNone')}
                selected={value === null}
                onPress={() => choose(null)}
              />
              {kept ? (
                <PickerOption
                  label={`${nameOf(kept)} ${t('tasks.form.typeRemoved')}`}
                  selected={value === kept.id}
                  onPress={() => choose(kept.id)}
                />
              ) : null}
              {offered.map((o) => (
                <PickerOption
                  key={o.id}
                  label={nameOf(o)}
                  selected={value === o.id}
                  onPress={() => choose(o.id)}
                />
              ))}
            </ScrollView>
            <Button variant="link" label={t('tasks.cancel')} onPress={() => setOpen(false)} />
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
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
