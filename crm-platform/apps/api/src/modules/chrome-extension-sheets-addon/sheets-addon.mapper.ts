import type { ContactResponse, ExtSheetsContactOut, ExtSheetsShopOut } from '@crm/contracts';
import type { ShopSummary } from '../storefront-builder';

/** The one place a contact becomes the add-on's wire shape (snake_case, uuid only). */
export function toSheetsContact(c: ContactResponse): ExtSheetsContactOut {
  return {
    id: c.id,
    name: c.name,
    first_name: c.firstName,
    last_name: c.lastName,
    email: c.email,
    phone: c.phone,
    source: c.source,
    is_unsubscribed: c.isUnsubscribed,
    attributes: c.customFields,
    created_at: c.createdAt,
    updated_at: c.updatedAt,
  };
}

export function toSheetsShop(s: ShopSummary, productCount: number): ExtSheetsShopOut {
  return {
    id: s.uuid,
    shop_name: s.shopName,
    slug: s.slug,
    currency: s.currencyCode,
    enabled: s.enabled,
    theme_key: s.themeKey,
    custom_domain: s.customDomain,
    public_url: s.publicUrl,
    product_count: productCount,
    updated_at: s.updatedAt.toISOString(),
  };
}
