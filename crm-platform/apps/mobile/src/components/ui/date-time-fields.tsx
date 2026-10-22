import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { Button } from './button';
import { CalendarRange } from './calendar-range';
import { isDateString } from './calendar-range.dates';
import { PickerField } from './picker-row';
import { Text } from './text';

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);
const pad2 = (n: number) => String(n).padStart(2, '0');
const TIME_TEXT = /^(\d{2}):(\d{2})$/;

/** Today on the phone's own calendar, as 'YYYY-MM-DD'. */
const todayText = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
};

/** The phone's own way of writing the day, such as 22/10/2026; the text unchanged when it is not a day. */
export function showDate(value: string, language: string): string {
  if (!isDateString(value)) return value;
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  try {
    // Day first (22/10/2026), as the Geta app writes it; English is written the British way for that.
    return new Date(year, month - 1, day).toLocaleDateString(
      language === 'en' ? 'en-GB' : language,
      {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      },
    );
  } catch {
    return value;
  }
}

/** The phone's own way of writing a 'HH:mm' time, such as 10:29 AM. */
export function showTime(value: string, language: string): string {
  const match = TIME_TEXT.exec(value);
  if (!match) return value;
  try {
    return new Date(2000, 0, 1, Number(match[1]), Number(match[2])).toLocaleTimeString(language, {
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return value;
  }
}

interface SheetProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

/** The bottom sheet both pickers open in: a title, the picker, and whatever buttons the picker brings. */
function PickerSheet({ title, onClose, children }: SheetProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal transparent visible animationType="slide" onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('common.back')}
        style={[styles.scrim, { backgroundColor: colors.scrim }]}
        onPress={onClose}
      >
        <Pressable
          accessible={false}
          accessibilityViewIsModal
          style={[
            styles.sheet,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              paddingBottom: spacing.lg + insets.bottom,
            },
          ]}
        >
          <Text variant="heading" accessibilityRole="header">
            {title}
          </Text>
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

interface FieldProps {
  label: string;
  /** What an empty field says ("Select date"). */
  placeholder: string;
  error?: string | null;
  /** The word on the button that empties the field; no such button when the field cannot be empty. */
  clearLabel?: string;
}

interface DateProps extends FieldProps {
  /** 'YYYY-MM-DD', or '' for no day. */
  value: string;
  onChange: (value: string) => void;
}

/** A day field in the shape of the Geta app's: the day written the phone's way, a calendar icon, a calendar in a sheet to change it. */
export function DateField({ label, placeholder, error, clearLabel, value, onChange }: DateProps) {
  const { i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const chosen = isDateString(value) ? value : null;
  return (
    <>
      <PickerField
        label={label}
        value={chosen ? showDate(chosen, i18n.language) : placeholder}
        placeholder={chosen === null}
        icon="calendar-outline"
        error={error}
        onPress={() => setOpen(true)}
      />
      {open ? (
        <PickerSheet title={label} onClose={() => setOpen(false)}>
          <CalendarRange
            single
            from={chosen}
            to={chosen}
            today={todayText()}
            maxDate="2100-12-31"
            onChange={(day) => {
              onChange(day);
              setOpen(false);
            }}
          />
          {clearLabel && chosen ? (
            <Button
              variant="link"
              label={clearLabel}
              onPress={() => {
                onChange('');
                setOpen(false);
              }}
            />
          ) : null}
        </PickerSheet>
      ) : null}
    </>
  );
}

interface TimeProps extends FieldProps {
  /** 'HH:mm' on a 24-hour clock, or '' for no time. */
  value: string;
  hourLabel: string;
  minuteLabel: string;
  doneLabel: string;
  onChange: (value: string) => void;
}

/** One column of the time picker: its numbers in a scrolling list, the chosen one filled, opened on the chosen one. */
function Column({
  label,
  numbers,
  selected,
  onPick,
}: {
  label: string;
  numbers: readonly number[];
  selected: number;
  onPick: (n: number) => void;
}) {
  const { colors } = useTheme();
  const scroll = useRef<ScrollView>(null);
  return (
    <ScrollView
      ref={scroll}
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={styles.column}
      onLayout={() =>
        scroll.current?.scrollTo({
          y: Math.max(0, selected - 2) * MIN_TOUCH_TARGET,
          animated: false,
        })
      }
    >
      {numbers.map((n) => {
        const on = n === selected;
        return (
          <Pressable
            key={n}
            accessibilityRole="radio"
            accessibilityLabel={pad2(n)}
            accessibilityState={{ checked: on }}
            onPress={() => onPick(n)}
            style={[styles.number, on && { backgroundColor: colors.primary }]}
          >
            <Text variant="label" color={on ? 'onPrimary' : 'text'}>
              {pad2(n)}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** A time field in the shape of the Geta app's: the time written the phone's way, a clock icon, hour and minute lists in a sheet. */
export function TimeField({
  label,
  placeholder,
  error,
  clearLabel,
  value,
  hourLabel,
  minuteLabel,
  doneLabel,
  onChange,
}: TimeProps) {
  const { i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const match = TIME_TEXT.exec(value);
  const now = new Date();
  const [hour, setHour] = useState(match ? Number(match[1]) : now.getHours());
  const [minute, setMinute] = useState(match ? Number(match[2]) : now.getMinutes());
  const openSheet = () => {
    const again = TIME_TEXT.exec(value);
    const at = new Date();
    setHour(again ? Number(again[1]) : at.getHours());
    setMinute(again ? Number(again[2]) : at.getMinutes());
    setOpen(true);
  };
  return (
    <>
      <PickerField
        label={label}
        value={match ? showTime(value, i18n.language) : placeholder}
        placeholder={!match}
        icon="time-outline"
        error={error}
        onPress={openSheet}
      />
      {open ? (
        <PickerSheet title={label} onClose={() => setOpen(false)}>
          <View style={styles.columns}>
            <Column label={hourLabel} numbers={HOURS} selected={hour} onPick={setHour} />
            <Column label={minuteLabel} numbers={MINUTES} selected={minute} onPick={setMinute} />
          </View>
          <Button
            label={doneLabel}
            onPress={() => {
              onChange(`${pad2(hour)}:${pad2(minute)}`);
              setOpen(false);
            }}
          />
          {clearLabel && match ? (
            <Button
              variant="link"
              label={clearLabel}
              onPress={() => {
                onChange('');
                setOpen(false);
              }}
            />
          ) : null}
        </PickerSheet>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    gap: spacing.md,
    padding: spacing.lg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  columns: { flexDirection: 'row', gap: spacing.lg, height: MIN_TOUCH_TARGET * 5 },
  column: { flex: 1 },
  number: {
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
  },
});
