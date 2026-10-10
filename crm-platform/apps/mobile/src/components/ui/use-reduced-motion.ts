import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * True when the person asked their phone for less motion (Android "remove animations", iOS "Reduce Motion"). Every animation in
 * the app checks this and shows its end state at once instead of moving there.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let alive = true;
    void Promise.resolve(AccessibilityInfo.isReduceMotionEnabled())
      .then((value) => {
        if (alive) setReduced(Boolean(value));
      })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced) as
      | { remove: () => void }
      | undefined;
    return () => {
      alive = false;
      subscription?.remove();
    };
  }, []);
  return reduced;
}
