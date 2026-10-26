import { logCallResultSchema, type LogCallInput } from '@crm/contracts';
import { apiFetch } from '@/lib/api';

/**
 * Logs a call on the call log (`POST /v2/calls/log`, right `call.logs.create`): its own record with the direction, the outcome, when it
 * began, how long it lasted and the notes, shown on the Call logs screen and on the contact's timeline. `body.externalId` is this call's
 * own id, so pressing Save twice, or saving again after a failed answer, never makes two. Logging a call is never refused for consent.
 */
export const logCall = (body: LogCallInput, idempotencyKey?: string) =>
  apiFetch('/v2/calls/log', {
    method: 'POST',
    body,
    schema: logCallResultSchema,
    idempotencyKey,
  });
