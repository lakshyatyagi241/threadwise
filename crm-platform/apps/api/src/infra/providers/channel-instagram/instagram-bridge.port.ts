/**
 * The Instagram engine (the Instaflow bridge). Reference never talks to Meta for Instagram: it calls the engine under
 * `{url}/api/threadwise/*` with a shared secret, and the engine owns the login, the webhooks and the Graph calls (TW-IG-016).
 * A port so tests answer for the engine and the real adapter keeps the address rules in one place.
 */

/** Where the engine is and the secret both sides share. Read from the platform's engine connection; never logged. */
export interface BridgeConnection {
  url: string;
  secret: string;
}

/** An Instagram account on the engine. `connected` is null when the engine did not say. */
export interface BridgeAccount {
  id: string;
  username: string;
  name: string;
  avatar: string;
  connected: boolean | null;
}

/** A thread on the engine, as its list gives it. */
export interface BridgeConversation {
  id: string;
  /** The engine's id of the account the thread belongs to. */
  account: string;
  name: string;
  handle: string;
  avatar: string;
  /** When the engine last saw a message in it. */
  lastAt: string | null;
}

/** One message of a thread, in either direction. */
export interface BridgeMessage {
  id: string;
  fromMe: boolean;
  type: string;
  text: string;
  mediaUrl: string;
  /** The template's interactive buttons, as the engine ships them (`{title, url?}`), or null. */
  buttons: unknown[] | null;
  at: string | null;
}

export type BridgeResult<T> =
  | { ok: true; data: T }
  /** `error` is the engine's own words when it gave any; `status` is the HTTP status when it answered. */
  | { ok: false; error: string | null; status: number | null };

export interface InstagramBridgeApi {
  /**
   * Accounts on the engine. The engine answers nothing for a call with neither a workspace nor an owner, so a bare call can
   * never list another tenant's accounts. `workspace` returns the accounts stamped with this workspace (the connect-new flow);
   * `ownerEmail` returns the accounts of the engine user with that email (the picker). A failure answers an empty list.
   */
  accounts(q: { workspace?: number; ownerEmail?: string }): Promise<BridgeAccount[]>;
  /** The threads of one account, newest activity as the engine reports it. A failure answers an empty list. */
  conversations(account: string): Promise<BridgeConversation[]>;
  /** The messages of one thread. A failure answers an empty list. */
  messages(conversationId: string): Promise<BridgeMessage[]>;
  /** A signed one-time ticket for the sign-in popup; `data.url` is the engine's login entry point. */
  connectStart(workspace: number, returnUrl: string): Promise<BridgeResult<{ url: string }>>;
}

export interface InstagramBridgeFactory {
  with(conn: BridgeConnection): InstagramBridgeApi;
}
export const INSTAGRAM_BRIDGE = Symbol('INSTAGRAM_BRIDGE');
