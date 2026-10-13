import { useState } from 'react';
import * as Updates from 'expo-updates';

/** What the "Check for updates" row says after a tap. */
export type UpdateState = 'idle' | 'checking' | 'off' | 'latest' | 'ready' | 'failed';

/**
 * Looks for an over-the-air update of the app's JavaScript (JS-only changes reach only builds of the same app version). A build
 * that does not receive updates (a development build, or one made without an update channel) says so instead of pretending to
 * look. A found update is downloaded at once and applied when the person taps again (`apply`), so the app never restarts under them.
 */
export function useUpdateCheck() {
  const [state, setState] = useState<UpdateState>('idle');

  const check = async () => {
    if (!Updates.isEnabled) {
      setState('off');
      return;
    }
    setState('checking');
    try {
      const found = await Updates.checkForUpdateAsync();
      if (!found.isAvailable) {
        setState('latest');
        return;
      }
      const fetched = await Updates.fetchUpdateAsync();
      setState(fetched.isNew ? 'ready' : 'latest');
    } catch {
      setState('failed');
    }
  };

  const apply = () => void Updates.reloadAsync();

  return { state, check, apply };
}
