import type { WspTeam } from '@crm/contracts';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { MIN_TOUCH_TARGET, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { LabelDot } from './label-dot';
import { onlineCount } from './team-rules';

interface Props {
  team: WspTeam;
  /** Whether the pencil shows (the person may manage teams). */
  canEdit: boolean;
  onEdit: (team: WspTeam) => void;
}

/** One team: its colour, name, how it assigns, how many members (and how many are online), and the devices it is limited to. */
function TeamCardBase({ team, canEdit, onEdit }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const online = onlineCount(team);
  const members = t('settings.teams.members', { count: team.members.length });
  const strategy = t(`settings.teams.strategies.${team.assignmentStrategy}`);
  const onlineText = online > 0 ? t('settings.teams.online', { count: online }) : '';
  const devices =
    team.deviceIds.length > 0 ? t('settings.teams.devices', { count: team.deviceIds.length }) : '';
  return (
    <View style={[styles.row, { borderBottomColor: colors.border }]}>
      <View
        accessible
        accessibilityLabel={[team.name, strategy, members, onlineText, devices]
          .filter(Boolean)
          .join(', ')}
        style={styles.main}
      >
        <LabelDot color={team.color} size={14} />
        <View style={styles.text}>
          <View style={styles.head}>
            <Text variant="label" numberOfLines={1} style={styles.name}>
              {team.name}
            </Text>
            {team.isDefault ? <Badge label={t('settings.teams.default')} tone="info" /> : null}
          </View>
          <Text muted>{strategy}</Text>
          <Text variant="caption">
            {members}
            {onlineText ? (
              <Text variant="caption" color="success">
                {` · ${onlineText}`}
              </Text>
            ) : null}
          </Text>
          {devices ? (
            <Text variant="caption" muted>
              {devices}
            </Text>
          ) : null}
        </View>
      </View>
      {canEdit ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('settings.teams.editFor', { name: team.name })}
          onPress={() => onEdit(team)}
          style={styles.edit}
        >
          <Icon name="create-outline" size={20} color="textMuted" />
        </Pressable>
      ) : null}
    </View>
  );
}

export const TeamCard = memo(TeamCardBase);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  main: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingStart: spacing.lg,
  },
  text: { flex: 1, gap: 2 },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { flexShrink: 1 },
  edit: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
