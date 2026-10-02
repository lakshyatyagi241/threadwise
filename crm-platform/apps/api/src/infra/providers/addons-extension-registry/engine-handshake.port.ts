/**
 * The handshake with a standalone sibling product (the remote Instagram engine, the email engine): "connect by URL
 * and shared secret" (TW-ADD-017/019). The domain asks "is there a deployment of the right product at this URL that
 * accepts this secret?"; how that is checked (headers, timeouts, address rules) is the adapter's business.
 */
export type EngineKind = 'instagram' | 'email';

export interface HandshakeRequest {
  engine: EngineKind;
  /** Base URL, trailing slash already trimmed. */
  url: string;
  secret: string;
  /** The display name, used only to word the failure reason. */
  brand: string;
}

export interface HandshakeResult {
  ok: boolean;
  /** Why it failed, in words an operator can act on. Never contains the secret. */
  reason: string | null;
}

export interface EngineHandshakePort {
  handshake(req: HandshakeRequest): Promise<HandshakeResult>;
}

export const ENGINE_HANDSHAKE_PORT = Symbol('ENGINE_HANDSHAKE_PORT');
