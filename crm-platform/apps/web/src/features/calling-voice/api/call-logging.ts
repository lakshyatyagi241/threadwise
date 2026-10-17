'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { logCallResultSchema, type LogCallInput } from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { LOG_KEYS } from './call-logs';

/**
 * "Log a call" (`POST /v2/calls/log`): a call that was not a WhatsApp call. The answer says whether the number found a contact, the
 * follow-up task it made and any lifecycle suggestion (never applied). The Call logs are read again once it lands.
 */
export function useLogCall() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LogCallInput) =>
      apiFetch('/calls/log', { method: 'POST', body: input, schema: logCallResultSchema }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: LOG_KEYS.all }),
  });
}
