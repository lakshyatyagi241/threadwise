import type { ConversationAssignment } from '@crm/contracts';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { MIN_TOUCH_TARGET, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';

interface Props {
  assignment: ConversationAssignment;
  /** The signed-in person, to tell "you" from a colleague. */
  meId: string;
  /** The person may take the conversation (`assign_self` or `assign`). */
  canClaim: boolean;
  assigning: boolean;
  onAssignToMe: () => void;
}

/**
 * The line above the message box: who has this conversation ("Assigned to Asha Verma", "Assigned to you", the team, or "Not
 * assigned") and, when it is not yours and you may take it, **Assign to me**. The box stays usable (the web inbox lets anyone with the
 * right reply), so this is how an agent sees whether they are the one answering.
 */
export function AssignmentStrip({ assignment, meId, canClaim, assigning, onAssignToMe }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const mine = assignment.user?.id === meId;
  const text = assignment.user
    ? mine
      ? t('inbox.thread.assignment.you')
      : t('inbox.thread.assignment.to', {
          name: assignment.user.name ?? t('inbox.details.unassigned'),
        })
    : assignment.team
      ? t('inbox.thread.assignment.team', { name: assignment.team.name })
      : t('inbox.thread.assignment.none');

  return (
    <View
      testID="assignment-strip"
      style={[styles.strip, { backgroundColor: colors.surface, borderTopColor: colors.border }]}
    >
      <Icon name="person-outline" size={18} color="textMuted" />
      <Text variant="caption" muted numberOfLines={1} style={styles.text}>
        {text}
      </Text>
      {!mine && canClaim ? (
        <Button
          variant="link"
          label={t('inbox.thread.menu.assignToMe')}
          loading={assigning}
          onPress={onAssignToMe}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  text: { flex: 1 },
});
