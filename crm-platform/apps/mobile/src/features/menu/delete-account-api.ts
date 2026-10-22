import type { DeleteAccountRequest } from '@crm/contracts';
import { z } from 'zod';
import { apiFetch } from '@/lib/api';

/**
 * Permanently deletes the signed-in person's own account (`DELETE /v2/account`): the sign-in, profile, photo and devices go for good,
 * the workspace and its other members stay. The API wants the confirmation phrase and the current password; it refuses the only
 * member and the only administrator.
 */
export const deleteAccount = (body: DeleteAccountRequest, idempotencyKey?: string) =>
  apiFetch('/v2/account', {
    method: 'DELETE',
    body,
    schema: z.object({ ok: z.boolean() }),
    idempotencyKey,
  });
