import type { UpdateNotificationPreferencesRequest } from '@crm/contracts';
import type { QueryClient } from '@tanstack/react-query';
import { preferencesKey, type PrefsState } from './preferences-model';

/**
 * Puts `next` in the cache at once and hands back the way to undo it: the state as it was. The undo is only taken when the cache still
 * holds `next`, so a later change (another switch, a refetch) is never overwritten by an older rollback.
 */
export function applyOptimistic(queryClient: QueryClient, next: PrefsState): () => void {
  const previous = queryClient.getQueryData<PrefsState>(preferencesKey);
  queryClient.setQueryData<PrefsState>(preferencesKey, next);
  // The cache may hand back a structurally shared copy rather than `next` itself, so remember what it holds now.
  const applied = queryClient.getQueryData<PrefsState>(preferencesKey);
  return () => {
    if (previous && queryClient.getQueryData(preferencesKey) === applied) {
      queryClient.setQueryData<PrefsState>(preferencesKey, previous);
    }
  };
}

type Build = (state: PrefsState) => {
  next: PrefsState;
  request: UpdateNotificationPreferencesRequest | null;
};

/**
 * Saves the person's choices one after another (ported from the web's `PreferenceSaver`). Each change is put in the cache first (the screen
 * answers at once) and then sent; if the send fails the cache goes back and `fail` runs. When the last queued save has settled the screen
 * reads again, so what it shows ends as the server's truth. No React in here.
 */
export class PreferenceSaver {
  private queue: Promise<void> = Promise.resolve();
  private pending = 0;

  constructor(
    private readonly queryClient: QueryClient,
    private readonly send: (request: UpdateNotificationPreferencesRequest) => Promise<unknown>,
    private readonly on: { fail(): void; busy(busy: boolean): void; clear(): void },
  ) {}

  /** Applies a change; returns false when it changed nothing (nothing is sent). */
  run(build: Build): boolean {
    const current = this.queryClient.getQueryData<PrefsState>(preferencesKey);
    if (!current) return false;
    const { next, request } = build(current);
    if (next === current || !request) return false;
    this.on.clear();
    const undo = applyOptimistic(this.queryClient, next);
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
          void this.queryClient.invalidateQueries({ queryKey: preferencesKey });
        }
      }
    });
    return true;
  }

  /** Resolves when every queued save has settled. */
  idle(): Promise<void> {
    return this.queue;
  }
}
