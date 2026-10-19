import {
  notificationPreferencesResponseSchema,
  pushPublicKeyResponseSchema,
  type UpdateNotificationPreferencesRequest,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api';

/** The person's own preferences: every type with what is in force, the default, and what they chose themselves. */
export const fetchPreferences = (signal?: AbortSignal) =>
  apiFetch('/v2/notifications/preferences', {
    schema: notificationPreferencesResponseSchema,
    signal,
  });

/** A partial, idempotent update (`null` = follow the default again); answers with the full list. */
export const savePreferences = (body: UpdateNotificationPreferencesRequest) =>
  apiFetch('/v2/notifications/preferences', {
    method: 'PUT',
    body,
    schema: notificationPreferencesResponseSchema,
  });

/** Whether this deployment sends browser (Web Push) notifications at all; the Push column exists only where it does. */
export const fetchPushDeployment = (signal?: AbortSignal) =>
  apiFetch('/v2/notifications/push/public-key', { schema: pushPublicKeyResponseSchema, signal });
