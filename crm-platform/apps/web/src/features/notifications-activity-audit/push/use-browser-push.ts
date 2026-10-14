'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { PushDevice } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { useRealtimeStatus } from '@/lib/realtime';
import { NOTIFICATION_KEYS } from '../api/keys';
import { notificationsApi } from '../api/service';
import {
  PermissionNotGranted,
  currentSubscription,
  disableOnThisDevice,
  enableOnThisDevice,
  saveDeviceId,
  savedDeviceId,
} from './client';
import {
  pushUiState,
  readPushEnv,
  testOutcome,
  type PushEnv,
  type PushUiState,
  type TestOutcome,
} from './support';

const KEY_STALE_MS = 10 * 60_000;

/** What the browser says right now (support, permission, this device's saved id), as one comparable string. */
const browserSnapshot = () => JSON.stringify({ env: readPushEnv(), deviceId: savedDeviceId() });
const changeListeners = new Set<() => void>();
/** Tells every reader the browser's answer may have changed (after Enable or Turn off: permission and the saved id moved). */
const browserChanged = () => {
  for (const l of [...changeListeners]) l();
};
/**
 * The browser is an external system: it changes without React (the person edits the site's permission in the browser's settings and
 * comes back, or enables the device in another tab). So it is read with `useSyncExternalStore`, which re-reads when the tab becomes
 * visible again, gets focus, or another tab changes storage.
 */
function subscribeBrowser(listener: () => void): () => void {
  changeListeners.add(listener);
  const onVisible = () => {
    if (document.visibilityState === 'visible') listener();
  };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', listener);
  window.addEventListener('storage', listener);
  return () => {
    changeListeners.delete(listener);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('focus', listener);
    window.removeEventListener('storage', listener);
  };
}

/** Whether this deployment has browser notifications at all (and the key). One cached answer for the card and the Push column. */
export function usePushDeployment() {
  const query = useQuery({
    queryKey: NOTIFICATION_KEYS.pushKey,
    queryFn: ({ signal }) => notificationsApi.pushPublicKey(signal),
    staleTime: KEY_STALE_MS,
    retry: false,
  });
  return {
    configured: query.data?.enabled === true,
    publicKey: query.data?.publicKey ?? null,
    loading: query.isPending,
  };
}

export type PushProblem = 'enable_failed' | 'disable_failed' | 'remove_failed' | 'test_failed';

export interface BrowserPush {
  state: PushUiState;
  devices: PushDevice[] | undefined;
  devicesFailed: boolean;
  /** The id the server gave THIS browser, to mark it in the list. */
  thisDeviceId: string | null;
  busy: 'enable' | 'disable' | 'remove' | 'test' | null;
  problem: PushProblem | null;
  testResult: TestOutcome | 'wait' | null;
  /** Whether the last test also wrote a bell row (the in-app path: bell, toast, tab title). Null before a test, and after a refused one. */
  testInApp: boolean | null;
  /** The live socket is connected right now, so the in-app part of the test can show on this page. */
  liveConnected: boolean;
  /** Asks the browser for permission and subscribes. Only ever call it from the person's click. */
  enable(): Promise<void>;
  disable(): Promise<void>;
  remove(id: string): Promise<void>;
  sendTest(): Promise<void>;
  dismissProblem(): void;
}

/**
 * Browser notifications on this device: what the browser can do, whether this device is enabled (the browser holds a subscription AND
 * the server lists the device), the person's devices, and the four actions. Permission is requested only inside `enable`, which the
 * card calls from the click on "Enable"; nothing here asks on page load.
 */
export function useBrowserPush(): BrowserPush {
  const qc = useQueryClient();
  const deployment = usePushDeployment();
  const raw = useSyncExternalStore(subscribeBrowser, browserSnapshot, () => '');
  const { env, thisDeviceId } = useMemo(() => {
    if (!raw) return { env: null as PushEnv | null, thisDeviceId: null as string | null };
    const parsed = JSON.parse(raw) as { env: PushEnv; deviceId: string | null };
    return { env: parsed.env, thisDeviceId: parsed.deviceId };
  }, [raw]);
  const [hasSubscription, setHasSubscription] = useState(false);
  const [busy, setBusy] = useState<BrowserPush['busy']>(null);
  const [problem, setProblem] = useState<PushProblem | null>(null);
  const [testResult, setTestResult] = useState<BrowserPush['testResult']>(null);
  const [testInApp, setTestInApp] = useState<boolean | null>(null);
  const liveConnected = useRealtimeStatus() === 'connected';

  // Whether the browser holds a push subscription is answered asynchronously; ask again whenever what the browser says changed.
  useEffect(() => {
    let current = true;
    if (!env || env.permission !== 'granted') {
      void Promise.resolve().then(() => current && setHasSubscription(false));
    } else {
      void currentSubscription().then((sub) => current && setHasSubscription(sub !== null));
    }
    return () => {
      current = false;
    };
  }, [env, thisDeviceId]);

  const devicesQuery = useQuery({
    queryKey: NOTIFICATION_KEYS.pushDevices,
    queryFn: ({ signal }) => notificationsApi.pushDevices(signal),
    enabled: deployment.configured,
    retry: false,
  });
  const devices = devicesQuery.data?.items;
  const known = !!thisDeviceId && !!devices?.some((d) => d.id === thisDeviceId);

  let state = pushUiState({
    configured: deployment.loading ? true : deployment.configured,
    env,
    subscribed: hasSubscription && known,
  });
  // The device list is still loading for a browser that may be enabled: do not flash "Enable" first.
  if (
    state === 'off' &&
    deployment.configured &&
    env?.permission === 'granted' &&
    hasSubscription &&
    devicesQuery.isPending
  ) {
    state = 'checking';
  }
  if (deployment.loading) state = 'checking';

  const invalidateDevices = () => qc.invalidateQueries({ queryKey: NOTIFICATION_KEYS.pushDevices });

  const enable = useCallback(async () => {
    if (!deployment.publicKey || busy) return;
    setBusy('enable');
    setProblem(null);
    setTestResult(null);
    setTestInApp(null);
    try {
      const subscription = await enableOnThisDevice(deployment.publicKey);
      const device = await notificationsApi.addPushDevice(subscription);
      saveDeviceId(device.id);
      await invalidateDevices();
    } catch (err) {
      // Declining the browser's prompt is an answer, not a failure: the card just shows the new state.
      if (!(err instanceof PermissionNotGranted)) setProblem('enable_failed');
    } finally {
      browserChanged();
      setBusy(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deployment.publicKey, busy]);

  const removeOnServer = useCallback(async (id: string) => {
    try {
      await notificationsApi.removePushDevice(id);
    } catch (err) {
      // Already gone is what the person wanted.
      if (!(err instanceof ApiError && err.status === 404)) throw err;
    }
  }, []);

  const disable = useCallback(async () => {
    if (busy) return;
    setBusy('disable');
    setProblem(null);
    setTestResult(null);
    setTestInApp(null);
    try {
      const id = savedDeviceId();
      if (id) await removeOnServer(id);
      await disableOnThisDevice();
      saveDeviceId(null);
      await invalidateDevices();
    } catch {
      setProblem('disable_failed');
    } finally {
      browserChanged();
      setBusy(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, removeOnServer]);

  const remove = useCallback(
    async (id: string) => {
      if (busy) return;
      if (id === savedDeviceId()) return disable();
      setBusy('remove');
      setProblem(null);
      try {
        await removeOnServer(id);
        await invalidateDevices();
      } catch {
        setProblem('remove_failed');
      } finally {
        setBusy(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busy, disable, removeOnServer],
  );

  const sendTest = useCallback(async () => {
    if (busy) return;
    setBusy('test');
    setProblem(null);
    setTestResult(null);
    setTestInApp(null);
    try {
      const result = await notificationsApi.sendPushTest();
      setTestResult(testOutcome(result));
      setTestInApp(result.inApp);
      await invalidateDevices();
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) setTestResult('wait');
      else setProblem('test_failed');
    } finally {
      setBusy(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

  return {
    state,
    devices,
    devicesFailed: devicesQuery.isError,
    thisDeviceId,
    busy,
    problem,
    testResult,
    testInApp,
    liveConnected,
    enable,
    disable,
    remove,
    sendTest,
    dismissProblem: () => setProblem(null),
  };
}
