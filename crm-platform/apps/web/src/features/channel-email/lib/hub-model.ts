import type {
  MailboxListResponse,
  MailboxResponse,
  MailboxStatus,
  MailProvider,
  MailProviderInfo,
  MailScope,
  MailWorkspaceSettings,
} from '@crm/contracts';
import { MAIL_SEND_LIMIT_MAX, isUnlimitedLimit } from '@crm/contracts';

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

/**
 * Disconnect (what "Remove" calls) revokes the grant and wipes tokens but keeps the row, so a disconnected
 * mailbox's history stays attached and reconnecting the same address reattaches it. Once already disconnected
 * there is nothing left for the action to do, so the button is hidden rather than offered and silently no-op.
 */
export const canRemove = (m: Pick<MailboxResponse, 'status'>) => m.status !== 'disconnected';

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
  const unlimited = isUnlimitedLimit(limit);
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

export type ProviderState = 'ready' | 'not_ready' | 'limit' | 'no_permission';

/** The order the hub lists providers in, and what is shown while the provider list is not known. */
export const PROVIDER_ORDER: readonly MailProvider[] = ['google', 'microsoft', 'imap'];

/**
 * What one provider card does: its Connect button works, or it explains why not. The platform setup (`ready`) comes first, then the
 * plan limit, then the person's right to connect in the chosen scope.
 */
export function providerState(
  info: Pick<MailProviderInfo, 'ready'> | undefined,
  list: Pick<MailboxListResponse, 'used' | 'limit'> | undefined,
  mayConnect: boolean,
): ProviderState {
  if (!mayConnect) return 'no_permission';
  if (info && !info.ready) return 'not_ready';
  if (usageOf(list).reached) return 'limit';
  return 'ready';
}

/** Providers in hub order; one the API does not list is left out. When the list could not be loaded, a stand-in keeps the hub usable. */
export function orderedProviders(
  data: readonly MailProviderInfo[] | undefined,
  fallbackGoogleReady: boolean,
): MailProviderInfo[] {
  if (data) {
    return PROVIDER_ORDER.flatMap((p) => data.filter((i) => i.provider === p));
  }
  return [
    {
      provider: 'google',
      label: 'Google',
      kind: 'oauth',
      ready: fallbackGoogleReady,
      notReadyReason: null,
    },
    {
      provider: 'microsoft',
      label: 'Microsoft 365',
      kind: 'oauth',
      ready: false,
      notReadyReason: null,
    },
    { provider: 'imap', label: 'IMAP', kind: 'password', ready: true, notReadyReason: null },
  ];
}

export interface ScopeRights {
  /** The viewer may connect a shared (company) mailbox. */
  shared: boolean;
  /** The viewer may connect a personal mailbox: the workspace allows it and the viewer holds the right (admins only, or any agent). */
  personal: boolean;
}

/**
 * Which scopes the viewer may connect. The server decides again (MAIL_PERSONAL_DISABLED / MAIL_PERSONAL_NOT_ALLOWED); this keeps the
 * choice from offering what would be refused. `isAdmin` is the holder of `mail.settings.manage`.
 */
export function scopeRights(
  settings:
    Pick<MailWorkspaceSettings, 'personalMailboxesEnabled' | 'whoMayConnectPersonal'> | undefined,
  perms: { manage: boolean; managePersonal: boolean; isAdmin: boolean },
): ScopeRights {
  const personal =
    !!settings?.personalMailboxesEnabled &&
    perms.managePersonal &&
    (settings.whoMayConnectPersonal === 'agents' || perms.isAdmin);
  return { shared: perms.manage, personal };
}

/** The scope a connect goes out with: the picked one when allowed, otherwise the only one the viewer has. */
export function effectiveScope(picked: MailScope, rights: ScopeRights): MailScope | null {
  if (picked === 'personal' && rights.personal) return 'personal';
  if (picked === 'shared' && rights.shared) return 'shared';
  if (rights.shared) return 'shared';
  if (rights.personal) return 'personal';
  return null;
}

export interface MailboxAccess {
  /** A personal mailbox of someone else: only a summary row is shown. */
  summaryOnly: boolean;
  /** Rename, send limit, sync, reconnect, remove. */
  canAct: boolean;
  /** The conversations may be opened (own mailbox, shared, or another's personal one the policy lets admins read). */
  canOpen: boolean;
}

/** What the viewer may do with one mailbox card: owners act on their personal mailbox, managers on the shared ones. */
export function mailboxAccess(
  m: Pick<MailboxResponse, 'scope' | 'ownerUserId' | 'channelId'>,
  viewer: { id: string; manage: boolean; managePersonal: boolean },
  adminsCanReadPersonal: boolean,
): MailboxAccess {
  if (m.scope !== 'personal') {
    return { summaryOnly: false, canAct: viewer.manage, canOpen: !!m.channelId };
  }
  if (m.ownerUserId === viewer.id) {
    return {
      summaryOnly: false,
      canAct: viewer.manage || viewer.managePersonal,
      canOpen: !!m.channelId,
    };
  }
  return {
    summaryOnly: !adminsCanReadPersonal,
    canAct: false,
    canOpen: adminsCanReadPersonal && !!m.channelId,
  };
}

/** The hourly send limit field: empty = the platform default, otherwise a whole number from 1 to the contract's maximum. */
export function sendLimitDraft(
  draft: string,
  current: number | null,
): { ok: boolean; value: number | null; changed: boolean } {
  const text = draft.trim();
  if (text === '') return { ok: true, value: null, changed: current !== null };
  if (!/^\d+$/.test(text)) return { ok: false, value: null, changed: false };
  const n = Number(text);
  const ok = n >= 1 && n <= MAIL_SEND_LIMIT_MAX;
  return { ok, value: ok ? n : null, changed: ok && n !== current };
}

export interface SharingDraft {
  personalMailboxesEnabled: boolean;
  whoMayConnectPersonal: MailWorkspaceSettings['whoMayConnectPersonal'];
  adminsCanReadPersonal: boolean;
}

/** The "Email sharing" form has something to save only when it differs from the policy that was read. */
export function sharingDirty(current: SharingDraft, draft: SharingDraft): boolean {
  return (
    current.personalMailboxesEnabled !== draft.personalMailboxesEnabled ||
    current.whoMayConnectPersonal !== draft.whoMayConnectPersonal ||
    current.adminsCanReadPersonal !== draft.adminsCanReadPersonal
  );
}
