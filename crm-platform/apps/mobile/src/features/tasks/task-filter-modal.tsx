import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import {
  DEFAULT_STATUS,
  DUE_CHOICES,
  NO_CHOICES,
  OWNER_CHOICES,
  PRIORITY_CHOICES,
  STATUS_CHOICES,
  cleanChoices,
  defaultOwner,
  type TaskChoices,
} from './filters';

interface Props {
  choices: TaskChoices;
  /** The contact whose tasks are listed, or '' for My tasks: it decides which owner is the default. */
  contactId: string;
  onApply: (choices: TaskChoices) => void;
  onClose: () => void;
}

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: selected ? colors.primarySoft : colors.surface,
          borderColor: selected ? colors.primary : colors.borderStrong,
        },
      ]}
    >
      <Text variant="label" color={selected ? 'primary' : 'text'}>
        {label}
      </Text>
    </Pressable>
  );
}

function Group({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <View
      testID={`task-filter-${id}`}
      style={styles.group}
      accessibilityRole="radiogroup"
      accessibilityLabel={title}
    >
      <Text variant="label" muted>
        {title}
      </Text>
      <View style={styles.chips}>{children}</View>
    </View>
  );
}

/**
 * The filters of the task list, in a sheet: status, priority, due and owner, one choice each. Pressing the chosen chip again
 * clears the group (back to its default). Nothing changes on the list until "Apply"; "Clear all" empties the sheet and applies.
 * The screen mounts it fresh each time it opens, so it starts from what is applied.
 */
export function TaskFilterModal({ choices, contactId, onApply, onClose }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [draft, setDraft] = useState<TaskChoices>(choices);

  const pick = <K extends keyof TaskChoices>(key: K, value: NonNullable<TaskChoices[K]>) =>
    setDraft((d) => ({ ...d, [key]: d[key] === value ? undefined : value }));

  const status = draft.status ?? DEFAULT_STATUS;
  const owner = draft.owner ?? defaultOwner(contactId);
  return (
    <Modal transparent visible animationType="slide" onRequestClose={onClose}>
      <View style={[styles.scrim, { backgroundColor: colors.scrim }]}>
        <View
          accessibilityViewIsModal
          style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Text variant="heading" accessibilityRole="header">
            {t('tasks.filter.title')}
          </Text>
          <ScrollView contentContainerStyle={styles.body}>
            <Group id="status" title={t('tasks.filter.group.status')}>
              {STATUS_CHOICES.map((value) => (
                <Chip
                  key={value}
                  label={t(`tasks.filter.status.${value}`)}
                  selected={status === value}
                  onPress={() => pick('status', value)}
                />
              ))}
            </Group>
            <Group id="priority" title={t('tasks.filter.group.priority')}>
              {PRIORITY_CHOICES.map((value) => (
                <Chip
                  key={value}
                  label={t(`tasks.priority.${value}`)}
                  selected={draft.priority === value}
                  onPress={() => pick('priority', value)}
                />
              ))}
            </Group>
            <Group id="due" title={t('tasks.filter.group.due')}>
              {DUE_CHOICES.map((value) => (
                <Chip
                  key={value}
                  label={t(`tasks.filter.due.${value}`)}
                  selected={draft.due === value}
                  onPress={() => pick('due', value)}
                />
              ))}
            </Group>
            <Group id="owner" title={t('tasks.filter.group.owner')}>
              {OWNER_CHOICES.map((value) => (
                <Chip
                  key={value}
                  label={t(`tasks.filter.owner.${value}`)}
                  selected={owner === value}
                  onPress={() => pick('owner', value)}
                />
              ))}
            </Group>
          </ScrollView>
          <View style={styles.actions}>
            <Button
              variant="secondary"
              label={t('tasks.filter.clear')}
              onPress={() => onApply(NO_CHOICES)}
            />
            <Button
              label={t('tasks.filter.apply')}
              onPress={() => onApply(cleanChoices(draft, contactId))}
            />
            <Button variant="link" label={t('tasks.cancel')} onPress={onClose} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '90%',
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.lg,
    gap: spacing.lg,
  },
  body: { gap: spacing.xl },
  group: { gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1.5,
  },
  actions: { gap: spacing.sm },
});
