'use client';

import { useQuery } from '@tanstack/react-query';
import {
  mailboxListResponseSchema,
  mailboxResponseSchema,
  mailProviderListResponseSchema,
  mailWorkspaceSettingsSchema,
  startMailboxConnectResponseSchema,
  type ConnectImapMailboxInput,
  type StartMailboxConnectInput,
  type UpdateMailWorkspaceSettingsInput,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';

export const KEYS = {
  all: ['email'] as const,
  mailboxes: ['email', 'mailboxes'] as const,
  providers: ['email', 'providers'] as const,
  settings: ['email', 'settings'] as const,
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

/** Which providers the workspace can connect and whether the platform has set each one up (TW-MAIL-031, 034). */
export function useProviders(enabled = true) {
  return useQuery({
    queryKey: KEYS.providers,
    enabled,
    queryFn: ({ signal }) =>
      apiFetch('/email/providers', { schema: mailProviderListResponseSchema, signal }),
  });
}

/** The workspace policy of personal mailboxes (TW-MAIL-035). */
export function useEmailSettings(enabled = true) {
  return useQuery({
    queryKey: KEYS.settings,
    enabled,
    queryFn: ({ signal }) =>
      apiFetch('/email/settings', { schema: mailWorkspaceSettingsSchema, signal }),
  });
}

export const saveEmailSettings = (body: UpdateMailWorkspaceSettingsInput) =>
  apiFetch('/email/settings', {
    method: 'PATCH',
    body,
    schema: mailWorkspaceSettingsSchema,
  });

/** Starts the provider's sign-in (Google or Microsoft); the answer is the address to send the browser to. */
export const startConnect = (body: Partial<StartMailboxConnectInput> = {}) =>
  apiFetch('/email/mailboxes/connect', {
    method: 'POST',
    body,
    schema: startMailboxConnectResponseSchema,
  });

/** Connects (or, with `mailboxId`, reconnects) an IMAP/SMTP mailbox. The server logs in to both servers before it stores anything. */
export const connectImap = (body: ConnectImapMailboxInput) =>
  apiFetch('/email/mailboxes/connect-imap', {
    method: 'POST',
    body,
    schema: mailboxResponseSchema,
  });

export const renameMailbox = (id: string, displayName: string, rowVersion: number) =>
  apiFetch(`/email/mailboxes/${id}`, {
    method: 'PATCH',
    body: { displayName, rowVersion },
    schema: mailboxResponseSchema,
  });

/** `null` puts the mailbox back on the platform's default hourly send limit. */
export const setSendLimit = (
  id: string,
  displayName: string,
  sendLimitPerHour: number | null,
  rowVersion: number,
) =>
  apiFetch(`/email/mailboxes/${id}`, {
    method: 'PATCH',
    body: { displayName, sendLimitPerHour, rowVersion },
    schema: mailboxResponseSchema,
  });

export const syncMailbox = (id: string) =>
  apiFetch(`/email/mailboxes/${id}/sync`, { method: 'POST' });

export const removeMailbox = (id: string) =>
  apiFetch(`/email/mailboxes/${id}`, { method: 'DELETE' });

/** The same-origin address of one attachment (the session cookie authorises it; the API checks the right to read the conversation). */
export const attachmentUrl = (conversationId: string, messageId: string, attachmentId: string) =>
  `/api/v2/email/attachments/${encodeURIComponent(conversationId)}/${encodeURIComponent(messageId)}/${encodeURIComponent(attachmentId)}`;
