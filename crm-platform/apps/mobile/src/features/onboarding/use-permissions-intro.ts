import { useCallback, useEffect, useState } from 'react';
import { hasSeenPermissionsIntro, markPermissionsIntroSeen } from '@/lib/device/first-run';
import { getPermission, offeredPermissions } from '@/lib/device/permissions';
import { log } from '@/lib/observability/logger';

/**
 * Whether the first-open permission screen has to be shown: `loading` while the phone is asked, `show` the first time the app opens
 * on a phone where at least one of the offered permissions is not granted and the phone would still show its prompt for it, `done`
 * otherwise. A phone that has granted everything, or refused for good (the app was reinstalled, or it was set in the settings),
 * never sees the screen.
 */
export function usePermissionsIntro(): { status: 'loading' | 'show' | 'done'; finish: () => void } {
  const [status, setStatus] = useState<'loading' | 'show' | 'done'>('loading');

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        if (await hasSeenPermissionsIntro()) return 'done';
        // Not granted yet, and the phone would still ask: Android 13 and newer call a never-asked app "denied" with
        // `canAskAgain: true`, so the state alone cannot tell "never asked" from "refused for good".
        const answers = await Promise.all(offeredPermissions().map(getPermission));
        if (answers.every((a) => a.state === 'granted' || !a.canAskAgain)) {
          await markPermissionsIntroSeen();
          return 'done';
        }
        return 'show';
      } catch (error) {
        // A phone that cannot say must not keep the person out of the app: the screen is skipped, and shown again next time.
        log.exception(error, 'onboarding.permissions_check_failed');
        return 'done';
      }
    })().then((next) => {
      if (alive) setStatus(next);
    });
    return () => {
      alive = false;
    };
  }, []);

  const finish = useCallback(() => {
    setStatus('done');
    markPermissionsIntroSeen().catch((error: unknown) =>
      log.exception(error, 'onboarding.permissions_mark_failed'),
    );
  }, []);

  return { status, finish };
}
