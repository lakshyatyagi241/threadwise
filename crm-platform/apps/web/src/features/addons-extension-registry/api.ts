import {
  addonPackListResponseSchema,
  addonPackSchema,
  extensionsPageResponseSchema,
  grantFieldsResponseSchema,
  uploadExtensionResponseSchema,
  cancelSubscriptionResponseSchema,
  verifyPurchaseResponseSchema,
  workspaceAddonsResponseSchema,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { toApiError } from '@/lib/api/errors';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';

export const KEYS = {
  packs: ['operator', 'addon-packs'] as const,
  pack: (id: string) => ['operator', 'addon-pack', id] as const,
  fields: ['operator', 'addon-grant-fields'] as const,
  extensions: ['operator', 'extensions'] as const,
  workspace: ['workspace-addons'] as const,
};

export const fetchPacks = (signal?: AbortSignal) =>
  operatorFetch('/addons', { schema: addonPackListResponseSchema, signal });

export const fetchPack = (id: string, signal?: AbortSignal) =>
  operatorFetch(`/addons/${id}`, { schema: addonPackSchema, signal });

export const fetchGrantFields = (signal?: AbortSignal) =>
  operatorFetch('/addons/fields', { schema: grantFieldsResponseSchema, signal });

export const fetchExtensionsPage = (signal?: AbortSignal) =>
  operatorFetch('/extensions', { schema: extensionsPageResponseSchema, signal });

export const fetchWorkspaceAddons = (signal?: AbortSignal) =>
  apiFetch('/addons', { schema: workspaceAddonsResponseSchema, signal });

/** Stops one add-on purchase from renewing; its paid term keeps running to the end date. */
export const cancelAddonRenewal = (id: string) =>
  apiFetch(`/billing/subscription/addons/${id}/cancel`, {
    method: 'POST',
    schema: cancelSubscriptionResponseSchema,
  });

export { addonPackSchema, verifyPurchaseResponseSchema };

/**
 * The installer's upload is a multipart POST, which the JSON helper does not send. Same proxy, same error mapping;
 * the browser sets the multipart boundary itself, so no content type is given.
 */
export async function uploadPackage(file: File, purchaseCode: string) {
  const form = new FormData();
  form.set('purchaseCode', purchaseCode);
  form.set('extension', file);
  const res = await fetch('/api/platform/extensions/upload', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    body: form,
    credentials: 'same-origin',
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  if (!res.ok) throw toApiError(res.status, json, res.headers.get('x-request-id'));
  return uploadExtensionResponseSchema.parse(json);
}
