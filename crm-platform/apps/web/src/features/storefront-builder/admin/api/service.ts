import {
  storeOverviewSchema,
  verifyDomainResponseSchema,
  wizardResponseSchema,
  type SaveShopInput,
  type StoreOverview,
  type UpdateStorefrontInput,
  type VerifyDomainResponse,
  type WizardResponse,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';

/** Every call of the admin store screens. Request and response shapes come from `@crm/contracts`. */
export const storeApi = {
  /** The dashboard of one shop's workspace; without `shopId` the most recently updated shop. */
  overview(shopId: string | undefined, signal?: AbortSignal): Promise<StoreOverview> {
    return apiFetch('/store/overview', { query: { shopId }, schema: storeOverviewSchema, signal });
  },

  /** The wizard: every shop, the connected devices and whether any WhatsApp sender exists. */
  wizard(signal?: AbortSignal): Promise<WizardResponse> {
    return apiFetch('/store/shops', { schema: wizardResponseSchema, signal });
  },

  /** Creates a shop, or edits the one named by `input.shopId`. */
  saveShop(input: SaveShopInput): Promise<void> {
    const { shopId, ...body } = input;
    if (shopId) return apiFetch(`/store/shops/${shopId}`, { method: 'PUT', body });
    return apiFetch('/store/shops', { method: 'POST', body });
  },

  deleteShop(shopId: string): Promise<void> {
    return apiFetch(`/store/shops/${shopId}`, { method: 'DELETE' });
  },

  /** Clears every shop of the workspace. The server refuses unless `confirm` is `yes`. */
  resetAll(): Promise<void> {
    return apiFetch('/store/shops/reset', { method: 'POST', body: { confirm: 'yes' } });
  },

  updateSettings(shopId: string, input: UpdateStorefrontInput): Promise<void> {
    return apiFetch(`/store/shops/${shopId}/settings`, { method: 'PUT', body: input });
  },

  verifyDomain(shopId: string): Promise<VerifyDomainResponse> {
    return apiFetch(`/store/shops/${shopId}/verify-domain`, {
      method: 'POST',
      schema: verifyDomainResponseSchema,
    });
  },
};
