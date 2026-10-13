import { profileResponseSchema, type UpdateProfileRequest } from '@crm/contracts';
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
