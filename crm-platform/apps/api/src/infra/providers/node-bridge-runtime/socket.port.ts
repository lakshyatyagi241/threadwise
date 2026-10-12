/**
 * The WhatsApp socket as the runtime sees it (TW-NODE-011). A narrow port: the session state machine, the status reporting and
 * the tests are written against it, and only the Baileys adapter knows the library. A fake implements it in the tests.
 */

import type { GroupEvent, GroupSnapshot, ReceiptUpdate } from './inbound.port';
import type { Normalized } from './inbound-normalizer';
import type { MessageAction, SendCommand, SendContext, SendOutcome } from './outbound.port';

export type SocketEvent =
  | { type: 'connecting' }
  | { type: 'qr'; qr: string }
  /** The link is up. `linkedId` is WhatsApp's own id for the account that scanned (digits, then an optional `:device`, then `@domain`). */
  | { type: 'open'; linkedId: string | undefined }
  | { type: 'close'; code: number | undefined; message?: string }
  /** The credentials changed and have already been persisted by the adapter. The first one after a QR means the scan succeeded. */
  | { type: 'creds' }
  /** A message the library delivered, already normalized (TW-NODE-016, 018). Replays, status and empty events are not delivered. */
  | {
      type: 'message';
      normalized: Normalized;
      /** A customer's file, downloaded at capture (it cannot be fetched later without the live message). Absent when too large or it failed. */
      media?: Buffer;
    }
  /** Delivery progress of a message we sent (TW-NODE-020). */
  | { type: 'receipt'; receipt: ReceiptUpdate }
  /**
   * The groups this account is in changed (TW-NODE-021). `complete` (default true): the list is every group the account is in, so a group
   * missing from it was left; false: only these groups were re-read (after one change), nothing is implied about the others.
   */
  | { type: 'groups'; groups: GroupSnapshot[]; complete?: boolean }
  /** One change in one group, as it happens (subject, settings, members, a join request). Debounce is the consumer's business. */
  | { type: 'group_event'; event: GroupEvent };

export interface WaSocket {
  /** One listener per socket. Events from a socket that has been ended are not delivered. */
  subscribe(listener: (event: SocketEvent) => void): void;
  /** Asks WhatsApp for the 8-character code that links this phone without a QR (TW-NODE-009). */
  requestPairingCode(phoneDigits: string): Promise<string>;
  /** Unlinks the device from the phone (the unlink RPC). Only on user intent. */
  logout(): Promise<void>;
  /** Closes the connection, keeps the session. Used on shutdown and before starting over. */
  end(): void;
  /** Sends one message. Sends through one socket run one at a time (TW-NODE-029 rule 3). */
  send(command: SendCommand, context: SendContext): Promise<SendOutcome>;
  /** Reacts to, pins, stars, edits or deletes a message (TW-NODE-025). */
  act(action: MessageAction): Promise<void>;
  /** Group directory and management (TW-NODE-021). */
  groups(action: GroupAction): Promise<GroupResult>;
}

/**
 * Group directory and management on a device's number. Every `groupJid` is the bare id or `...@g.us`; every participant is a phone number
 * (digits) or a WhatsApp id (`...@s.whatsapp.net`, `...@lid`, kept as given). The API enforces the admin and limit rules before it asks.
 */
export type GroupAction =
  | { type: 'list' }
  | { type: 'metadata'; groupJid: string }
  /** `description` is set by a second best-effort call; the result's `descriptionSet` says whether it worked. */
  | { type: 'create'; subject: string; participants: string[]; description?: string }
  | {
      type: 'participants';
      groupJid: string;
      participants: string[];
      change: 'add' | 'remove' | 'promote' | 'demote';
    }
  | { type: 'subject'; groupJid: string; subject: string }
  | { type: 'description'; groupJid: string; description: string }
  | {
      type: 'settings';
      groupJid: string;
      setting: 'announcement' | 'not_announcement' | 'locked' | 'unlocked';
    }
  | { type: 'member_add_mode'; groupJid: string; mode: 'all_member_add' | 'admin_add' }
  | { type: 'join_approval'; groupJid: string; enabled: boolean }
  /** Pending join requests (the recovery path when the event was missed). */
  | { type: 'join_requests'; groupJid: string }
  /** `participants` are the `jid` of the requests. */
  | {
      type: 'join_request_update';
      groupJid: string;
      participants: string[];
      action: 'approve' | 'reject';
    }
  | { type: 'leave'; groupJid: string }
  /** Reads the current invite code (admin only). */
  | { type: 'invite'; groupJid: string }
  /** Makes the old invite code stop working and returns a new one. */
  | { type: 'revoke_invite'; groupJid: string }
  /**
   * The group picture. The image travels as `data` in this process, or as `bufferKey` (Redis) between processes; `remove: true` takes the
   * picture away. JPEG or PNG, at most 5 MB (the API checks).
   */
  | { type: 'picture'; groupJid: string; data?: Buffer; bufferKey?: string; remove?: boolean }
  /** What an invite link points at, without joining. `code` is the bare code (`inviteCodeOf`). */
  | { type: 'get_invite_info'; code: string }
  /** Joins by invite link. The highest ban-risk action: has its own cap. */
  | { type: 'accept_invite'; code: string };

/** WhatsApp's answer for one person: its status code (`200` done, `403`, `404`, `408`, `409`, `419`...), as a string, with their id. */
export interface GroupParticipantStatus {
  jid: string;
  status: string;
}

/** One person waiting to be let in. `phone` is digits. */
export interface GroupJoinRequestSnapshot {
  jid: string;
  phone: string | null;
  lid: string | null;
  name: string | null;
  /** ISO time. */
  requestedAt: string | null;
}

/** What an invite code points at (`get_invite_info`). */
export interface GroupInviteInfo {
  groupId: string;
  subject: string | null;
  description: string | null;
  size: number | null;
  /** Joining needs an admin's approval: it becomes a request. */
  joinApproval: boolean;
}

/**
 * The answer of a group action, which crosses Redis as JSON. Tell them apart with `in`:
 * `list` -> `{ groups }`; `metadata` -> `{ group }`; `create` -> `{ group, participants, descriptionSet }`;
 * `participants` and `join_request_update` -> `{ participants }` (one status per person asked); `join_requests` -> `{ requests }`;
 * `invite` and `revoke_invite` -> `{ code }`; `get_invite_info` -> `{ invite }`; `accept_invite` -> `{ joined }`;
 * everything else (`subject`, `description`, `settings`, `member_add_mode`, `join_approval`, `picture`, `leave`) -> `{ ok: true }`.
 */
export type GroupResult =
  | { groups: GroupSnapshot[] }
  | { group: GroupSnapshot; participants?: GroupParticipantStatus[]; descriptionSet?: boolean }
  | { code: string }
  | { participants: GroupParticipantStatus[] }
  | { requests: GroupJoinRequestSnapshot[] }
  | { invite: GroupInviteInfo }
  /** `groupId` null: no id came back, which means the group wants approval and the request was sent. */
  | { joined: { groupId: string | null; requested: boolean } }
  | { ok: true };

/** How to reach WhatsApp for one device: directly, or through its own proxy (TW-NODE-013). */
export interface ProxySettings {
  type: 'http' | 'socks5';
  host: string;
  port: number;
  username: string | null;
  password: string | null;
}

export interface SocketTarget {
  orgId: number;
  deviceId: number;
  /** The phone this device was created for, as digits. */
  phoneDigits: string;
  /** Null means a direct connection. A proxy that cannot be reached must make `create` throw, never fall back to direct. */
  proxy: ProxySettings | null;
}

export interface WaSocketFactory {
  /** Opens a socket for the device, loading its saved session (or starting a fresh one). */
  create(target: SocketTarget): Promise<WaSocket>;
  /** Forgets the device's saved session: the next connect starts from a QR. */
  deleteSession(orgId: number, deviceId: number): Promise<void>;
}
export const WA_SOCKET_FACTORY = Symbol('WA_SOCKET_FACTORY');
