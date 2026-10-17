'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { apiFetch } from '@/lib/api/client';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { invalidateTasks } from '@/features/tasks';
import { KEYS } from './contacts';
import type { LogCallRequest } from '../lib/call-log';

/**
 * "Log a call" for the contact page: `POST /v2/calls/log`, the endpoint of the call logging framework.
 *
 * DEPENDENCY (BL-260): the framework is built on the branch `lakshya/next/call-logging-framework` and its contract
 * (`@crm/contracts` calling-voice/call-logging.ts: `logCallInputSchema`, `logCallResultSchema`) is not on main yet. Until it is, the
 * request type lives in `lib/call-log.ts` and the two answer fields this screen reads are named below; when the contract lands, delete
 * both and import `LogCallInput` and `logCallResultSchema` from `@crm/contracts`. Nothing is faked: on a server without the route the
 * call is refused (404) and the form says so, and the form is shown only to people who hold `call.logs.create`, a permission that exists
 * only once the framework's migration has run, so a workspace without the framework never sees it.
 */
const logCallAnswerSchema = z.object({
  created: z.boolean(),
  followUpTaskId: z.string().nullable(),
});
export type LogCallAnswer = z.infer<typeof logCallAnswerSchema>;

/** Whether this person can log a call from the contact page. */
export function useCanLogCall(): boolean {
  return useCan('call.logs.create');
}

export const callKeys = {
  /** The contact's calls (the framework's `GET /v2/contacts/:id/calls`, read through the activity feed until its contract lands). */
  activities: (contactId: string) => ['cat', 'activities', contactId] as const,
};

/**
 * Logs one call. A call made together with a follow-up task refreshes the contact's tasks too; the timeline line the server writes
 * shows once the activity feed is read again. `externalId` makes a double click log it once.
 */
export function useLogCall(contactId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LogCallRequest & { externalId: string }) =>
      apiFetch('/calls/log', {
        method: 'POST',
        body: input,
        schema: logCallAnswerSchema,
        idempotencyKey: input.externalId,
      }),
    onSuccess: async (answer) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: callKeys.activities(contactId) }),
        qc.invalidateQueries({ queryKey: KEYS.contact(contactId) }),
        ...(answer.followUpTaskId ? [invalidateTasks(qc)] : []),
      ]);
    },
  });
}
