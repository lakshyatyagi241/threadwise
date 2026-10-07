'use client';

import { useCallback, useSyncExternalStore } from 'react';
import {
  DESKTOP_KEY,
  SOUND_KEY,
  desktopPermission,
  requestDesktopPermission,
  soundEnabled,
  type DesktopSupport,
} from './alerts';

/** This browser's two alert switches. Changes reach every part of the page (and, through `storage`, every other tab). */
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of [...listeners]) l();
};

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === SOUND_KEY || e.key === DESKTOP_KEY || e.key === null) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* private window or blocked storage: the choice lasts until the page closes, no longer */
  }
  emit();
}

/** A snapshot string, so `useSyncExternalStore` compares by value. */
const snapshot = () =>
  `${soundEnabled() ? 1 : 0}|${desktopPermission()}|${readDesktopPref() ? 1 : 0}`;
function readDesktopPref(): boolean {
  try {
    return window.localStorage.getItem(DESKTOP_KEY) !== 'off';
  } catch {
    return true;
  }
}

export interface AlertSettings {
  soundOn: boolean;
  setSound(on: boolean): void;
  /** `unsupported` hides the control; `default` offers "Enable"; `granted` is a switch; `denied` explains. */
  desktop: DesktopSupport;
  desktopOn: boolean;
  /** Asks the browser for permission. Call it only from the person's click on the enable control. */
  enableDesktop(): Promise<void>;
  setDesktop(on: boolean): void;
}

export function useAlertSettings(): AlertSettings {
  const snap = useSyncExternalStore(subscribe, snapshot, () => '1|unsupported|0');
  const [sound, permission, pref] = snap.split('|');
  const desktop = permission as DesktopSupport;
  return {
    soundOn: sound === '1',
    desktop,
    desktopOn: desktop === 'granted' && pref === '1',
    setSound: useCallback((on) => write(SOUND_KEY, on ? null : 'off'), []),
    setDesktop: useCallback((on) => write(DESKTOP_KEY, on ? null : 'off'), []),
    enableDesktop: useCallback(async () => {
      const answer = await requestDesktopPermission();
      if (answer === 'granted') write(DESKTOP_KEY, null);
      else emit();
    }, []),
  };
}
