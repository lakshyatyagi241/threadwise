import type { WspMember } from '@crm/contracts';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { formatMoment } from '@/lib/format/dates';
import { MIN_TOUCH_TARGET, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { primaryRole } from './member-rules';

interface Props {
  member: WspMember;
  isMe: boolean;
  /** Whether any action is open for this person (the dots show only then). */
  actionable: boolean;
  onMore: (member: WspMember) => void;
}

/** One member: avatar, name, email, role, and whether they are active, pending or inactive (with presence, and when they joined). */
function MemberRowBase({ member, isMe, actionable, onMore }: Props) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const role = primaryRole(member);
  const roleName =
    member.tier === 'custom'
      ? (role?.name ?? member.tier)
      : t(`settings.members.tiers.${member.tier}`);
  const state =
    member.status === 'pending'
      ? t('settings.members.pending')
      : member.status === 'inactive'
        ? t('settings.members.inactive')
        : t(`settings.members.presence.${member.presence}`);
  const joined = member.joinedAt ? formatMoment(member.joinedAt, i18n.language) : '';
  return (
    <View style={[styles.row, { borderBottomColor: colors.border }]}>
      <View
        accessible
        accessibilityLabel={`${member.fullName}, ${member.email}, ${roleName}, ${state}`}
        style={styles.main}
      >
        <Avatar name={member.fullName} size={44} />
        <View style={styles.text}>
          <View style={styles.head}>
            <Text variant="label" numberOfLines={1} style={styles.name}>
              {member.fullName}
            </Text>
            {isMe ? <Badge label={t('settings.members.you')} tone="info" /> : null}
          </View>
          <Text muted numberOfLines={1}>
            {member.email}
          </Text>
          <Text variant="caption" muted>
            {[roleName, state, joined].filter(Boolean).join(' · ')}
          </Text>
        </View>
      </View>
      {actionable ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('settings.members.actionsFor', { name: member.fullName })}
          onPress={() => onMore(member)}
          style={styles.more}
        >
          <Icon name="ellipsis-vertical" size={20} color="textMuted" />
        </Pressable>
      ) : null}
    </View>
  );
}

export const MemberRow = memo(MemberRowBase);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  main: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingStart: spacing.lg,
  },
  text: { flex: 1, gap: 2 },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { flexShrink: 1 },
  more: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
