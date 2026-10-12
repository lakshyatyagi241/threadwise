import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, type IconName } from '@/components/ui/icon';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Text } from '@/components/ui/text';
import { MIN_TOUCH_TARGET, radius, spacing, type ThemeColors } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';

/** The coloured pairs an icon tile is drawn in: the strong colour for the icon, its soft one behind it. */
export type SummaryTone = 'primary' | 'success' | 'warning' | 'instagram' | 'danger';
const SOFT: Record<SummaryTone, keyof ThemeColors> = {
  primary: 'primarySoft',
  success: 'successSoft',
  warning: 'warningSoft',
  instagram: 'instagramSoft',
  danger: 'dangerSoft',
};

/** A flat white card: a hairline edge and no shadow, as the Summary of the reference app draws its cards. */
function FlatCard({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {children}
    </View>
  );
}

interface StatProps {
  title: string;
  /** A second line under the title ("Handled by bot"). */
  subtitle?: string;
  /** The figure, already formatted; "—" when it could not be read. */
  value: string;
  icon: IconName;
  tone: SummaryTone;
  /** Makes the whole half a button and shows the arrow. */
  onPress?: () => void;
  /** What a screen reader says for the button; the title and figure are read when it is left out. */
  label?: string;
}

function Stat({ title, subtitle, value, icon, tone, onPress, label }: StatProps) {
  const { colors } = useTheme();
  const body = (
    <>
      <View style={styles.statTop}>
        <View style={styles.statTitles}>
          <Text variant="body" numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text variant="caption" muted numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {onPress ? <Icon name="chevron-forward" size={18} color="textMuted" /> : null}
      </View>
      <View style={styles.statBottom}>
        <Text variant="display" style={styles.value} numberOfLines={1}>
          {value}
        </Text>
        <View style={[styles.tile, { backgroundColor: colors[SOFT[tone]] }]}>
          <Icon name={icon} size={20} color={tone} />
        </View>
      </View>
    </>
  );
  return onPress ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label ?? `${title}${subtitle ? ` ${subtitle}` : ''}: ${value}`}
      onPress={onPress}
      style={styles.half}
    >
      {body}
    </Pressable>
  ) : (
    <View
      accessible
      accessibilityLabel={label ?? `${title}${subtitle ? ` ${subtitle}` : ''}: ${value}`}
      style={styles.half}
    >
      {body}
    </View>
  );
}

/** Two figures side by side in one card, with a dotted line between them. */
export function PairCard({ left, right }: { left: StatProps; right: StatProps }) {
  const { colors } = useTheme();
  return (
    <FlatCard>
      <View style={styles.pair}>
        <Stat {...left} />
        <View style={[styles.divider, { borderColor: colors.borderStrong }]} />
        <Stat {...right} />
      </View>
    </FlatCard>
  );
}

interface TitledProps {
  title: string;
  /** The figure at the far end of the title line (the total). */
  trailing?: string;
  /** What the card is counting, in a few words, under the title. */
  note?: string;
  children: ReactNode;
}

/** A card with a short coloured bar before its title, the total at the other end, and a rule under the heading. */
export function TitledCard({ title, trailing, note, children }: TitledProps) {
  const { colors } = useTheme();
  return (
    <FlatCard>
      <View style={styles.titleRow}>
        <View style={[styles.bar, { backgroundColor: colors.primary }]} />
        <View style={styles.statTitles}>
          <Text variant="subheading" accessibilityRole="header" numberOfLines={1}>
            {title}
          </Text>
          {note ? (
            <Text variant="caption" muted>
              {note}
            </Text>
          ) : null}
        </View>
        {trailing ? <Text variant="subheading">{trailing}</Text> : null}
      </View>
      <View style={[styles.rule, { backgroundColor: colors.border }]} />
      {children}
    </FlatCard>
  );
}

export interface GridItem {
  key: string;
  icon: IconName;
  label: string;
  value: string;
  onPress?: () => void;
}

/** Tiles in rows of three: a boxed icon, the name, and the count under it. */
export function StatusGrid({ items }: { items: readonly GridItem[] }) {
  const { colors } = useTheme();
  return (
    <View style={styles.grid}>
      {items.map((item) => {
        const content = (
          <>
            <View
              style={[
                styles.gridIcon,
                { borderColor: colors.border, backgroundColor: colors.primarySoft },
              ]}
            >
              <Icon name={item.icon} size={22} color="primary" />
            </View>
            <Text variant="caption" numberOfLines={1} style={styles.center}>
              {item.label}
            </Text>
            <Text variant="label" style={styles.center}>
              {item.value}
            </Text>
          </>
        );
        return item.onPress ? (
          <Pressable
            key={item.key}
            accessibilityRole="button"
            accessibilityLabel={`${item.label}: ${item.value}`}
            onPress={item.onPress}
            style={styles.gridItem}
          >
            {content}
          </Pressable>
        ) : (
          <View
            key={item.key}
            accessible
            accessibilityLabel={`${item.label}: ${item.value}`}
            style={styles.gridItem}
          >
            {content}
          </View>
        );
      })}
    </View>
  );
}

export interface BarItem {
  key: string;
  label: string;
  value: number;
  /** The figure as written ("1,250"). */
  text: string;
  tone: 'primary' | 'success' | 'danger' | 'warning';
}

/** One row per figure: the name and the number on one line, a bar under them sized against the largest. */
export function BarRows({ items }: { items: readonly BarItem[] }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <View style={styles.bars}>
      {items.map((item) => (
        <View
          key={item.key}
          style={styles.barRow}
          accessible
          accessibilityLabel={`${item.label}: ${item.text}`}
        >
          <View style={styles.barLine}>
            <Text variant="body">{item.label}</Text>
            <Text variant="label">{item.text}</Text>
          </View>
          <ProgressBar percent={(item.value / max) * 100} tone={item.tone} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.lg,
    gap: spacing.md,
  },
  pair: { flexDirection: 'row', alignItems: 'stretch' },
  half: { flex: 1, minHeight: MIN_TOUCH_TARGET, gap: spacing.md, paddingHorizontal: spacing.xs },
  divider: { borderLeftWidth: 1, borderStyle: 'dotted', marginHorizontal: spacing.md },
  statTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  statTitles: { flex: 1 },
  statBottom: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  value: { flexShrink: 1 },
  tile: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  bar: { width: 4, alignSelf: 'stretch', borderRadius: 2, minHeight: 24 },
  rule: { height: StyleSheet.hairlineWidth },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.lg },
  gridItem: {
    width: '33.333%',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: MIN_TOUCH_TARGET,
  },
  gridIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: { textAlign: 'center' },
  bars: { gap: spacing.lg },
  barRow: { gap: spacing.sm },
  barLine: { flexDirection: 'row', justifyContent: 'space-between' },
});
