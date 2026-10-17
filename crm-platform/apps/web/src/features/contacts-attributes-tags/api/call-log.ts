'use client';

import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { invalidateTasks } from '@/features/tasks';
import { KEYS } from './contacts';

/**
 * "Log a call" on the contact page. The call itself is the framework's (`useLogCall` of the calling-voice domain, `POST /v2/calls/log`);
 * this file holds what the contact page adds: who may see the form, and what to read again once a call is logged.
 */

/** Whether this person can log a call from the contact page (`call.logs.create`). */
export function useCanLogCall(): boolean {
  return useCan('call.logs.create');
}

/**
 * Reads again what a logged call changes on the contact: the timeline (the server writes a line there), the contact's last activity,
 * and the tasks when a follow-up was made.
 */
export function useRefreshAfterCall(contactId: string) {
  const qc = useQueryClient();
  return useCallback(
    (madeTask: boolean) =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ['cat', 'activities', contactId] }),
        qc.invalidateQueries({ queryKey: KEYS.contact(contactId) }),
        ...(madeTask ? [invalidateTasks(qc)] : []),
      ]),
    [qc, contactId],
  );
}
