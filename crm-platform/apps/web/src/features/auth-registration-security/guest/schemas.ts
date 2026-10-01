import {
  authenticatedSchema,
  mfaRequiredSchema,
  otpRequiredSchema,
  type MfaRequired,
  type OtpRequired,
} from '@crm/contracts';
import type { z } from 'zod';

/**
 * What the session-issuing BFF routes return: the contract bodies minus the token pair, which
 * the server moves into httpOnly cookies (ADR-0018).
 *
 * The union is discriminated by hand: composing contract schemas with this app's own `zod` import
 * mixes two builds of zod (CJS contracts, ESM web), and `z.discriminatedUnion` cannot read the other's literals.
 */
export const bffAuthenticatedSchema = authenticatedSchema.omit({ tokens: true });
export type BffAuthenticated = z.infer<typeof bffAuthenticatedSchema>;

export type BffLoginResponse = BffAuthenticated | MfaRequired;
export type BffSignupResponse = BffAuthenticated | OtpRequired;

function statusOf(json: unknown): unknown {
  return typeof json === 'object' && json !== null
    ? (json as { status?: unknown }).status
    : undefined;
}

export const bffLoginResponseSchema = {
  parse(json: unknown): BffLoginResponse {
    return statusOf(json) === 'mfa_required'
      ? mfaRequiredSchema.parse(json)
      : bffAuthenticatedSchema.parse(json);
  },
};

export const bffSignupResponseSchema = {
  parse(json: unknown): BffSignupResponse {
    return statusOf(json) === 'otp_required'
      ? otpRequiredSchema.parse(json)
      : bffAuthenticatedSchema.parse(json);
  },
};
