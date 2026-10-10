import { sessionResponseSchema } from '@crm/contracts';
import { apiFetch } from '@/lib/api';

/** Who am I: user, workspace, roles, permissions and account flags, in one call. */
export const fetchSession = (signal?: AbortSignal) =>
  apiFetch('/v2/auth/session', { schema: sessionResponseSchema, signal });
