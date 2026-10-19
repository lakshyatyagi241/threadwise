import type { WspMember, WspMembersSummary } from '@crm/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Icon, type IconName } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import {
  canChangeRole,
  canRemove,
  canReset,
  canResend,
  primaryRole,
  roleOptions,
} from './member-rules';

interface Props {
  /** The member whose actions are offered; the sheet is closed when there is none. */
  member: WspMember | null;
  summary: WspMembersSummary;
  onChangeRole: (member: WspMember, roleId: string) => void;
  onResend: (member: WspMember) => void;
  onReset: (member: WspMember) => void;
  onRemove: (member: WspMember) => void;
  onClose: () => void;
}

/**
 * What can be done to one member, in a sheet that rises from the bottom: Change role (opens the list of roles the person may give),
 * Resend invite (a pending member), Reset password, Remove. Only what the person may do is offered, by the web's own rules (`member-rules`).
 */
export function MemberActionsSheet({
  member,
  summary,
  onChangeRole,
  onResend,
  onReset,
  onRemove,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [choosing, setChoosing] = useState(false);
  const me = summary.me;
  const close = () => {
    setChoosing(false);
    onClose();
  };
  const current = member ? primaryRole(member) : undefined;

  return (
    <Modal transparent visible={member !== null} animationType="slide" onRequestClose={close}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('settings.members.cancel')}
        style={[styles.scrim, { backgroundColor: colors.scrim }]}
        onPress={close}
      >
        <View
          accessibilityViewIsModal
          style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Text variant="label" muted numberOfLines={1} style={styles.heading}>
            {member?.fullName}
          </Text>
          {member && !choosing ? (
            <>
              {canChangeRole(member, me) ? (
                <Action
                  icon="swap-horizontal-outline"
                  label={t('settings.members.changeRole')}
                  onPress={() => setChoosing(true)}
                />
              ) : null}
              {canResend(member, me) ? (
                <Action
                  icon="mail-outline"
                  label={t('settings.members.resendAction')}
                  onPress={() => {
                    close();
                    onResend(member);
                  }}
                />
              ) : null}
              {canReset(member, me) ? (
                <Action
                  icon="key-outline"
                  label={t('settings.members.resetAction')}
                  onPress={() => {
                    close();
                    onReset(member);
                  }}
                />
              ) : null}
              {canRemove(member, me) ? (
                <Action
                  icon="person-remove-outline"
                  label={t('settings.members.removeAction')}
                  danger
                  onPress={() => {
                    close();
                    onRemove(member);
                  }}
                />
              ) : null}
            </>
          ) : null}
          {member && choosing ? (
            <ScrollView style={styles.roles}>
              {roleOptions(summary.roles, current).map((role) => (
                <Pressable
                  key={role.id}
                  accessibilityRole="radio"
                  accessibilityLabel={
                    role.tier === 'custom' ? role.name : t(`settings.members.tiers.${role.tier}`)
                  }
                  accessibilityState={{
                    selected: role.id === current?.id,
                    disabled: role.disabled,
                  }}
                  disabled={role.disabled}
                  onPress={() => {
                    close();
                    if (role.id !== current?.id) onChangeRole(member, role.id);
                  }}
                  style={[styles.action, role.disabled && styles.faded]}
                >
                  <Icon
                    name={role.id === current?.id ? 'radio-button-on' : 'radio-button-off'}
                    size={22}
                    color={role.id === current?.id ? 'primary' : 'textMuted'}
                  />
                  <Text>
                    {role.tier === 'custom' ? role.name : t(`settings.members.tiers.${role.tier}`)}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}
        </View>
      </Pressable>
    </Modal>
  );
}

function Action({
  icon,
  label,
  danger,
  onPress,
}: {
  icon: IconName;
  label: string;
  danger?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.action}
    >
      <Icon name={icon} size={22} color={danger ? 'danger' : 'text'} />
      <Text color={danger ? 'danger' : 'text'}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingBottom: spacing.xl,
    maxHeight: '70%',
  },
  heading: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm },
  roles: { flexGrow: 0 },
  action: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  faded: { opacity: 0.45 },
});
