import type { DealStatus } from '@crm/contracts';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Text } from '@/components/ui/text';
import { spacing } from '@/lib/theme/tokens';

const DOT = 10;

/** The colour of a stage is the workspace's own (a hex value kept with the stage), so it is data, not a theme colour. */
export function StageDot({ color }: { color: string }) {
  return <View accessible={false} style={[styles.dot, { backgroundColor: color }]} />;
}

/** A stage's name beside its colour dot. */
export function StageLabel({ name, color }: { name: string; color: string }) {
  return (
    <View style={styles.stage}>
      <StageDot color={color} />
      <Text variant="caption" numberOfLines={1} style={styles.stageName}>
        {name}
      </Text>
    </View>
  );
}

const STATUS_TONE: Record<DealStatus, BadgeTone> = {
  open: 'info',
  won: 'success',
  lost: 'danger',
};

/** Open, Won or Lost as a pill. */
export function StatusBadge({ status }: { status: DealStatus }) {
  const { t } = useTranslation();
  return <Badge tone={STATUS_TONE[status]} label={t(`deals.status.${status}`)} />;
}

const styles = StyleSheet.create({
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2 },
  stage: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  stageName: { flexShrink: 1 },
});
