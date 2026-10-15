import { useTranslation } from 'react-i18next';
import { Platform } from 'react-native';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { openSettingsFor, type DevicePermission } from '@/lib/device/permissions';
import { log } from '@/lib/observability/logger';

interface Props {
  /** The permissions that are still off; nothing shows while it is empty. */
  off: DevicePermission[];
  onClose: () => void;
}

/**
 * Tells the person which permissions are off and what to tap on the phone's settings page (the phone does not let an app scroll
 * to the row itself), then opens that page. Shown after the phone's own prompts when some permission was not allowed.
 */
export function PermissionGuide({ off, onClose }: Props) {
  const { t } = useTranslation();
  const list = off.map((kind) => t(`permissions.names.${kind}`)).join(', ');
  const onlyNotifications = off.every((kind) => kind === 'notifications');
  const steps = onlyNotifications
    ? 'permissions.guide.notifications'
    : Platform.OS === 'android'
      ? 'permissions.guide.android'
      : 'permissions.guide.ios';
  const openSettings = () => {
    onClose();
    openSettingsFor(off).catch((error: unknown) =>
      log.exception(error, 'device.open_settings_failed'),
    );
  };
  return (
    <ConfirmDialog
      visible={off.length > 0}
      title={t('permissions.guide.title')}
      message={t(steps, { list })}
      confirmLabel={t('permissions.guide.open')}
      cancelLabel={t('permissions.guide.later')}
      onConfirm={openSettings}
      onCancel={onClose}
    />
  );
}
