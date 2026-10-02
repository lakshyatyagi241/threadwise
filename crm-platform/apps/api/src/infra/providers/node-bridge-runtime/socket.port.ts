/**
 * The WhatsApp socket as the runtime sees it (WD-NODE-011). A narrow port: the session state machine, the status reporting and
 * the tests are written against it, and only the Baileys adapter knows the library. A fake implements it in the tests.
 */

import type { GroupSnapshot, ReceiptUpdate } from './inbound.port';
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
  /** A message the library delivered, already normalized (WD-NODE-016, 018). Replays, status and empty events are not delivered. */
  | { type: 'message'; normalized: Normalized }
  /** Delivery progress of a message we sent (WD-NODE-020). */
  | { type: 'receipt'; receipt: ReceiptUpdate }
  /** The groups this account is in changed (WD-NODE-021). */
  | { type: 'groups'; groups: GroupSnapshot[] };

export interface WaSocket {
  /** One listener per socket. Events from a socket that has been ended are not delivered. */
  subscribe(listener: (event: SocketEvent) => void): void;
  /** Asks WhatsApp for the 8-character code that links this phone without a QR (WD-NODE-009). */
  requestPairingCode(phoneDigits: string): Promise<string>;
  /** Unlinks the device from the phone (the unlink RPC). Only on user intent. */
  logout(): Promise<void>;
  /** Closes the connection, keeps the session. Used on shutdown and before starting over. */
  end(): void;
  /** Sends one message. Sends through one socket run one at a time (WD-NODE-029 rule 3). */
  send(command: SendCommand, context: SendContext): Promise<SendOutcome>;
  /** Reacts to, pins, stars, edits or deletes a message (WD-NODE-025). */
  act(action: MessageAction): Promise<void>;
  /** Group directory and management (WD-NODE-021). */
  groups(action: GroupAction): Promise<GroupResult>;
}

export type GroupAction =
  | { type: 'list' }
  | { type: 'metadata'; groupJid: string }
  | { type: 'create'; subject: string; participants: string[] }
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
  | { type: 'leave'; groupJid: string }
  | { type: 'invite'; groupJid: string };

export type GroupResult =
  { groups: GroupSnapshot[] } | { group: GroupSnapshot } | { code: string } | { ok: true };

/** How to reach WhatsApp for one device: directly, or through its own proxy (WD-NODE-013). */
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
