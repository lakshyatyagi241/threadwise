import { useEffect, useRef } from 'react';
import { openOverlaySettings, phoneStateAllowed } from '@/lib/device/call-monitor';
import { hasAskedForPermissions, markPermissionsAsked } from '@/lib/device/first-run';
import { askForPermissions } from '@/lib/device/permissions';
import { i18n } from '@/lib/i18n';
import { log } from '@/lib/observability/logger';

/**
 * The first time the app opens on a phone, shows the phone's own permission prompts (notifications, calls, camera), one after the
 * other, over the app, and nothing else: no screen or dialog of the app explains them. "Display over other apps" (the contact card
 * over the call screen) has no prompt on Android, only a settings page with its switch, so when it is the one thing left off the
 * phone's page for it opens straight away. Nothing is asked until `enabled` (the app is on screen) and never twice: the flag is
 * written before the first prompt, so closing the app in the middle of the prompts does not bring them back on the next start.
 */
export function useFirstRunPermissions(enabled: boolean): void {
  const started = useRef(false);
  useEffect(() => {
    if (!enabled || started.current) return;
    started.current = true;
    void (async () => {
      try {
        if (await hasAskedForPermissions()) return;
        await markPermissionsAsked();
        const off = await askForPermissions({ channelName: i18n.t('permissions.channelName') });
        if (off.includes('callPopup') && (await phoneStateAllowed())) openOverlaySettings();
      } catch (error) {
        log.exception(error, 'onboarding.permissions_failed');
      }
    })();
  }, [enabled]);
}
