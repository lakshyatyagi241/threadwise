import {
  addonActivationResponseSchema,
  addonImpactSchema,
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
  impact: (id: string, action: 'disable' | 'enable') =>
    ['workspace-addons', 'impact', id, action] as const,
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

/** What turning an included add-on off (or on) does for this workspace, read before the person confirms. */
export const fetchAddonImpact = (id: string, action: 'disable' | 'enable', signal?: AbortSignal) =>
  apiFetch(`/addons/${id}/impact`, { query: { action }, schema: addonImpactSchema, signal });

/** Turns an add-on the plan includes off for the workspace; the caller has seen the impact and confirms. Settings and data are kept. */
export const disableAddon = (id: string) =>
  apiFetch(`/addons/${id}/disable`, {
    method: 'POST',
    body: { confirm: true },
    schema: addonActivationResponseSchema,
  });

/** Turns it back on. Needs no confirmation: everything is as it was left. */
export const enableAddon = (id: string) =>
  apiFetch(`/addons/${id}/enable`, { method: 'POST', schema: addonActivationResponseSchema });

/**
 * Turns an add-on back on from a locked screen, which knows the add-on by its slug (`FeatureAddon.addonSlug`) and not by its id:
 * the id comes from the workspace's own add-ons list.
 */
export async function enableAddonBySlug(slug: string) {
  const list = await fetchWorkspaceAddons();
  const card = list.catalog.find((c) => c.slug === slug);
  if (!card) throw new Error(`add-on ${slug} is not in the workspace add-ons list`);
  return enableAddon(card.id);
}

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
