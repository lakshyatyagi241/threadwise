import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { useTheme } from '@/lib/theme/use-theme';

const HOUR_MS = 3_600_000;
const SIZE = 44;
const TICKS = 48;
const TICK_WIDTH = 3;
const TICK_HEIGHT = 6;
/** The reply window of WhatsApp: used for the ring when the channel does not say how long its window is. */
const DEFAULT_WINDOW_HOURS = 24;

/** How long is left until `expiresAt`, in milliseconds and never below zero; null when there is no deadline. */
export function remainingOf(expiresAt: string | null, now: Date): number | null {
  if (expiresAt === null) return null;
  const end = new Date(expiresAt).getTime();
  return Number.isNaN(end) ? null : Math.max(0, end - now.getTime());
}

/** Whole hours and minutes in a time left; the minutes are rounded down, so "1:39" never promises a minute that is gone. */
export function partsOf(ms: number): { hours: number; minutes: number } {
  return { hours: Math.floor(ms / HOUR_MS), minutes: Math.floor((ms % HOUR_MS) / 60_000) };
}

/** "1:39": hours, then minutes with two digits. */
export function formatRemaining(ms: number): string {
  const { hours, minutes } = partsOf(ms);
  return `${hours}:${String(minutes).padStart(2, '0')}`;
}

interface Props {
  /** When the reply window closes; null when the channel has no window (nothing is drawn). */
  expiresAt: string | null;
  windowHours: number | null;
  now: Date;
}

/**
 * The reply window as a ring with the time left in the middle: full when the window has just opened, empty when it has closed.
 * Green while there are hours left, amber in the last hour, red once it is closed (only a template can be sent then). The ring
 * is a circle of short bars, so it needs no drawing library.
 */
export function WindowTimer({ expiresAt, windowHours, now }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const remaining = remainingOf(expiresAt, now);
  if (remaining === null) return null;

  const total = (windowHours ?? DEFAULT_WINDOW_HOURS) * HOUR_MS;
  const filled = Math.ceil(Math.min(1, remaining / total) * TICKS);
  const closed = remaining === 0;
  const tone = closed ? colors.danger : remaining <= HOUR_MS ? colors.warning : colors.success;
  const { hours, minutes } = partsOf(remaining);
  return (
    <View
      accessible
      accessibilityLabel={
        closed ? t('inbox.thread.window.closed') : t('inbox.thread.window.left', { hours, minutes })
      }
      style={styles.ring}
    >
      {Array.from({ length: TICKS }, (_, i) => (
        <View
          key={i}
          pointerEvents="none"
          style={[styles.spoke, { transform: [{ rotate: `${(i * 360) / TICKS}deg` }] }]}
        >
          <View
            testID={i < filled ? 'timer-tick-on' : 'timer-tick-off'}
            style={[styles.tick, { backgroundColor: i < filled ? tone : colors.border }]}
          />
        </View>
      ))}
      <Text variant="caption" style={styles.time} numberOfLines={1}>
        {formatRemaining(remaining)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  ring: { width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' },
  // Each spoke is a full-size square turned about its middle, with one bar at its top edge.
  spoke: { position: 'absolute', width: SIZE, height: SIZE },
  tick: {
    alignSelf: 'center',
    width: TICK_WIDTH,
    height: TICK_HEIGHT,
    borderRadius: TICK_WIDTH / 2,
  },
  time: { fontSize: 11, lineHeight: 14, fontWeight: '600' },
});
