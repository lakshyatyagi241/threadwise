import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { Toggle } from '@/components/ui/toggle';
import { MIN_TOUCH_TARGET, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { lookOf } from './notification-model';
import { translatorFor } from './notification-text';
import {
  availability,
  PREF_CHANNELS,
  type PrefChannel,
  type PrefEntry,
  type RowView,
} from './preferences-model';

interface Props {
  row: RowView;
  entry: PrefEntry;
  /** Whether the Push switch is drawn (only where the deployment has browser notifications). */
  pushEnabled: boolean;
  onChange: (type: string, channel: PrefChannel, value: boolean) => void;
  onReset: (type: string) => void;
}

/** A type this build has no words for: its name made readable (the screen still works for it). */
const readable = (type: string): string =>
  type.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/** One kind of notification: what it is, what applies by default, and a switch for each way it can reach the person. */
function PreferenceRowBase({ row, entry, pushEnabled, onChange, onReset }: Props) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const base = `notificationPrefs.types.${row.type}`;
  // The key is built from the type, so it is looked up through the untyped translator.
  const word = translatorFor(i18n);
  const label = word.has(`${base}.label`) ? word(`${base}.label`) : readable(row.type);
  const hint = word.has(`${base}.hint`) ? word(`${base}.hint`) : null;
  const look = lookOf(row.type);
  const can = availability(row.type);
  const onOff = (value: boolean) => t(value ? 'notificationPrefs.on' : 'notificationPrefs.off');
  const named = (channel: PrefChannel, value: boolean) =>
    `${t(`notificationPrefs.channelNames.${channel}`)} ${onOff(value)}`;
  const defaults = t(
    pushEnabled ? 'notificationPrefs.defaultSummaryPush' : 'notificationPrefs.defaultSummary',
    {
      bell: named('bell', entry.defaults.bell),
      toast: named('toast', entry.defaults.toast && can.toast),
      sound: named('sound', entry.defaults.sound && can.sound),
      push: named('push', entry.defaults.push),
    },
  );
  const bellOffNote = row.cells.toast.reason === 'bell_off';
  const note = row.blocked
    ? t('notificationPrefs.workspaceOffHelp')
    : bellOffNote
      ? t('notificationPrefs.bellOffHelp')
      : defaults;
  const channels = PREF_CHANNELS.filter((c) => pushEnabled || c !== 'push');

  return (
    <View style={[styles.row, { borderBottomColor: colors.border }]} testID={`pref-${row.type}`}>
      <View style={styles.head}>
        <Icon name={look.icon} size={22} color="textMuted" />
        <View style={styles.text}>
          <View style={styles.title}>
            <Text variant="label" style={styles.name}>
              {label}
            </Text>
            {row.custom ? <Badge label={t('notificationPrefs.customised')} tone="info" /> : null}
            {row.blocked ? (
              <Badge label={t('notificationPrefs.workspaceOff')} tone="warning" />
            ) : null}
          </View>
          {hint ? (
            <Text variant="caption" muted>
              {hint}
            </Text>
          ) : null}
          <Text variant="caption" muted>
            {note}
          </Text>
          {row.blocked && bellOffNote ? (
            <Text variant="caption" muted>
              {t('notificationPrefs.bellOffHelp')}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={styles.switches}>
        {channels.map((channel) => {
          const cell = row.cells[channel];
          const channelName = t(`notificationPrefs.channelNames.${channel}`);
          const switchLabel = t('notificationPrefs.toggleLabel', {
            event: label,
            channel: channelName,
          });
          return (
            <View key={channel} style={styles.cell} testID={`pref-${row.type}-${channel}`}>
              <Text variant="caption" muted>
                {t(`notificationPrefs.columns.${channel}`)}
              </Text>
              {cell.reason === 'not_available' ? (
                <View
                  accessible
                  accessibilityLabel={`${switchLabel}: ${t('notificationPrefs.notAvailable')}`}
                  style={styles.none}
                >
                  <Icon name="remove-outline" size={20} color="textMuted" />
                </View>
              ) : (
                <Toggle
                  value={cell.on}
                  disabled={cell.disabled}
                  label={switchLabel}
                  onValueChange={(value) => onChange(row.type, channel, value)}
                />
              )}
            </View>
          );
        })}
      </View>
      {row.custom ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('notificationPrefs.resetRowFor', { event: label })}
          onPress={() => onReset(row.type)}
          style={styles.reset}
        >
          <Text variant="caption" color="primary">
            {t('notificationPrefs.resetRow')}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export const PreferenceRow = memo(PreferenceRowBase);

const styles = StyleSheet.create({
  row: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  head: { flexDirection: 'row', gap: spacing.md },
  text: { flex: 1, gap: 2 },
  title: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  name: { flexShrink: 1 },
  switches: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
    paddingStart: 22 + spacing.md,
  },
  cell: { alignItems: 'center', gap: 2 },
  none: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reset: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    alignSelf: 'flex-start',
    paddingStart: 22 + spacing.md,
  },
});
