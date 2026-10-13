'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  mailOutboundAttachmentSchema,
  mailSignatureListResponseSchema,
  mailSignatureResponseSchema,
  type CreateMailSignatureInput,
  type MailOutboundAttachment,
  type UpdateMailSignatureInput,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { toApiError } from '@/lib/api/errors';

/** The composer's own calls (TW-MAIL-027): staged uploads and signatures. The mailbox calls live in `mailboxes.ts`. */
export const COMPOSER_KEYS = {
  signatures: ['email', 'signatures'] as const,
};

/**
 * Stages one file for the next reply (`POST /email/attachments/upload`, multipart). XMLHttpRequest because fetch cannot report upload
 * progress. The answer names the staged file; the reply then refers to it by id in `email.attachmentIds`.
 */
export function uploadEmailAttachment(
  file: File,
  conversationId: string | undefined,
  onProgress: (percent: number) => void,
  signal?: AbortSignal,
): Promise<MailOutboundAttachment> {
  return new Promise<MailOutboundAttachment>((resolve, reject) => {
    const form = new FormData();
    // Fields before the file, so the server knows the conversation when the file arrives.
    if (conversationId) form.set('conversationId', conversationId);
    form.set('file', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/v2/email/attachments/upload');
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.setRequestHeader('Idempotency-Key', crypto.randomUUID());
    xhr.setRequestHeader('X-Request-Id', crypto.randomUUID());
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onerror = () => reject(new TypeError('network'));
    xhr.onabort = () => reject(new DOMException('aborted', 'AbortError'));
    xhr.onload = () => {
      let json: unknown;
      try {
        json = xhr.responseText ? JSON.parse(xhr.responseText) : undefined;
      } catch {
        json = undefined;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        const parsed = mailOutboundAttachmentSchema.safeParse(json);
        if (parsed.success) resolve(parsed.data);
        else reject(new Error('unexpected response'));
        return;
      }
      reject(
        toApiError(
          xhr.status,
          json,
          xhr.getResponseHeader('x-request-id'),
          xhr.getResponseHeader('retry-after'),
        ),
      );
    };
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(form);
  });
}

/** Takes a staged file back (the agent removed it before sending). */
export const deleteStagedAttachment = (id: string) =>
  apiFetch(`/email/attachments/${encodeURIComponent(id)}`, { method: 'DELETE' });

/** The signatures an agent may pick from on a mailbox: the mailbox's own and their personal ones. */
export function useSignatures(mailboxId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: [...COMPOSER_KEYS.signatures, mailboxId ?? 'all'],
    enabled,
    queryFn: ({ signal }) =>
      apiFetch('/email/signatures', {
        query: { mailboxId },
        schema: mailSignatureListResponseSchema,
        signal,
      }),
    staleTime: 30_000,
  });
}

/** The same list for the management panel: every signature the viewer can see, any mailbox. */
export const useAllSignatures = (enabled = true) => useSignatures(undefined, enabled);

function useSignatureMutation<V, R>(run: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => qc.invalidateQueries({ queryKey: COMPOSER_KEYS.signatures }),
  });
}

export const useCreateSignature = () =>
  useSignatureMutation((body: CreateMailSignatureInput) =>
    apiFetch('/email/signatures', {
      method: 'POST',
      body,
      schema: mailSignatureResponseSchema,
    }),
  );

export const useUpdateSignature = () =>
  useSignatureMutation((v: { id: string; body: UpdateMailSignatureInput }) =>
    apiFetch(`/email/signatures/${v.id}`, {
      method: 'PATCH',
      body: v.body,
      schema: mailSignatureResponseSchema,
    }),
  );

export const useDeleteSignature = () =>
  useSignatureMutation((id: string) => apiFetch(`/email/signatures/${id}`, { method: 'DELETE' }));
