import {
  phoneVerificationChallengeSchema,
  phoneVerificationConfirmResponseSchema,
  phoneVerificationResendResponseSchema,
  profileResponseSchema,
  type PhoneVerificationConfirmRequest,
  type UpdateProfileRequest,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api';

/** The signed-in person's own profile: name, display name, phone, email, workspace time zone. */
export const fetchProfile = (signal?: AbortSignal) =>
  apiFetch('/v2/account/profile', { schema: profileResponseSchema, signal });

/** Saves only what is sent; the API answers with the whole profile as it is now. */
export const updateProfile = (body: UpdateProfileRequest, idempotencyKey?: string) =>
  apiFetch('/v2/account/profile', {
    method: 'PATCH',
    body,
    schema: profileResponseSchema,
    idempotencyKey,
  });

/** Sends a code to the number saved on the profile, to prove it is the person's (a verified number can sign in with a code). */
export const startPhoneVerification = () =>
  apiFetch('/v2/account/phone/verification', {
    method: 'POST',
    schema: phoneVerificationChallengeSchema,
  });

export const resendPhoneVerification = () =>
  apiFetch('/v2/account/phone/verification/resend', {
    method: 'POST',
    schema: phoneVerificationResendResponseSchema,
  });

/** The code: marks the number saved on the profile as verified. */
export const confirmPhoneVerification = (body: PhoneVerificationConfirmRequest) =>
  apiFetch('/v2/account/phone/verification/confirm', {
    method: 'POST',
    body,
    schema: phoneVerificationConfirmResponseSchema,
  });
