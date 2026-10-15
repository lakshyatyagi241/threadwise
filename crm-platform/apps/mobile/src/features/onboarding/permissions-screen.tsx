import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { BrandMark } from '@/components/ui/brand-mark';
import { Button } from '@/components/ui/button';
import { Icon, type IconName } from '@/components/ui/icon';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import {
  getPermission,
  offeredPermissions,
  requestPermission,
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

type Standing = 'granted' | 'ask' | 'blocked';
const standingOf = (info: PermissionInfo | undefined): Standing | null =>
  info === undefined
    ? null
    : info.state === 'granted'
      ? 'granted'
      : info.canAskAgain
        ? 'ask'
        : 'blocked';

interface RowProps {
  kind: DevicePermission;
  standing: Standing | null;
  busy: boolean;
  onAllow: () => void;
}

function Row({ kind, standing, busy, onAllow }: RowProps) {
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
          accessibilityLabel={
            standing === 'blocked'
              ? t('permissions.intro.openSettingsFor', {
                  name: t(`permissions.intro.${kind}.title`),
                })
              : t('permissions.intro.allowFor', { name: t(`permissions.intro.${kind}.title`) })
          }
          disabled={busy}
          onPress={standing === 'blocked' ? () => void Linking.openSettings() : onAllow}
          style={[styles.action, { borderColor: colors.primary }]}
        >
          <Text variant="label" color="primary">
            {standing === 'blocked'
              ? t('permissions.intro.settings')
              : t('permissions.intro.allow')}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

/**
 * The first time the app opens: what it would like to be allowed to do, and why, before the phone's own prompts appear. Each row
 * has its own "Allow"; "Allow all" asks for the rest one after another; "Not now" asks the phone nothing (the Menu's "Device
 * permissions" opens the phone's settings later). A prompt comes only when the person presses a button, never on its own. A new
 * permission becomes a new row here, added with the feature that uses it.
 */
export function PermissionsScreen({ onDone }: Props) {
  const { t } = useTranslation();
  const kinds = offeredPermissions();
  const [info, setInfo] = useState<Partial<Record<DevicePermission, PermissionInfo>>>({});
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    let alive = true;
    for (const kind of kinds) {
      getPermission(kind)
        .then((answer) => {
          if (alive) setInfo((current) => ({ ...current, [kind]: answer }));
        })
        .catch((error: unknown) => log.exception(error, 'onboarding.permission_read_failed'));
    }
    return () => {
      alive = false;
    };
    // The permissions offered never change while the screen is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ask = async (kind: DevicePermission) => {
    try {
      const answer = await requestPermission(kind, {
        channelName: t('permissions.intro.channelName'),
      });
      setInfo((current) => ({ ...current, [kind]: answer }));
    } catch (error) {
      // Whatever the phone answers, or fails to, the person goes on: they can change it in the settings.
      log.exception(error, 'onboarding.permission_request_failed');
    }
  };

  const askOne = async (kind: DevicePermission) => {
    setAsking(true);
    await ask(kind);
    setAsking(false);
  };

  const askAll = async () => {
    setAsking(true);
    for (const kind of kinds) {
      if (standingOf(info[kind]) === 'ask') await ask(kind);
    }
    setAsking(false);
    onDone();
  };

  const pending = kinds.some((kind) => standingOf(info[kind]) === 'ask');

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
          <Row
            key={kind}
            kind={kind}
            standing={standingOf(info[kind])}
            busy={asking}
            onAllow={() => void askOne(kind)}
          />
        ))}
      </View>
      <View style={styles.actions}>
        <Button
          label={pending ? t('permissions.intro.allowAll') : t('permissions.intro.continue')}
          loading={asking}
          onPress={() => (pending ? void askAll() : onDone())}
        />
        {pending ? (
          <Button
            variant="link"
            label={t('permissions.intro.notNow')}
            disabled={asking}
            onPress={onDone}
          />
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
