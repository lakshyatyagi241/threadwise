import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  callerIdAvailable,
  callerIdPermissions,
  callerIdStatus,
  disableCallerId,
  enableCallerId,
  requestCallerIdPermissions,
  updateCallerId,
  type CallerIdStatus,
} from '@/lib/device/caller-id';
import { openOverlaySettings, overlayAllowed } from '@/lib/device/call-monitor';
import { log } from '@/lib/observability/logger';
import { can, useSession } from '@/lib/session/use-session';
import { loadCallerEntries } from './caller-directory';

/** The right that lets the app read the contacts it names callers from. */
const CONTACTS_READ = 'record.contacts.read';

/** How long the phone's list is left alone before the app, coming to the front, reads the contacts again. */
export const CALLER_REFRESH_MS = 15 * 60_000;

export interface CallerIdState {
  available: boolean;
  /** Whether the person's role may read contacts (without it there is nobody to name). */
  canRead: boolean;
  status: CallerIdStatus;
  phoneState: boolean;
  callLog: boolean;
  overlay: boolean;
  busy: boolean;
  /** True when the last turn-on or update could not read the contacts. */
  failed: boolean;
  turnOn: () => Promise<void>;
  turnOff: () => void;
  updateNow: () => Promise<void>;
  allowPermissions: () => Promise<void>;
  allowOverlay: () => void;
}

/** The caller-ID switch, what it needs, and how to turn it on or off, for its own screen. */
export function useCallerId(): CallerIdState {
  const session = useSession();
  const canRead = can(session.data, CONTACTS_READ);
  const [status, setStatus] = useState(callerIdStatus);
  const [phoneState, setPhoneState] = useState(false);
  const [callLog, setCallLog] = useState(false);
  const [overlay, setOverlay] = useState(overlayAllowed);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    const granted = await callerIdPermissions();
    setPhoneState(granted.phoneState);
    setCallLog(granted.callLog);
    setOverlay(overlayAllowed());
    setStatus(callerIdStatus());
  }, []);

  // Read what the phone says now, and again each time the person comes back from the phone's own settings pages.
  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => {
      clearTimeout(first);
      subscription.remove();
    };
  }, [refresh]);

  const readContacts = useCallback(
    async (apply: typeof enableCallerId) => {
      setBusy(true);
      setFailed(false);
      try {
        apply(await loadCallerEntries());
      } catch (error) {
        log.exception(error, 'contacts.caller_id_load_failed');
        setFailed(true);
      } finally {
        setBusy(false);
        await refresh();
      }
    },
    [refresh],
  );

  const allowPermissions = useCallback(async () => {
    await requestCallerIdPermissions();
    await refresh();
  }, [refresh]);

  const turnOn = useCallback(async () => {
    if (!(await callerIdPermissions()).callLog || !(await callerIdPermissions()).phoneState) {
      await allowPermissions();
      return;
    }
    if (!overlayAllowed()) {
      openOverlaySettings();
      return;
    }
    await readContacts(enableCallerId);
  }, [allowPermissions, readContacts]);

  return {
    available: callerIdAvailable(),
    canRead,
    status,
    phoneState,
    callLog,
    overlay,
    busy,
    failed,
    turnOn,
    turnOff: () => {
      disableCallerId();
      void refresh();
    },
    updateNow: () => readContacts(updateCallerId),
    allowPermissions,
    allowOverlay: openOverlaySettings,
  };
}

/**
 * Keeps the phone's list of contacts up to date while caller ID is on: when the app opens and each time it comes to the front, if the
 * list is older than {@link CALLER_REFRESH_MS}. Mounted once, in the signed-in app. It does nothing when caller ID is off, the build
 * has no caller ID, or the person's role cannot read contacts, and a failed read leaves the list the phone has.
 */
export function useCallerIdSync(): void {
  const session = useSession();
  const canRead = can(session.data, CONTACTS_READ);
  const running = useRef(false);

  useEffect(() => {
    if (!canRead || !callerIdAvailable()) return;
    const sync = async () => {
      const status = callerIdStatus();
      if (running.current || !status.enabled || Date.now() - status.updatedAt < CALLER_REFRESH_MS)
        return;
      running.current = true;
      try {
        updateCallerId(await loadCallerEntries());
      } catch (error) {
        log.exception(error, 'contacts.caller_id_sync_failed');
      } finally {
        running.current = false;
      }
    };
    void sync();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void sync();
    });
    return () => subscription.remove();
  }, [canRead]);
}
