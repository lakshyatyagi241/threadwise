'use client';

import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { UpdateNotificationPreferencesRequest } from '@crm/contracts';
import {
  applyChange,
  changeRequest,
  customTypes,
  resetAll,
  resetEntry,
  resetRequest,
  stateFromResponse,
  type PrefChannel,
  type PrefsState,
} from '../prefs/model';
import { NOTIFICATION_KEYS } from './keys';
import { notificationsApi } from './service';

/** Preferences change a few times a year; the live alerts read the cache, the screen refetches when it opens. */
const STALE_MS = 5 * 60_000;

/** The signed-in person's preferences. A failure leaves the live alerts on the type defaults; the screen shows an error and a retry. */
export function usePreferences(enabled = true) {
  return useQuery({
    queryKey: NOTIFICATION_KEYS.preferences,
    queryFn: async ({ signal }): Promise<PrefsState> =>
      stateFromResponse(await notificationsApi.preferences(signal)),
    enabled,
    staleTime: STALE_MS,
    retry: false,
  });
}

/**
 * Puts `next` in the cache at once and hands back the way to undo it: the state as it was. The undo is only taken when the cache
 * still holds `next`, so a later change (another switch, a refetch) is never overwritten by an older rollback.
 */
export function applyOptimistic(qc: QueryClient, next: PrefsState): () => void {
  const previous = qc.getQueryData<PrefsState>(NOTIFICATION_KEYS.preferences);
  qc.setQueryData<PrefsState>(NOTIFICATION_KEYS.preferences, next);
  // The cache may hand back a structurally shared copy rather than `next` itself, so remember what it holds now.
  const applied = qc.getQueryData<PrefsState>(NOTIFICATION_KEYS.preferences);
  return () => {
    if (previous && qc.getQueryData(NOTIFICATION_KEYS.preferences) === applied) {
      qc.setQueryData<PrefsState>(NOTIFICATION_KEYS.preferences, previous);
    }
  };
}

type Build = (state: PrefsState) => {
  next: PrefsState;
  request: UpdateNotificationPreferencesRequest | null;
};

/**
 * Saves the person's choices one after another. Each change is put in the cache first (the screen answers at once) and then sent;
 * if the send fails the cache goes back and `onFail` runs. When the last queued save has settled the screen refetches, so what it
 * shows ends as the server's truth even if a rollback was skipped because a later change had already replaced the cache.
 * No React in here: the hook below only gives it state setters, and the tests drive it with a fake send.
 */
export class PreferenceSaver {
  private queue: Promise<void> = Promise.resolve();
  private pending = 0;

  constructor(
    private readonly qc: QueryClient,
    private readonly send: (request: UpdateNotificationPreferencesRequest) => Promise<unknown>,
    private readonly on: { fail(): void; busy(busy: boolean): void; clear(): void },
  ) {}

  /** Applies a change; returns false when it changed nothing (nothing is sent). */
  run(build: Build): boolean {
    const current = this.qc.getQueryData<PrefsState>(NOTIFICATION_KEYS.preferences);
    if (!current) return false;
    const { next, request } = build(current);
    if (next === current || !request) return false;
    this.on.clear();
    const undo = applyOptimistic(this.qc, next);
    this.pending += 1;
    this.on.busy(true);
    this.queue = this.queue.then(async () => {
      try {
        await this.send(request);
      } catch {
        undo();
        this.on.fail();
      } finally {
        this.pending -= 1;
        if (this.pending === 0) {
          this.on.busy(false);
          void this.qc.invalidateQueries({ queryKey: NOTIFICATION_KEYS.preferences });
        }
      }
    });
    return true;
  }

  /** Resolves when every queued save has settled (tests, and a caller that must wait). */
  idle(): Promise<void> {
    return this.queue;
  }
}

export interface PreferenceActions {
  /** Turns one switch. The screen changes at once; a failed save puts it back and sets `failed`. */
  change(type: string, channel: PrefChannel, value: boolean): void;
  /** One type back to following the defaults. */
  reset(type: string): void;
  /** Every type the person changed back to the defaults. */
  resetEverything(): void;
  /** The last save failed (and was undone). */
  failed: boolean;
  /** A save is in flight. */
  saving: boolean;
  clearFailed(): void;
}

export function usePreferenceActions(): PreferenceActions {
  const qc = useQueryClient();
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const saver = useMemo(
    () =>
      new PreferenceSaver(qc, (request) => notificationsApi.updatePreferences(request), {
        fail: () => setFailed(true),
        busy: setSaving,
        clear: () => setFailed(false),
      }),
    [qc],
  );
  return useMemo(
    () => ({
      change: (type, channel, value) =>
        void saver.run((state) => {
          const next = applyChange(state, type, channel, value);
          return { next, request: changeRequest(next, type, channel) };
        }),
      reset: (type) =>
        void saver.run((state) => ({
          next: resetEntry(state, type),
          request: resetRequest([type]),
        })),
      resetEverything: () =>
        void saver.run((state) => ({
          next: resetAll(state),
          request: resetRequest(customTypes(state)),
        })),
      failed,
      saving,
      clearFailed: () => setFailed(false),
    }),
    [saver, failed, saving],
  );
}
