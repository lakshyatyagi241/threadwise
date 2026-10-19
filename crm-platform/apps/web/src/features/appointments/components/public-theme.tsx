'use client';

import {
  createContext,
  useContext,
  useMemo,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { DEFAULT_BOOKING_THEME } from '@crm/contracts';
import { cn } from '@crm/ui';
import {
  buildPalette,
  schemeFor,
  toView,
  wrapperStyle,
  type ThemeView,
} from '../lib/booking-theme';

/** The theme of the page being drawn, for the parts deep inside it (the confirm button's label, the welcome note). */
const ThemeContext = createContext<ThemeView>(toView(DEFAULT_BOOKING_THEME, ''));
export const useBookingTheme = (): ThemeView => useContext(ThemeContext);

const QUERY = '(prefers-color-scheme: dark)';
const subscribe = (notify: () => void) => {
  if (typeof window === 'undefined' || !window.matchMedia) return () => undefined;
  const mql = window.matchMedia(QUERY);
  mql.addEventListener('change', notify);
  return () => mql.removeEventListener('change', notify);
};
const snapshot = () =>
  typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(QUERY).matches : false;

/**
 * One wrapper that turns the app's colour tokens into the workspace's: a `#RRGGBB` palette, a corner scale, a font stack from a fixed
 * list and `light` / `dark` / `auto`. Nothing else is applied, so a theme cannot add a rule, a class or any markup. The wrapper also
 * carries `data-theme`, so every `dark:` variant inside follows the page's own scheme rather than the app's.
 */
export function ThemeScope({
  view,
  className,
  children,
}: {
  view: ThemeView;
  className?: string;
  children: ReactNode;
}) {
  const systemDark = useSyncExternalStore(subscribe, snapshot, () => false);
  const scheme = schemeFor(view.colorMode, systemDark);
  const style = useMemo(
    () => wrapperStyle(view, buildPalette(view, scheme)) as CSSProperties,
    [view, scheme],
  );
  return (
    <ThemeContext.Provider value={view}>
      <div data-theme={scheme} style={style} className={cn('text-foreground', className)}>
        {children}
      </div>
    </ThemeContext.Provider>
  );
}
