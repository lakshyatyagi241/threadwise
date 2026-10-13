'use client';

import { useQuery } from '@tanstack/react-query';
import {
  smsLookupResponseSchema,
  smsSenderListResponseSchema,
  smsSenderResponseSchema,
  type ConnectSmsSenderInput,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';

export const KEYS = {
  all: ['sms'] as const,
  senders: ['sms', 'senders'] as const,
};

/** Senders change only when someone on the team edits them, so an occasional refresh is enough (the page does not poll in Reference). */
const REFRESH_MS = 30_000;

export function useSmsSenders(enabled = true) {
  return useQuery({
    queryKey: KEYS.senders,
    enabled,
    queryFn: ({ signal }) =>
      apiFetch('/sms/senders', { schema: smsSenderListResponseSchema, signal }),
    refetchInterval: REFRESH_MS,
  });
}

export const connectSender = (body: ConnectSmsSenderInput) =>
  apiFetch('/sms/senders', { method: 'POST', body, schema: smsSenderResponseSchema });

export const toggleSender = (id: string, active: boolean, rowVersion: number) =>
  apiFetch(`/sms/senders/${id}/toggle`, {
    method: 'PATCH',
    body: { active, rowVersion },
    schema: smsSenderResponseSchema,
  });

export const removeSender = (id: string) => apiFetch(`/sms/senders/${id}`, { method: 'DELETE' });

export const lookupNumber = (number: string) =>
  apiFetch('/sms/lookup', { method: 'POST', body: { number }, schema: smsLookupResponseSchema });
