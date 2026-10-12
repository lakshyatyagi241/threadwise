import type { GoogleMailError } from '../../infra/providers/channel-email';

/**
 * The pure decisions of a mailbox sync (TW-MAIL-021), apart from the I/O so they can be tested to the corner.
 */

export type SyncMode =
  /** No cursor yet: the first run reads the last days of the INBOX, stored quietly. */
  | 'backfill'
  /** The cursor Gmail no longer keeps (404): re-read the last days, stored quietly, and take a new cursor. */
  | 'repair'
  /** The normal run: what was added since the cursor, stored as live mail. */
  | 'history';

/** Backfilled and repaired mail is history (no unread, no notifications, no automation); only live mail alerts. */
export const isQuiet = (mode: SyncMode): boolean => mode !== 'history';

export interface Candidate {
  id: string;
  threadId: string;
  /** Known only from a history page; a list page does not carry labels. */
  labelIds: string[] | null;
}

/** A candidate that need not be downloaded: Gmail already told us it is a draft, spam or trash. */
export function skippableByLabels(labelIds: string[] | null): boolean {
  return Boolean(labelIds && labelIds.some((l) => l === 'DRAFT' || l === 'SPAM' || l === 'TRASH'));
}

/**
 * Orders the unseen candidates oldest first (Gmail lists newest first, and a thread reads in order) and cuts at `cap`.
 * `leftover` says some unseen mail waits for the next run: the cursor must then NOT advance.
 */
export function planBatch<T extends { id: string }>(
  unseenNewestFirst: T[],
  cap: number,
): { batch: T[]; leftover: boolean } {
  const oldestFirst = [...unseenNewestFirst].reverse();
  return { batch: oldestFirst.slice(0, cap), leftover: oldestFirst.length > cap };
}

/** The Gmail search for a backfill or a repair: the INBOX of the last `days` days. */
export const backfillQuery = (days: number): string => `newer_than:${days}d`;

/** What an error of Google means for the mailbox row and for the job. */
export interface FailurePlan {
  /** The text the hub shows. Never Google's own words. */
  message: string;
  /** Rethrow to the queue (backoff and more attempts) or leave the job done. */
  retry: boolean;
}

export function planFailure(err: GoogleMailError): FailurePlan {
  switch (err.kind) {
    case 'invalid_client':
      return {
        message: 'Google refused the platform credentials. Contact your platform administrator.',
        retry: false,
      };
    case 'forbidden':
      return {
        message:
          'Google denied access to this mailbox. Reconnect it and allow reading and sending mail, or ask your platform administrator to enable the Gmail API.',
        retry: false,
      };
    case 'bad_request':
      return { message: 'Google rejected the sync request.', retry: false };
    case 'rate_limit':
      return {
        message: 'Google is limiting requests right now. Syncing will retry shortly.',
        retry: true,
      };
    case 'timeout':
    case 'network':
    case 'server':
    case 'auth':
      return { message: 'Google did not answer. Syncing will retry shortly.', retry: true };
    default:
      return { message: 'The sync failed. It will be retried.', retry: true };
  }
}

/** The sweeper picks a mailbox in `error` again only after this long, so a broken one is not hammered every minute. */
export const ERROR_BACKOFF_MINUTES = 5;
