import type { DashSummaryResponse } from '@crm/contracts';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { FadeIn } from '@/components/ui/fade-in';
import { Text } from '@/components/ui/text';
import { radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { greetingKey, longDate } from './format';
import { useNow } from './use-now';

interface Props {
  name: string;
  timezone: string;
  now: Date;
  /** Campaigns sending right now (the second half of the greeting). */
  running: number;
  summary: DashSummaryResponse | undefined;
  /** The Devices card exists: the line under the greeting counts connected devices only then. */
  showDevices: boolean;
  devicesOnline: number;
  /** The long name of the window ("Last 7 days"). */
  rangeName: string;
  /** When the summary last arrived (ms since 1970); 0 before the first answer. */
  updatedAt: number;
}

/** What goes in the brand band of the dashboard (TW-DASH-001): the kicker with the live chip, the greeting and the one-line state of the day. */
export function DashboardHeader({
  name,
  timezone,
  now,
  running,
  summary,
  showDevices,
  devicesOnline,
  rangeName,
  updatedAt,
}: Props) {
  const { t, i18n } = useTranslation();
  const date = longDate(now, i18n.language, timezone);
  const line = summary
    ? showDevices
      ? t('dashboard.subline', {
          date,
          range: rangeName,
          sent: summary.current.sent,
          rate: summary.current.deliverability,
          count: devicesOnline,
        })
      : t('dashboard.sublineOfficial', {
          date,
          range: rangeName,
          sent: summary.current.sent,
          rate: summary.current.deliverability,
        })
    : null;
  return (
    <FadeIn style={styles.stack}>
      <View style={styles.kickerRow}>
        <Text variant="caption" color="onBrandMuted" style={styles.kicker}>
          {t('dashboard.kicker')}
        </Text>
        {updatedAt > 0 ? <LiveChip updatedAt={updatedAt} /> : null}
      </View>
      <Text variant="title" color="onBrand" accessibilityRole="header">
        {t(`dashboard.greeting.${greetingKey(now, timezone)}`, { name })}{' '}
        <Text variant="title" color="brandAccent">
          {running > 0 ? t('dashboard.running', { count: running }) : t('dashboard.calm')}
        </Text>
      </Text>
      {line ? <Text color="onBrandMuted">{line}</Text> : null}
    </FadeIn>
  );
}

/** "Live · synced 12s ago": ticks every second so the person can see the numbers are fresh. */
function LiveChip({ updatedAt }: { updatedAt: number }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const now = useNow(1000);
  const seconds = Math.max(0, Math.round((now.getTime() - updatedAt) / 1000));
  return (
    <View testID="live-chip" style={styles.chip}>
      <View style={[styles.dot, { backgroundColor: colors.brandAccent }]} />
      <Text variant="caption" color="onBrandMuted">
        {t('dashboard.synced', { s: seconds })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md },
  kickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    columnGap: spacing.md,
    rowGap: spacing.xs,
  },
  kicker: { textTransform: 'uppercase', letterSpacing: 1.5 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  dot: { width: 8, height: 8, borderRadius: radius.pill },
});
