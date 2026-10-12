import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { I18nManager, Pressable, StyleSheet, View } from 'react-native';
import { MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import {
  addMonths,
  compareDates,
  compareMonths,
  isDateString,
  longDateLabel,
  monthGrid,
  monthOf,
  monthTitle,
  orderDates,
  spanDays,
  weekdayNames,
  type YearMonth,
} from './calendar-range.dates';
import { Icon } from './icon';
import { Text } from './text';

interface Props {
  /** First day of the range ('YYYY-MM-DD'), or null before one is chosen. */
  from: string | null;
  /** Last day of the range, or null while only the first is chosen. */
  to: string | null;
  /** The last day that can be chosen (today in the workspace's zone). Later days are faded and cannot be pressed. */
  maxDate: string;
  /** The most calendar days a range may cover, both ends counted. Once a first day is chosen, days that would make a longer range are disabled. */
  maxSpanDays?: number;
  /** A first day was pressed (`to` is null: the range is open), or the second one completed the range (earlier day first). */
  onChange: (from: string, to: string | null) => void;
}

const DAY_SIZE = MIN_TOUCH_TARGET - 2 * spacing.xs;

/**
 * A month calendar for choosing a range of days, built from plain views (no date library). Press a day to start a range, press a
 * second to end it (an earlier second day swaps the two); pressing again after a complete range starts over. The month shown
 * starts at the range's end (else its start, else `maxDate`); to move it from outside, give the calendar a new `key`.
 */
export function CalendarRange({ from, to, maxDate, maxSpanDays, onChange }: Props) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const rtl = I18nManager.isRTL;

  const first = isDateString(from) ? from : null;
  const last = first !== null && isDateString(to) ? to : null;
  const [start, end] = first !== null && last !== null ? orderDates(first, last) : [first, last];

  const [shown, setShown] = useState<YearMonth>(() => monthOf(end ?? start ?? maxDate));
  const weeks = useMemo(() => monthGrid(shown.year, shown.month), [shown]);
  const weekdays = useMemo(() => weekdayNames(i18n.language), [i18n.language]);
  const atLatest = compareMonths(shown, monthOf(maxDate)) >= 0;

  const isDisabled = (day: string): boolean => {
    if (compareDates(day, maxDate) > 0) return true;
    // With only a first day chosen, a day that would make the range longer than the limit cannot end it.
    return (
      maxSpanDays !== undefined &&
      start !== null &&
      end === null &&
      spanDays(start, day) > maxSpanDays
    );
  };

  const press = (day: string) => {
    if (start === null || end !== null) {
      onChange(day, null);
      return;
    }
    const [a, b] = orderDates(start, day);
    onChange(a, b);
  };

  const isInside = (day: string): boolean =>
    start !== null && end !== null && compareDates(day, start) > 0 && compareDates(day, end) < 0;

  /** What a screen reader adds to the date: where the day sits in the range, and that it is today. */
  const stateText = (day: string): string[] => {
    const parts: string[] = [];
    if (day === start) parts.push(t('dashDate.calendar.start'));
    if (day === end) parts.push(t('dashDate.calendar.end'));
    if (isInside(day)) parts.push(t('dashDate.calendar.inRange'));
    if (day === maxDate) parts.push(t('dashDate.calendar.today'));
    return parts;
  };

  return (
    <View style={styles.calendar}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('dashDate.calendar.previousMonth')}
          onPress={() => setShown((m) => addMonths(m, -1))}
          style={styles.nav}
        >
          <Icon name={rtl ? 'chevron-forward' : 'chevron-back'} size={24} />
        </Pressable>
        <Text
          variant="subheading"
          accessibilityRole="header"
          accessibilityLiveRegion="polite"
          style={styles.title}
        >
          {monthTitle(shown, i18n.language)}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('dashDate.calendar.nextMonth')}
          accessibilityState={{ disabled: atLatest }}
          disabled={atLatest}
          onPress={() => setShown((m) => addMonths(m, 1))}
          style={[styles.nav, atLatest && styles.faded]}
        >
          <Icon name={rtl ? 'chevron-back' : 'chevron-forward'} size={24} />
        </Pressable>
      </View>

      {/* The grid names the day in full ("Monday, October 12, 2026"), so the short names above it would only be read twice. */}
      <View
        style={styles.week}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {weekdays.map((name, i) => (
          <View key={i} style={styles.cell}>
            <Text variant="caption" muted numberOfLines={1}>
              {name}
            </Text>
          </View>
        ))}
      </View>

      <View role="grid" accessibilityLabel={monthTitle(shown, i18n.language)}>
        {weeks.map((week, row) => (
          <View key={row} style={styles.week}>
            {week.map((day, column) => {
              if (day === null) return <View key={column} style={styles.cell} />;
              const isStart = day === start;
              const isEnd = day === end;
              const inside = isInside(day);
              const disabled = isDisabled(day);
              const today = day === maxDate;
              const joined = start !== null && end !== null && start !== end;
              const filled = isStart || isEnd;
              const text = [longDateLabel(day, i18n.language), ...stateText(day)].join(', ');
              // The band behind the days of a range: whole cell inside it, the far half at its first day, the near half at its last.
              const bandStyle = inside
                ? [
                    styles.band,
                    styles.bandWhole,
                    week[column - 1] === null || column === 0 ? styles.bandRoundStart : null,
                    week[column + 1] === null || column === 6 ? styles.bandRoundEnd : null,
                  ]
                : joined && isStart
                  ? [styles.band, styles.bandAfter]
                  : joined && isEnd
                    ? [styles.band, styles.bandBefore]
                    : null;
              return (
                <View key={column} style={styles.cell}>
                  {bandStyle ? (
                    <View
                      pointerEvents="none"
                      style={[bandStyle, { backgroundColor: colors.primarySoft }]}
                    />
                  ) : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={text}
                    accessibilityState={{ selected: filled || inside, disabled }}
                    disabled={disabled}
                    onPress={() => press(day)}
                    style={styles.hit}
                  >
                    <View
                      style={[
                        styles.day,
                        filled && { backgroundColor: colors.primary },
                        today && { borderWidth: 2, borderColor: colors.primary },
                        disabled && styles.faded,
                      ]}
                    >
                      <Text variant="label" color={filled ? 'onPrimary' : 'text'}>
                        {Number(day.slice(8))}
                      </Text>
                    </View>
                  </Pressable>
                </View>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  calendar: { gap: spacing.xs },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { flex: 1, textAlign: 'center' },
  nav: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  week: { flexDirection: 'row' },
  cell: { flex: 1, height: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
  hit: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    start: 0,
    end: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  day: {
    width: DAY_SIZE,
    height: DAY_SIZE,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  faded: { opacity: 0.35 },
  band: { position: 'absolute', top: spacing.xs, bottom: spacing.xs },
  bandWhole: { start: 0, end: 0 },
  bandAfter: { start: '50%', end: 0 },
  bandBefore: { start: 0, end: '50%' },
  bandRoundStart: { borderTopStartRadius: radius.pill, borderBottomStartRadius: radius.pill },
  bandRoundEnd: { borderTopEndRadius: radius.pill, borderBottomEndRadius: radius.pill },
});
