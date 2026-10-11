import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/**
 * Passkeys (WebAuthn) as a phishing-resistant second factor.
 *
 * A passkey is added next to an enrolled authenticator app (so recovery codes exist), is offered at the second-factor
 * step of sign-in, and is removed when two-factor is turned off. The browser does the cryptography
 * (`@simplewebauthn/browser`); the server verifies it (`@simplewebauthn/server`). The credential JSON that travels is
 * validated by that library, so the contract only checks that it is an object.
 */

export const PASSKEY_NAME_MAX = 60;

export const passkeyItemSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  createdAt: z.string().datetime(),
  lastUsedAt: z.string().datetime().nullable(),
  /** singleDevice: a hardware key; multiDevice: a synced passkey (phone, password manager). */
  deviceType: z.enum(['singleDevice', 'multiDevice']),
  backedUp: z.boolean(),
  transports: z.array(z.string()),
});
export type PasskeyItem = z.infer<typeof passkeyItemSchema>;

export const passkeyListResponseSchema = z.object({ data: z.array(passkeyItemSchema) });
export type PasskeyListResponse = z.infer<typeof passkeyListResponseSchema>;

/** The browser's credential, as JSON. */
export const webauthnCredentialJsonSchema = z.record(z.string(), z.unknown());
export type WebauthnCredentialJson = z.infer<typeof webauthnCredentialJsonSchema>;

/** `POST …/passkeys/options`: ask for registration options. `password` is only needed when the session is older than the re-authentication window. */
export const passkeyOptionsRequestSchema = z
  .object({ password: z.string().min(1).max(256).optional() })
  .default({});
export type PasskeyOptionsRequest = z.infer<typeof passkeyOptionsRequestSchema>;

/** The options the browser passes to `navigator.credentials.create()/get()`; shape owned by the WebAuthn spec. */
export const webauthnOptionsResponseSchema = z.record(z.string(), z.unknown());
export type WebauthnOptionsResponse = z.infer<typeof webauthnOptionsResponseSchema>;

export const passkeyRegisterRequestSchema = z.object({
  response: webauthnCredentialJsonSchema,
  name: z.string().trim().min(1).max(PASSKEY_NAME_MAX),
  password: z.string().min(1).max(256).optional(),
});
export type PasskeyRegisterRequest = z.infer<typeof passkeyRegisterRequestSchema>;

export const passkeyRemoveRequestSchema = z.object({ password: z.string().min(1).max(256) });
export type PasskeyRemoveRequest = z.infer<typeof passkeyRemoveRequestSchema>;

/** `POST …/login/mfa/webauthn-options`: options for the second-factor step of a sign-in in progress. */
export const passkeyLoginOptionsRequestSchema = z.object({ challengeToken: z.string().min(1) });
export type PasskeyLoginOptionsRequest = z.infer<typeof passkeyLoginOptionsRequestSchema>;
