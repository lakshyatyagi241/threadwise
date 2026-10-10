import { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Text } from '@/components/ui/text';
import { barLength, compact, niceMax } from '@/lib/format/numbers';
import { radius, spacing, type ThemeColors } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';

const PLOT_HEIGHT = 140;
const GUTTER = 36;
/** Below this width a bucket cannot hold one bar per series, so the series are drawn on top of each other instead. */
const MIN_GROUPED_COLUMN = 14;

export interface BarSeries {
  name: string;
  values: readonly number[];
  color: keyof ThemeColors;
}

interface Props {
  /** One label per bucket; only a few are shown, spread across the axis. */
  labels: readonly string[];
  series: readonly BarSeries[];
  /** The chart in one sentence, for screen readers. The bars are hidden from them. */
  summary: string;
}

/** The labels worth printing under the axis: the first, the last and a few between, so they never touch. */
export function axisLabelIndexes(count: number, slots: number): number[] {
  if (count <= 0) return [];
  if (count <= slots) return Array.from({ length: count }, (_, i) => i);
  const step = (count - 1) / (slots - 1);
  return Array.from({ length: slots }, (_, i) => Math.round(i * step));
}

/**
 * Bars per bucket: sent, delivered and failed side by side when there is room, drawn over each other (the largest behind) when
 * there are too many buckets for that. Two gridlines carry the scale. It always fits the card: it never scrolls sideways.
 */
export function BarChart({ labels, series, summary }: Props) {
  const { colors } = useTheme();
  const [plotWidth, setPlotWidth] = useState(0);
  const count = labels.length;
  const top = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  const column = count > 0 ? plotWidth / count : 0;
  const grouped = column >= MIN_GROUPED_COLUMN;
  const shown = new Set(axisLabelIndexes(count, 4));

  const onLayout = (event: LayoutChangeEvent) => setPlotWidth(event.nativeEvent.layout.width);

  return (
    <View accessible accessibilityRole="image" accessibilityLabel={summary} style={styles.root}>
      <View style={styles.plotRow}>
        <View style={styles.scale}>
          <Text variant="caption" muted>
            {compact(top)}
          </Text>
          <Text variant="caption" muted>
            {compact(top / 2)}
          </Text>
          <Text variant="caption" muted>
            {compact(0)}
          </Text>
        </View>
        <View testID="bar-plot" style={styles.plot} onLayout={onLayout}>
          <View style={[styles.gridline, { top: 0, backgroundColor: colors.border }]} />
          <View
            style={[styles.gridline, { top: PLOT_HEIGHT / 2, backgroundColor: colors.border }]}
          />
          <View
            style={[
              styles.gridline,
              { top: PLOT_HEIGHT - 1, backgroundColor: colors.borderStrong },
            ]}
          />
          <View style={styles.columns}>
            {labels.map((label, index) => (
              <View key={`${label}-${index}`} style={styles.column}>
                <View style={grouped ? styles.group : styles.stack}>
                  {series.map((s) => (
                    <View
                      key={s.name}
                      style={[
                        grouped ? styles.groupedBar : styles.stackedBar,
                        {
                          height: barLength(s.values[index] ?? 0, top, PLOT_HEIGHT),
                          backgroundColor: colors[s.color],
                        },
                      ]}
                    />
                  ))}
                </View>
              </View>
            ))}
          </View>
        </View>
      </View>
      <View style={styles.axis}>
        {labels.map((label, index) => (
          <View key={`${label}-${index}`} style={styles.axisSlot}>
            {shown.has(index) ? (
              <Text variant="caption" muted numberOfLines={1} style={styles.axisLabel}>
                {label}
              </Text>
            ) : null}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.xs },
  plotRow: { flexDirection: 'row' },
  scale: { width: GUTTER, height: PLOT_HEIGHT, justifyContent: 'space-between' },
  plot: { flex: 1, height: PLOT_HEIGHT },
  gridline: { position: 'absolute', start: 0, end: 0, height: 1 },
  columns: { flexDirection: 'row', height: PLOT_HEIGHT },
  column: { flex: 1, height: PLOT_HEIGHT, justifyContent: 'flex-end', paddingHorizontal: 1 },
  group: { flexDirection: 'row', alignItems: 'flex-end', gap: 1, height: PLOT_HEIGHT },
  groupedBar: { flex: 1, borderTopLeftRadius: radius.sm / 2, borderTopRightRadius: radius.sm / 2 },
  stack: { height: PLOT_HEIGHT, justifyContent: 'flex-end' },
  stackedBar: { position: 'absolute', bottom: 0, start: 0, end: 0 },
  axis: { flexDirection: 'row', marginStart: GUTTER },
  axisSlot: { flex: 1, alignItems: 'center' },
  // A label is wider than its slot: it is allowed to spill over the empty slots beside it.
  axisLabel: { width: 64, textAlign: 'center' },
});
