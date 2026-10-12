import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { PickerField, PickerOption } from './picker-row';
import type { AssigneeChoice } from './task-validation';
import { useAssignees } from './use-tasks';

interface Props {
  value: AssigneeChoice;
  onChange: (value: AssigneeChoice) => void;
  /** The person may read contacts, which is where the API keeps the list of the team. Without it only "Me" and "Unassigned" are offered. */
  canListTeam: boolean;
  /** The signed-in person, so they are not listed twice. */
  myId: string | undefined;
}

/** Who the task is for: "Me" (the default), nobody, or a member of the team chosen from a list. */
export function OwnerField({ value, onChange, canListTeam, myId }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const team = useAssignees(canListTeam && open);
  const shown =
    value.kind === 'me'
      ? t('tasks.form.ownerMe')
      : value.kind === 'none'
        ? t('tasks.form.ownerNone')
        : value.name;

  const choose = (next: AssigneeChoice) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <>
      <PickerField label={t('tasks.form.owner')} value={shown} onPress={() => setOpen(true)} />
      <Modal transparent visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={[styles.scrim, { backgroundColor: colors.scrim }]}>
          <View
            accessibilityViewIsModal
            style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <Text variant="heading" accessibilityRole="header">
              {t('tasks.form.ownerPick')}
            </Text>
            <ScrollView contentContainerStyle={styles.list} accessibilityRole="radiogroup">
              <PickerOption
                label={t('tasks.form.ownerMe')}
                selected={value.kind === 'me'}
                onPress={() => choose({ kind: 'me' })}
              />
              <PickerOption
                label={t('tasks.form.ownerNone')}
                selected={value.kind === 'none'}
                onPress={() => choose({ kind: 'none' })}
              />
              {team.data
                ?.filter((member) => member.id !== myId)
                .map((member) => (
                  <PickerOption
                    key={member.id}
                    label={member.fullName}
                    caption={member.email}
                    selected={value.kind === 'user' && value.id === member.id}
                    onPress={() => choose({ kind: 'user', id: member.id, name: member.fullName })}
                  />
                ))}
              {canListTeam && team.isPending ? (
                <View accessible accessibilityLabel={t('tasks.form.ownerLoading')}>
                  <ActivityIndicator />
                </View>
              ) : null}
              {team.isError ? (
                <View style={styles.failed}>
                  <Text danger accessibilityRole="alert">
                    {t('tasks.form.ownerFailed')}
                  </Text>
                  <Button
                    variant="secondary"
                    label={t('common.retry')}
                    onPress={() => void team.refetch()}
                  />
                </View>
              ) : null}
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
  failed: { gap: spacing.sm, paddingVertical: spacing.sm },
});
