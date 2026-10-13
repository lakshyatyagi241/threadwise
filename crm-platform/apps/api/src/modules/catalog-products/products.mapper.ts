import {
  formatProductMoney,
  type ProductPickerItem,
  type ProductResponse,
  type ProductStatus,
  type ProductVariantResponse,
} from '@crm/contracts';
import { aliasStrings } from './product-matcher';
import { minorToMajorString } from './catalog-money';
import { availableQty, effectiveAvailability, retailerIdOf } from './catalog-rules';
import type { ProductRow, VariantRow } from './products.repository';
import { variantRetailerId } from './variant-rules';

function toVariantResponse(v: VariantRow, p: ProductRow): ProductVariantResponse {
  // A row without its own price reads as the product's (the API always stores one).
  const priceMinor = v.priceMinor ?? p.priceMinor;
  return {
    id: v.uuid,
    optionValues: v.optionValues,
    title: v.title,
    sku: v.sku,
    priceMinor,
    priceMajor: minorToMajorString(priceMinor),
    priceDisplay: formatProductMoney(priceMinor, p.currencyCode),
    priceOverrideMajor: v.priceMinor === null ? null : minorToMajorString(v.priceMinor),
    comparePriceMinor: v.comparePriceMinor,
    comparePriceMajor:
      v.comparePriceMinor === null ? null : minorToMajorString(v.comparePriceMinor),
    comparePriceDisplay:
      v.comparePriceMinor === null ? null : formatProductMoney(v.comparePriceMinor, p.currencyCode),
    imageUrl: v.imageUrl,
    weightGrams: v.weightGrams,
    stockQty: v.stockQty,
    reservedQty: v.reservedQty,
    availableQty: availableQty(v.stockQty, v.reservedQty),
    active: v.active,
    position: v.position,
    retailerId: variantRetailerId(v, retailerIdOf(p)),
    rowVersion: v.rowVersion,
  };
}

/** The only place a product row becomes its wire shape: ids become uuids, money gets its readable forms. */
export function toProductResponse(p: ProductRow): ProductResponse {
  return {
    id: p.uuid,
    sku: p.sku,
    name: p.name,
    slug: p.slug,
    description: p.description,
    bodyHtml: p.bodyHtml,
    priceMinor: p.priceMinor,
    priceMajor: minorToMajorString(p.priceMinor),
    priceDisplay: formatProductMoney(p.priceMinor, p.currencyCode),
    comparePriceMinor: p.comparePriceMinor,
    comparePriceMajor:
      p.comparePriceMinor === null ? null : minorToMajorString(p.comparePriceMinor),
    comparePriceDisplay:
      p.comparePriceMinor === null ? null : formatProductMoney(p.comparePriceMinor, p.currencyCode),
    onSale: p.comparePriceMinor !== null && p.comparePriceMinor > p.priceMinor,
    currencyCode: p.currencyCode,
    imageUrl: p.imageUrl,
    galleryUrls: p.gallery,
    inStock: p.inStock,
    stockQty: p.stockQty,
    reservedQty: p.reservedQty,
    availableQty: availableQty(p.stockQty, p.reservedQty),
    sortOrder: p.sortOrder,
    status: p.status as ProductStatus,
    weightGrams: p.weightGrams,
    category: p.category,
    tags: p.tags,
    aliases: aliasStrings(p.aliases),
    availability: p.availability,
    effectiveAvailability: effectiveAvailability(p),
    condition: p.condition,
    brand: p.brand,
    productUrl: p.productUrl,
    googleProductCategory: p.googleProductCategory,
    storefrontId: p.storefrontUuid,
    retailerId: retailerIdOf(p),
    metaRetailerId: p.metaRetailerId,
    metaSyncStatus: p.metaSyncStatus,
    metaSyncedAt: p.metaSyncedAt ? p.metaSyncedAt.toISOString() : null,
    metaLastError: p.metaLastError,
    options: p.options,
    variants: p.variants.map((v) => toVariantResponse(v, p)),
    hasVariants: p.variants.length > 0,
    rowVersion: p.rowVersion,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export function toPickerItem(p: ProductRow): ProductPickerItem {
  return {
    id: p.uuid,
    name: p.name,
    sku: p.sku,
    imageUrl: p.imageUrl,
    category: p.category,
    priceMinor: p.priceMinor,
    priceDisplay: formatProductMoney(p.priceMinor, p.currencyCode),
    currency: p.currencyCode,
    retailerId: retailerIdOf(p),
    synced: p.metaSyncStatus === 'synced',
    storefrontId: p.storefrontUuid,
  };
}
