import { useEffect, useRef, useState } from 'react';
import { hasAskedForPermissions, markPermissionsAsked } from '@/lib/device/first-run';
import { askForPermissions, type DevicePermission } from '@/lib/device/permissions';
import { i18n } from '@/lib/i18n';
import { log } from '@/lib/observability/logger';

/**
 * The first time the app opens on a phone, shows the phone's own permission prompts (notifications, calls, camera), one after the
 * other, over the app. Answers with the permissions still off afterwards and a way to clear them, for the `PermissionGuide` to
 * tell the person where to switch them on. Nothing is asked until `enabled` (the app is on screen) and never twice: the flag is
 * written before the first prompt, so closing the app in the middle of the prompts does not bring them back on the next start.
 */
export function useFirstRunPermissions(enabled: boolean): {
  off: DevicePermission[];
  clear: () => void;
} {
  const started = useRef(false);
  const [off, setOff] = useState<DevicePermission[]>([]);
  useEffect(() => {
    if (!enabled || started.current) return;
    started.current = true;
    void (async () => {
      try {
        if (await hasAskedForPermissions()) return;
        await markPermissionsAsked();
        setOff(await askForPermissions({ channelName: i18n.t('permissions.channelName') }));
      } catch (error) {
        log.exception(error, 'onboarding.permissions_failed');
      }
    })();
  }, [enabled]);
  return { off, clear: () => setOff([]) };
}
