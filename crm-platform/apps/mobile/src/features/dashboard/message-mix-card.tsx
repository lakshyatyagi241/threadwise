import type { MessageHistoryInsights } from '@crm/contracts';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { formatCount } from '@/lib/format/numbers';
import { radius, spacing, type ThemeColors } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { TitledCard } from './summary-cards';

export type MessageMix = MessageHistoryInsights['typeMix'];

/** The six kinds of the web's "By message type", in its order, each with the colour of its slice of the bar. */
const KINDS: ReadonlyArray<{
  key: keyof MessageMix;
  color: keyof ThemeColors;
  label:
    | 'summary.messageMix.text'
    | 'summary.messageMix.autoReply'
    | 'summary.messageMix.campaign'
    | 'summary.messageMix.broadcast'
    | 'summary.messageMix.scheduled'
    | 'inbox.row.media';
}> = [
  { key: 'text', color: 'chartSent', label: 'summary.messageMix.text' },
  { key: 'autoReply', color: 'chartDelivered', label: 'summary.messageMix.autoReply' },
  { key: 'campaign', color: 'success', label: 'summary.messageMix.campaign' },
  { key: 'broadcast', color: 'warning', label: 'summary.messageMix.broadcast' },
  { key: 'scheduled', color: 'instagram', label: 'summary.messageMix.scheduled' },
  { key: 'media', color: 'textMuted', label: 'inbox.row.media' },
];

/** A figure that could not be read shows as a dash, never as a zero. */
const DASH = '—';

/**
 * "Message by categories" of the Geta app's Summary: the window's messages by what they are (plain text, auto-reply, campaign,
 * broadcast, scheduled, media) as one bar split in proportion, the total on the title line and one row per kind under it. The Geta
 * app draws a ring; the app has no drawing library, so the same split is a bar (as on the Bot view). `mix` is undefined until the
 * numbers arrive or when they cannot be read, and then every figure is a dash.
 */
export function MessageMixCard({
  mix,
  rangeName,
}: {
  mix: MessageMix | undefined;
  rangeName: string;
}) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const total = mix ? KINDS.reduce((sum, kind) => sum + mix[kind.key], 0) : 0;
  const count = (value: number | undefined) =>
    value === undefined ? DASH : formatCount(value, i18n.language);
  return (
    <TitledCard
      title={t('summary.messageMix.title')}
      note={rangeName}
      trailing={mix ? count(total) : DASH}
    >
      {/* The rows below say the same in words, so the bar is not read out. */}
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.bar, { backgroundColor: colors.border }]}
      >
        {mix && total > 0
          ? KINDS.map((kind) =>
              mix[kind.key] > 0 ? (
                <View
                  key={kind.key}
                  style={{ flex: mix[kind.key], backgroundColor: colors[kind.color] }}
                />
              ) : null,
            )
          : null}
      </View>
      <View style={styles.rows}>
        {KINDS.map((kind) => {
          const label = t(kind.label);
          const value = count(mix?.[kind.key]);
          return (
            <View
              key={kind.key}
              accessible
              accessibilityLabel={`${label}: ${value}`}
              style={styles.row}
            >
              <View style={[styles.dot, { backgroundColor: colors[kind.color] }]} />
              <Text style={styles.label} numberOfLines={1}>
                {label}
              </Text>
              <Text variant="subheading">{value}</Text>
            </View>
          );
        })}
      </View>
    </TitledCard>
  );
}

const styles = StyleSheet.create({
  bar: { height: 20, flexDirection: 'row', borderRadius: radius.pill, overflow: 'hidden' },
  rows: { gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  dot: { width: 14, height: 14, borderRadius: radius.pill },
  label: { flex: 1 },
});
