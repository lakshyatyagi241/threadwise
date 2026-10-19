import type { LeadSourceResponse } from '@crm/contracts';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { formatMoment } from '@/lib/format/dates';
import { MIN_TOUCH_TARGET, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';

interface Props {
  source: LeadSourceResponse;
  onOpen: (id: string) => void;
}

/** One lead source in the list: its name and kind, whether it is active, when its last lead came and how many leads wait. */
function LeadSourceRowBase({ source, onOpen }: Props) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const last = source.lastEventAt
    ? formatMoment(source.lastEventAt, i18n.language)
    : t('leads.sources.noEvents');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={source.name}
      accessibilityHint={source.lastEventAt ? `${t('leads.detail.lastEvent')}: ${last}` : last}
      onPress={() => onOpen(source.id)}
      style={[styles.row, { borderBottomColor: colors.border }]}
    >
      <View style={styles.body}>
        <Text variant="body" numberOfLines={2}>
          {source.name}
        </Text>
        <Text variant="caption" muted numberOfLines={1}>
          {t(`leads.kinds.${source.kind}`)}
        </Text>
        <View style={styles.last}>
          <Icon name="time-outline" size={14} color="textMuted" />
          <Text variant="caption" muted numberOfLines={1}>
            {last}
          </Text>
        </View>
        <View style={styles.badges}>
          <Badge
            label={t(`leads.sourceStatus.${source.status}`)}
            tone={source.status === 'active' ? 'success' : 'warning'}
          />
          {source.needsAttention > 0 ? (
            <Badge
              label={t('leads.sources.needsAttention', { count: source.needsAttention })}
              tone="danger"
            />
          ) : null}
        </View>
      </View>
      <Icon name="chevron-forward" size={20} color="textMuted" />
    </Pressable>
  );
}

export const LeadSourceRow = memo(LeadSourceRowBase);

const styles = StyleSheet.create({
  row: {
    minHeight: MIN_TOUCH_TARGET + spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  body: { flex: 1, gap: spacing.xs },
  last: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingTop: spacing.xs },
});
