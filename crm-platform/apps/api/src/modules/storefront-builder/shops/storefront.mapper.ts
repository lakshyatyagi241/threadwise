import type { StorefrontResponse, WizardResponse } from '@crm/contracts';
import { minorToMajorString } from '../rules/shipping';
import { readSettings } from '../rules/settings';
import type { ShopRow } from './shops.repository';

/** The one place a shop row becomes the wire shape: uuids out, bigints never, secrets never. */
export function toStorefrontResponse(
  row: ShopRow,
  extra: { publicUrl: string; sendingLabel: string | null; cnameTarget: string },
): StorefrontResponse {
  const cfg = (row.paymentConfig ?? {}) as Record<string, unknown>;
  const isApi = row.paymentProvider === 'razorpay_api';
  return {
    id: row.uuid,
    shopName: row.shopName,
    slug: row.slug,
    customDomain: row.customDomain,
    customDomainVerified: row.customDomainVerified,
    themeKey: row.themeKey,
    enabled: row.enabled,
    currencyCode: row.currencyCode,
    deviceId: row.deviceUuid,
    settings: readSettings(row.settings),
    shipping: {
      flat: minorToMajorString(row.shipping?.flat_minor),
      freeAbove: minorToMajorString(row.shipping?.free_above_minor),
      note: row.shipping?.note ?? null,
    },
    paymentProvider: row.paymentProvider,
    paymentHandle: !isApi && typeof cfg.handle === 'string' ? cfg.handle : null,
    razorpay: {
      keyId: isApi && typeof cfg.key_id === 'string' ? cfg.key_id : null,
      hasKeySecret: isApi && typeof cfg.key_secret === 'string' && cfg.key_secret !== '',
      hasWebhookSecret:
        isApi && typeof cfg.webhook_secret === 'string' && cfg.webhook_secret !== '',
    },
    publicUrl: extra.publicUrl,
    cnameTarget: extra.cnameTarget,
    sendingLabel: extra.sendingLabel,
    hasUsableConnection: row.deviceId !== null,
    rowVersion: row.rowVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toWizardShop(
  row: ShopRow,
  extra: { publicUrl: string; sendingLabel: string | null },
): WizardResponse['shops'][number] {
  return {
    id: row.uuid,
    shopName: row.shopName,
    slug: row.slug,
    customDomain: row.customDomain,
    customDomainVerified: row.customDomainVerified,
    enabled: row.enabled,
    deviceId: row.deviceUuid,
    publicUrl: extra.publicUrl,
    sendingLabel: extra.sendingLabel,
    themeKey: row.themeKey,
  };
}
