import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { pageResponseSchema } from '../common/pagination';

/**
 * The WhatsApp group directory of the store (WaDesk /store/groups, WaGroup): groups the connected number belongs to, each with an
 * optional ordering code buyers type to place an order from a group. The rows are mirrored from the WhatsApp session; the merchant
 * only manages the code.
 */

export const listStoreGroupsQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().min(1).max(512).optional(),
});
export type ListStoreGroupsQuery = z.infer<typeof listStoreGroupsQuerySchema>;

export const storeGroupSchema = z.object({
  id: uuidSchema,
  /** The WhatsApp group id (`...@g.us`). */
  jid: z.string(),
  subject: z.string().nullable(),
  size: z.number().int(),
  devicePhone: z.string().nullable(),
  groupCode: z.string().nullable(),
  syncedAt: z.string().datetime().nullable(),
  rowVersion: z.number().int(),
});
export type StoreGroup = z.infer<typeof storeGroupSchema>;

export const storeGroupListResponseSchema = pageResponseSchema(storeGroupSchema);
export type StoreGroupListResponse = z.infer<typeof storeGroupListResponseSchema>;

/** The cards above the table: groups, how many have a code, and the number the wa.me ordering link points at. */
export const storeGroupSummarySchema = z.object({
  total: z.number().int(),
  coded: z.number().int(),
  /** Digits of the first device of the workspace; null when there is none. */
  botNumber: z.string().nullable(),
});
export type StoreGroupSummary = z.infer<typeof storeGroupSummarySchema>;

/** WaDesk: `nullable|string|max:48|regex:/^[A-Za-z0-9._-]*$/`; blank clears the code. */
export const setStoreGroupCodeSchema = z.object({
  groupCode: z
    .string()
    .trim()
    .max(48)
    .regex(/^[A-Za-z0-9._-]*$/, 'Letters, numbers, dots, dashes and underscores only')
    .nullish(),
  rowVersion: z.number().int().positive().optional(),
});
export type SetStoreGroupCodeInput = z.infer<typeof setStoreGroupCodeSchema>;
