import type { MediaKind } from './media-types';

/**
 * What the chat media store needs from the rest of the platform. They are ports (`infra` may not import a domain module): the
 * app wires each to the real service in `app.module.ts`, and each of those services already has the shape, so nothing adapts.
 */

/** The cloud side: the platform's storage door (`MediaStorageService`). */
export const MEDIA_OBJECT_GATEWAY = Symbol('MEDIA_OBJECT_GATEWAY');
export interface ChatMediaObjectGateway {
  /** Which disk the platform settings choose right now. */
  destination(): Promise<{ disk: 'cloud' | 'local' }>;
  /** Writes to the bucket; null when media is local, so the caller writes it to its own disk. */
  put(key: string, body: Buffer, contentType: string): Promise<{ key: string } | null>;
  remove(key: string): Promise<void>;
  /** A link the server may fetch (signed for a private bucket). Never handed to a browser. */
  url(key: string, ttlSeconds?: number): Promise<string>;
}

/** The platform's upload policy (`UploadPolicyService`): extension allow-list plus a content signature check. */
export const MEDIA_UPLOAD_VALIDATOR = Symbol('MEDIA_UPLOAD_VALIDATOR');
export interface ChatMediaUploadValidator {
  /** Throws `AUTH_UPLOAD_REJECTED` for anything not allowed. */
  validate(input: { filename: string; buffer: Buffer; allow: MediaKind[]; maxBytes: number }): {
    ext: string;
    mime: string;
    storedName: string;
  };
}

/**
 * Optional: a rule for who may read a given media key beyond "it is in your workspace". The conversations domain binds one that
 * looks up the message holding the key and applies the conversation's visibility, so a link minted for one agent is refused
 * once the conversation is no longer theirs.
 */
export const MEDIA_ACCESS_POLICY = Symbol('MEDIA_ACCESS_POLICY');
export interface ChatMediaAccessPolicy {
  canRead(actor: { orgId: number; userId: number }, key: string): Promise<boolean>;
}
