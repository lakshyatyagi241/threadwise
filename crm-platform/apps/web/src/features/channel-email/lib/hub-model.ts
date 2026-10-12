import type { MailboxListResponse, MailboxResponse, MailboxStatus } from '@crm/contracts';

export type StatusTone = 'success' | 'warning' | 'danger' | 'neutral';

/** Chip tone and message key (under `email.status`) of a mailbox. */
export function statusView(status: MailboxStatus): { tone: StatusTone; key: MailboxStatus } {
  switch (status) {
    case 'connected':
      return { tone: 'success', key: status };
    case 'needs_reauth':
      return { tone: 'warning', key: status };
    case 'error':
      return { tone: 'danger', key: status };
    default:
      return { tone: 'neutral', key: status };
  }
}

/** A mailbox can be synced by hand only while it is healthy; a reconnect fixes the others. */
export const canSync = (m: Pick<MailboxResponse, 'status'>) =>
  m.status === 'connected' || m.status === 'error';

export const needsReconnect = (m: Pick<MailboxResponse, 'status'>) =>
  m.status === 'needs_reauth' || m.status === 'disconnected';

/** Where "Open in inbox" goes: the inbox filtered by this mailbox's channel. Null until the first sync created the channel. */
export const inboxHref = (m: Pick<MailboxResponse, 'channelId'>): string | null =>
  m.channelId ? `/inbox?channel=${encodeURIComponent(m.channelId)}` : null;

export interface Usage {
  used: number;
  limit: number;
  unlimited: boolean;
  reached: boolean;
}

/** `limit` 0 means unlimited (the plan's `email_mailboxes`). */
export function usageOf(list: Pick<MailboxListResponse, 'used' | 'limit'> | undefined): Usage {
  const used = list?.used ?? 0;
  const limit = list?.limit ?? 0;
  const unlimited = limit <= 0;
  return { used, limit, unlimited, reached: !unlimited && used >= limit };
}

export type ConnectState = 'ready' | 'not_ready' | 'limit' | 'no_permission';

/** What the Connect Gmail button does: offered, replaced by who to ask, or explained. */
export function connectState(
  list: Pick<MailboxListResponse, 'used' | 'limit' | 'providerReady'> | undefined,
  canManage: boolean,
): ConnectState {
  if (!canManage) return 'no_permission';
  if (list && !list.providerReady) return 'not_ready';
  if (usageOf(list).reached) return 'limit';
  return 'ready';
}

/** A display name is saved only when it changed and is 1 to 80 characters after trimming. */
export function nameDraft(
  current: string,
  draft: string,
): { ok: boolean; value: string; changed: boolean } {
  const value = draft.trim();
  return { ok: value.length >= 1 && value.length <= 80, value, changed: value !== current };
}
