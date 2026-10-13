import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  I18nManager,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/button';
import { CalendarRange } from '@/components/ui/calendar-range';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import {
  DEFAULT_PRESET,
  MAX_SPAN_DAYS,
  isValidRange,
  presetOf,
  presetRange,
  type DateRange,
  type Preset,
} from './date-range';

/** The order the chips are offered in: the longer windows first, then the single days. */
const CHIPS: readonly Preset[] = ['last7', 'last30', 'last90', 'yesterday', 'today'];

/** What the sheet is editing: both ends, or only the first while the second day is still to be pressed. */
interface Selection {
  from: string | null;
  to: string | null;
}

/** "2026-09-13 → 2026-10-12", the arrow turned around where text runs right to left. */
function Dates({
  from,
  to,
  tail = '',
  color,
}: {
  from: string;
  /** The last day; null while it is still to be chosen, and `tail` says so in its place. */
  to: string | null;
  tail?: string;
  color: 'text' | 'primary';
}) {
  return (
    <>
      <Text variant="label" color={color}>
        {from}
      </Text>
      <Icon name={I18nManager.isRTL ? 'arrow-back' : 'arrow-forward'} size={16} color={color} />
      {to !== null ? (
        <Text variant="label" color={color}>
          {to}
        </Text>
      ) : (
        <Text variant="label" muted>
          {tail}
        </Text>
      )}
    </>
  );
}

/** The full-width button that shows the dates being looked at and opens the calendar. */
export function DateRangePill({ range, onPress }: { range: DateRange; onPress: () => void }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('dashDate.pill.label', { from: range.from, to: range.to })}
      accessibilityHint={t('dashDate.pill.hint')}
      onPress={onPress}
      style={({ pressed }) => [
        styles.pill,
        { backgroundColor: colors.primarySoft, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      <View style={styles.dates}>
        <Dates from={range.from} to={range.to} color="primary" />
      </View>
      <View style={styles.pillChevron}>
        <Icon name="chevron-down" size={18} color="primary" />
      </View>
    </Pressable>
  );
}

interface SheetProps {
  visible: boolean;
  /** The range the dashboard shows now: the sheet starts from it every time it opens. */
  range: DateRange;
  /** Today in the workspace's zone ('YYYY-MM-DD'): the last day that can be chosen. */
  today: string;
  /**
   * Called with the chosen range when "Apply" is pressed, and with the default range (the last 30 days) when "Reset" is pressed:
   * Reset puts the dashboard back at once, it is not a second step. The parent closes the sheet either way.
   */
  onApply: (range: DateRange) => void;
  onClose: () => void;
}

/** The calendar sheet that slides up from the date pill: quick ranges, then two days on a month calendar. */
export function DateRangeSheet({ visible, range, today, onApply, onClose }: SheetProps) {
  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      {/* Only mounted while open, so the choice starts from `range` each time. */}
      <SheetBody range={range} today={today} onApply={onApply} onClose={onClose} />
    </Modal>
  );
}

function SheetBody({ range, today, onApply, onClose }: Omit<SheetProps, 'visible'>) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  // At least 80% of the window, and never up under the status bar.
  const maxHeight = height - insets.top - spacing.lg;
  const [selection, setSelection] = useState<Selection>({ from: range.from, to: range.to });
  // The calendar keeps its own month; a new key sends it to the month of the range just chosen.
  const [calendarKey, setCalendarKey] = useState(0);

  const choose = (next: DateRange) => {
    setSelection(next);
    setCalendarKey((k) => k + 1);
  };

  const { from, to } = selection;
  const complete = from !== null && to !== null ? { from, to } : null;
  const active = complete ? presetOf(complete, today) : null;
  const canApply = complete !== null && isValidRange(complete, today);

  return (
    <View style={[styles.scrim, { backgroundColor: colors.scrim }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('dashDate.close')}
        onPress={onClose}
        style={styles.dismiss}
      />
      <View
        accessibilityViewIsModal
        accessibilityLabel={t('dashDate.title')}
        onAccessibilityEscape={onClose}
        style={[
          styles.sheet,
          {
            backgroundColor: colors.surface,
            minHeight: Math.min(height * 0.8, maxHeight),
            maxHeight,
          },
        ]}
      >
        <View style={[styles.grabber, { backgroundColor: colors.borderStrong }]} />
        <Text variant="heading" accessibilityRole="header" style={styles.title}>
          {t('dashDate.title')}
        </Text>
        <ScrollView contentContainerStyle={styles.body}>
          <View
            accessible
            accessibilityLiveRegion="polite"
            accessibilityLabel={
              from === null
                ? t('dashDate.selection.pickFirst')
                : to === null
                  ? `${from}, ${t('dashDate.selection.pickLast')}`
                  : t('dashDate.selection.label', { from, to })
            }
            style={[styles.selection, { backgroundColor: colors.surfaceMuted }]}
          >
            {from === null ? (
              <Text variant="label" muted>
                {t('dashDate.selection.pickFirst')}
              </Text>
            ) : (
              <Dates from={from} to={to} tail={t('dashDate.selection.pickLast')} color="text" />
            )}
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View
              accessibilityRole="radiogroup"
              accessibilityLabel={t('dashDate.presets')}
              style={styles.chips}
            >
              {CHIPS.map((preset) => {
                const selected = preset === active;
                return (
                  <Pressable
                    key={preset}
                    accessibilityRole="radio"
                    accessibilityLabel={t(`dashDate.preset.${preset}`)}
                    accessibilityState={{ checked: selected }}
                    onPress={() => choose(presetRange(preset, today))}
                    style={[
                      styles.chip,
                      selected
                        ? { backgroundColor: colors.primary, borderColor: colors.primary }
                        : { borderColor: colors.borderStrong },
                    ]}
                  >
                    <Text variant="label" color={selected ? 'onPrimary' : 'text'} numberOfLines={1}>
                      {t(`dashDate.preset.${preset}`)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>

          <View style={styles.calendar}>
            <CalendarRange
              key={calendarKey}
              from={from}
              to={to}
              maxDate={today}
              maxSpanDays={MAX_SPAN_DAYS}
              onChange={(nextFrom, nextTo) => setSelection({ from: nextFrom, to: nextTo })}
            />
          </View>
        </ScrollView>

        <View
          style={[
            styles.footer,
            { borderTopColor: colors.border, paddingBottom: spacing.lg + insets.bottom },
          ]}
        >
          <View style={styles.fill}>
            <Button
              label={t('dashDate.reset')}
              variant="secondary"
              onPress={() => onApply(presetRange(DEFAULT_PRESET, today))}
            />
          </View>
          <View style={styles.fill}>
            <Button
              label={t('dashDate.apply')}
              disabled={!canApply}
              onPress={() => {
                if (complete) onApply(complete);
              }}
            />
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'stretch',
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
    borderRadius: radius.pill,
  },
  dates: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  pillChevron: { position: 'absolute', end: spacing.lg },
  scrim: { flex: 1, justifyContent: 'flex-end' },
  dismiss: { flex: 1 },
  sheet: {
    borderTopStartRadius: radius.xl,
    borderTopEndRadius: radius.xl,
    overflow: 'hidden',
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: radius.pill,
    marginTop: spacing.sm,
    opacity: 0.5,
  },
  title: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  body: { gap: spacing.md, paddingBottom: spacing.md },
  selection: {
    marginHorizontal: spacing.lg,
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
  },
  chips: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg },
  chip: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  calendar: { paddingHorizontal: spacing.sm },
  footer: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  fill: { flex: 1 },
});
