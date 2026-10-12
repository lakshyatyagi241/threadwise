'use client';

import { useQuery } from '@tanstack/react-query';
import {
  mailboxListResponseSchema,
  mailboxResponseSchema,
  startMailboxConnectResponseSchema,
  type StartMailboxConnectInput,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';

export const KEYS = {
  all: ['email'] as const,
  mailboxes: ['email', 'mailboxes'] as const,
};

/** A sync runs every minute on the server: a slow refresh keeps "last synced" and the conversation counts roughly current. */
const REFRESH_MS = 30_000;

export function useMailboxes(enabled = true) {
  return useQuery({
    queryKey: KEYS.mailboxes,
    enabled,
    queryFn: ({ signal }) =>
      apiFetch('/email/mailboxes', { schema: mailboxListResponseSchema, signal }),
    refetchInterval: REFRESH_MS,
  });
}

/** Starts the Google sign-in; the answer is the address to send the browser to. */
export const startConnect = (body: Partial<StartMailboxConnectInput> = {}) =>
  apiFetch('/email/mailboxes/connect', {
    method: 'POST',
    body,
    schema: startMailboxConnectResponseSchema,
  });

export const renameMailbox = (id: string, displayName: string, rowVersion: number) =>
  apiFetch(`/email/mailboxes/${id}`, {
    method: 'PATCH',
    body: { displayName, rowVersion },
    schema: mailboxResponseSchema,
  });

export const syncMailbox = (id: string) =>
  apiFetch(`/email/mailboxes/${id}/sync`, { method: 'POST' });

export const removeMailbox = (id: string) =>
  apiFetch(`/email/mailboxes/${id}`, { method: 'DELETE' });

/** The same-origin address of one attachment (the session cookie authorises it; the API checks the right to read the conversation). */
export const attachmentUrl = (conversationId: string, messageId: string, attachmentId: string) =>
  `/api/v2/email/attachments/${encodeURIComponent(conversationId)}/${encodeURIComponent(messageId)}/${encodeURIComponent(attachmentId)}`;
