import type { FlowGetaSync, GetaPublishStep } from '@crm/contracts';

/** What the editor shows next to the Published badge, decided from the server's sync state. */
export type GetaView =
  | { kind: 'hidden' }
  | { kind: 'pending' }
  | { kind: 'live' }
  | { kind: 'failed'; failedStep: GetaPublishStep | null; reason: string | null }
  /** Published here, no Geta credentials: a one-off notice right after Publish, never a permanent badge. */
  | { kind: 'not_configured' }
  /** Published, credentials exist, but nothing was pushed yet (they were added afterwards). */
  | { kind: 'push' };

export function viewOf(
  sync: FlowGetaSync | null,
  opts: { published: boolean; justPublished: boolean },
): GetaView {
  if (!sync || !opts.published) return { kind: 'hidden' };
  switch (sync.state) {
    case 'pending':
      return { kind: 'pending' };
    case 'live':
      return { kind: 'live' };
    case 'failed':
      return { kind: 'failed', failedStep: sync.failedStep, reason: sync.lastError };
    case 'not_configured':
      return opts.justPublished ? { kind: 'not_configured' } : { kind: 'hidden' };
    case 'none':
      return sync.configured ? { kind: 'push' } : { kind: 'hidden' };
  }
}

/** The status poll: how often it asks, and when it gives up (the page then still shows "Going live..." until reloaded). */
export const POLL_EVERY_MS = 1500;
export const POLL_MAX_TRIES = 90;
