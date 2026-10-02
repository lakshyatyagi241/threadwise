/**
 * The WhatsApp socket as the runtime sees it (TW-NODE-011). A narrow port: the session state machine, the status reporting and
 * the tests are written against it, and only the Baileys adapter knows the library. A fake implements it in the tests.
 */

export type SocketEvent =
  | { type: 'connecting' }
  | { type: 'qr'; qr: string }
  /** The link is up. `linkedId` is WhatsApp's own id for the account that scanned (digits, then an optional `:device`, then `@domain`). */
  | { type: 'open'; linkedId: string | undefined }
  | { type: 'close'; code: number | undefined; message?: string }
  /** The credentials changed and have already been persisted by the adapter. The first one after a QR means the scan succeeded. */
  | { type: 'creds' };

export interface WaSocket {
  /** One listener per socket. Events from a socket that has been ended are not delivered. */
  subscribe(listener: (event: SocketEvent) => void): void;
  /** Asks WhatsApp for the 8-character code that links this phone without a QR (TW-NODE-009). */
  requestPairingCode(phoneDigits: string): Promise<string>;
  /** Unlinks the device from the phone (the unlink RPC). Only on user intent. */
  logout(): Promise<void>;
  /** Closes the connection, keeps the session. Used on shutdown and before starting over. */
  end(): void;
}

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
