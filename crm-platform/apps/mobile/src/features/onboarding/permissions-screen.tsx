import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, Linking, Pressable, StyleSheet, View } from 'react-native';
import { BrandMark } from '@/components/ui/brand-mark';
import { Button } from '@/components/ui/button';
import { Icon, type IconName } from '@/components/ui/icon';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import {
  getPermission,
  offeredPermissions,
  preparePermissions,
  type DevicePermission,
  type PermissionInfo,
} from '@/lib/device/permissions';
import { log } from '@/lib/observability/logger';
import { MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
import type { ThemeColors } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';

interface Props {
  /** The person chose (or skipped): the screen is not shown again. */
  onDone: () => void;
}

const LOOK: Record<
  DevicePermission,
  { icon: IconName; tint: keyof ThemeColors; soft: keyof ThemeColors }
> = {
  notifications: { icon: 'notifications-outline', tint: 'warning', soft: 'warningSoft' },
  calls: { icon: 'call-outline', tint: 'success', soft: 'successSoft' },
  camera: { icon: 'camera-outline', tint: 'primary', soft: 'primarySoft' },
};

/** `null` until the phone has answered. Every permission that is not on is switched on in the phone's settings. */
type Standing = 'granted' | 'off';
const standingOf = (info: PermissionInfo | undefined): Standing | null =>
  info === undefined ? null : info.state === 'granted' ? 'granted' : 'off';

interface RowProps {
  kind: DevicePermission;
  standing: Standing | null;
}

function Row({ kind, standing }: RowProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const look = LOOK[kind];
  return (
    <View
      testID={`permission-${kind}`}
      style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <View style={[styles.badge, { backgroundColor: colors[look.soft] }]}>
        <Icon name={look.icon} size={26} color={look.tint} />
      </View>
      <View style={styles.rowText}>
        <Text variant="label">{t(`permissions.intro.${kind}.title`)}</Text>
        <Text variant="caption" muted>
          {t(`permissions.intro.${kind}.body`)}
        </Text>
      </View>
      {standing === 'granted' ? (
        <View
          accessible
          accessibilityLabel={t('permissions.intro.allowedFor', {
            name: t(`permissions.intro.${kind}.title`),
          })}
          style={styles.state}
        >
          <Icon name="checkmark-circle" size={28} color="success" />
        </View>
      ) : standing === null ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('permissions.intro.openSettingsFor', {
            name: t(`permissions.intro.${kind}.title`),
          })}
          onPress={() => void Linking.openSettings()}
          style={[styles.action, { borderColor: colors.primary }]}
        >
          <Text variant="label" color="primary">
            {t('permissions.intro.settings')}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

/**
 * The first time the app opens: what it would like to be allowed to do, and why. Each permission that is off has a "Settings"
 * button, and so has the main button: both open this app's page in the phone's settings, where the person turns it on. The app
 * asks the phone's own prompt nothing here. "Not now" goes on without opening anything. When the person comes back from the
 * settings the ticks are read again. A new permission becomes a new row here, added with the feature that uses it.
 */
export function PermissionsScreen({ onDone }: Props) {
  const { t } = useTranslation();
  const kinds = offeredPermissions();
  const [info, setInfo] = useState<Partial<Record<DevicePermission, PermissionInfo>>>({});

  useEffect(() => {
    let alive = true;
    const read = () => {
      for (const kind of kinds) {
        getPermission(kind)
          .then((answer) => {
            if (alive) setInfo((current) => ({ ...current, [kind]: answer }));
          })
          .catch((error: unknown) => log.exception(error, 'onboarding.permission_read_failed'));
      }
    };
    preparePermissions({ channelName: t('permissions.intro.channelName') })
      .catch((error: unknown) => log.exception(error, 'onboarding.permission_prepare_failed'))
      .finally(read);
    // Read again when the person comes back from the phone's settings.
    const watch = AppState.addEventListener('change', (state) => {
      if (state === 'active') read();
    });
    return () => {
      alive = false;
      watch.remove();
    };
    // The permissions offered never change while the screen is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pending = kinds.some((kind) => standingOf(info[kind]) === 'off');

  return (
    <Screen>
      <View style={styles.head}>
        <BrandMark size={56} />
        <Text variant="title" accessibilityRole="header">
          {t('permissions.intro.title')}
        </Text>
        <Text muted>{t('permissions.intro.subtitle')}</Text>
      </View>
      <View style={styles.list}>
        {kinds.map((kind) => (
          <Row key={kind} kind={kind} standing={standingOf(info[kind])} />
        ))}
      </View>
      <View style={styles.actions}>
        <Button
          label={pending ? t('permissions.intro.openSettings') : t('permissions.intro.continue')}
          onPress={() => (pending ? void Linking.openSettings() : onDone())}
        />
        {pending ? (
          <Button variant="link" label={t('permissions.intro.notNow')} onPress={onDone} />
        ) : null}
        <Text variant="caption" muted style={styles.footnote}>
          {t('permissions.intro.footnote')}
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { gap: spacing.md, paddingTop: spacing.xl },
  list: { gap: spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  badge: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, gap: spacing.xs },
  state: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  action: {
    minHeight: MIN_TOUCH_TARGET,
    minWidth: 76,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1.5,
  },
  actions: { gap: spacing.sm, marginTop: spacing.md },
  footnote: { textAlign: 'center' },
});
