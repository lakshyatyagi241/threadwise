'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { DevicePairing } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { KEYS, deviceApi } from '../api/devices';
import {
  isTerminalPhase,
  nextPollDelay,
  pairingPhase,
  type PairingPhase,
} from '../lib/pairing-model';

/** True while the tab is in the background: the poll stops then, because a rotating QR nobody sees is a request for nothing. */
export function useDocumentHidden(): boolean {
  const [hidden, setHidden] = useState(
    typeof document !== 'undefined' && document.visibilityState === 'hidden',
  );
  useEffect(() => {
    const on = () => setHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return hidden;
}

/** A clock that ticks once a second while `active`, for the countdowns. Stops with the dialog. */
export function useNow(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);
  return now;
}

export interface PairingPoll {
  data: DevicePairing | undefined;
  /** When this page got `data` (ms); the QR ring counts from here. */
  receivedAt: number;
  /** The attempt no longer exists on the server (it ended or expired): `DEVICE_NO_PAIRING`. */
  gone: boolean;
  error: unknown;
}

/**
 * Reads `GET /v2/devices/:id/pairing` every 2 seconds while `active` (the dialog is open on the link step and an attempt was
 * started). It stops when the dialog closes, when the tab is hidden and once the attempt has ended; it resumes at once when the tab
 * comes back. The answer holds the QR and the code: the query is never cached (`gcTime: 0`) and is removed when the dialog goes away.
 */
export function usePairingPoll(deviceId: string, active: boolean): PairingPoll {
  const qc = useQueryClient();
  const hidden = useDocumentHidden();
  const key = KEYS.pairing(deviceId);
  const q = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => deviceApi.pairing(deviceId, signal),
    enabled: active,
    gcTime: 0,
    staleTime: 0,
    retry: false,
    // A finished attempt is not read again when the window gets focus.
    refetchOnWindowFocus: (query) => !isTerminalPhase(pairingPhase(query.state.data, Date.now())),
    refetchIntervalInBackground: false,
    refetchInterval: (query) => {
      if (query.state.error instanceof ApiError && query.state.error.code === 'DEVICE_NO_PAIRING') {
        return false;
      }
      const phase: PairingPhase = pairingPhase(query.state.data, Date.now());
      // 429 on the read means "slow down", not a failure: keep the last answer on screen and read less often.
      const rateLimited = query.state.error instanceof ApiError && query.state.error.status === 429;
      return nextPollDelay({ open: active, hidden, phase, rateLimited });
    },
  });

  const refetch = q.refetch;
  useEffect(() => {
    if (active && !hidden) void refetch();
  }, [active, hidden, refetch]);

  useEffect(
    () => () => {
      qc.removeQueries({ queryKey: key });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [qc, deviceId],
  );

  return {
    data: q.data,
    receivedAt: q.dataUpdatedAt,
    gone: q.error instanceof ApiError && q.error.code === 'DEVICE_NO_PAIRING',
    error: q.error,
  };
}
