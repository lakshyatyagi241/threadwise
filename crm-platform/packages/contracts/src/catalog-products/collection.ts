import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { CATALOG_SEND_MAX_PRODUCTS } from './catalog';
import { waString } from './text';

/**
 * Collections (product sets, TW-CAT-017/018): a saved, ordered group of products that is sent as one multi-product message.
 * Meta allows 30 products in a message, which is also the cap of a collection.
 */
export const COLLECTION_NAME_MAX = 120;
export const COLLECTION_DESCRIPTION_MAX = 500;

export const collectionMemberSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  sku: z.string().nullable(),
  imageUrl: z.string().nullable(),
  priceDisplay: z.string(),
  retailerId: z.string(),
  /** Inactive (draft or archived) products stay in the set but are skipped when it is sent. */
  active: z.boolean(),
});

export const collectionResponseSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  slug: z.string().nullable(),
  description: z.string().nullable(),
  isActive: z.boolean(),
  productCount: z.number().int(),
  /** The id of the product set on Meta once pushed (TW-CAT product sets), else null. */
  metaSetId: z.string().nullable(),
  /** The members that still exist, in the stored order. */
  products: z.array(collectionMemberSchema),
  rowVersion: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type CollectionResponse = z.infer<typeof collectionResponseSchema>;

export const collectionFieldsSchema = z.object({
  name: waString(COLLECTION_NAME_MAX, 1),
  description: waString(COLLECTION_DESCRIPTION_MAX).nullish(),
  /** 1 to 30 products of this workspace, in the order they are shown. */
  productIds: z.array(uuidSchema).min(1).max(CATALOG_SEND_MAX_PRODUCTS),
  isActive: z.boolean().default(true),
});
export const createCollectionSchema = collectionFieldsSchema;
export type CreateCollectionInput = z.infer<typeof createCollectionSchema>;
export const updateCollectionSchema = collectionFieldsSchema.extend({
  rowVersion: z.number().int().min(1).optional(),
});
export type UpdateCollectionInput = z.infer<typeof updateCollectionSchema>;

export const listCollectionsResponseSchema = z.object({
  data: z.array(collectionResponseSchema),
  /** Active products for the picker, by name, capped at 300 (the Send tab's search covers larger catalogs). */
  pickProducts: z.array(
    z.object({
      id: uuidSchema,
      name: z.string(),
      sku: z.string().nullable(),
      imageUrl: z.string().nullable(),
      priceDisplay: z.string(),
    }),
  ),
  totalProducts: z.number().int(),
});
export type ListCollectionsResponse = z.infer<typeof listCollectionsResponseSchema>;
