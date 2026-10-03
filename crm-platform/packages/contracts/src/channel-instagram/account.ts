import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/**
 * Instagram accounts linked to a workspace (WD-IG-001 to 006). The account itself lives on the Instagram engine (the Instaflow
 * bridge); the workspace keeps a mirror row with the account id and a cached profile.
 */

export const igAccountSchema = z.object({
  id: uuidSchema,
  /** The engine's id for the account. */
  instaflowAccountId: z.string(),
  username: z.string().nullable(),
  name: z.string().nullable(),
  avatar: z.string().nullable(),
  /** `connected` or `disconnected` (as the engine last reported it). */
  status: z.string(),
  followers: z.number().int().nullable(),
  /** When the profile was last read from the engine; null shows as "live". */
  syncedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  rowVersion: z.number().int(),
});
export type IgAccount = z.infer<typeof igAccountSchema>;

/** What the hub needs to know about the engine behind the accounts (nothing secret). */
export const igBridgeSchema = z.object({
  /** The engine is connected on this install; the add card shows only then. */
  connected: z.boolean(),
  /** The display name saved with the connection ("IgDesk" by default). Labels use it, never the product's own name. */
  brand: z.string(),
  /** Where "Manage" opens the account on the engine; null when it is not connected. */
  manageUrl: z.string().nullable(),
});
export type IgBridge = z.infer<typeof igBridgeSchema>;

export const igAccountListSchema = z.object({
  data: z.array(igAccountSchema),
  bridge: igBridgeSchema,
});
export type IgAccountList = z.infer<typeof igAccountListSchema>;

/** An account on the engine that this workspace has not linked yet (the picker). */
export const igAvailableAccountSchema = z.object({
  id: z.string(),
  username: z.string(),
  name: z.string(),
  avatar: z.string(),
  connected: z.boolean(),
});
export type IgAvailableAccount = z.infer<typeof igAvailableAccountSchema>;

export const igAvailableListSchema = z.object({ data: z.array(igAvailableAccountSchema) });
export type IgAvailableList = z.infer<typeof igAvailableListSchema>;

/** Link (or refresh) an account. The profile fields are what the picker already knew; the engine's own answer wins when it has one. */
export const linkIgAccountSchema = z.object({
  instaflowAccountId: z.string().trim().min(1).max(64),
  username: z.string().trim().max(190).optional(),
  name: z.string().trim().max(190).optional(),
  avatar: z.string().trim().max(1024).optional(),
  followers: z.number().int().min(0).optional(),
});
export type LinkIgAccountInput = z.infer<typeof linkIgAccountSchema>;

/** The sign-in popup's address for connecting a new account on the engine. */
export const igConnectStartResponseSchema = z.object({ url: z.string().url() });
export type IgConnectStartResponse = z.infer<typeof igConnectStartResponseSchema>;

export const igUnlinkResultSchema = z.object({
  /** Instagram threads deleted because the last account went; 0 while other accounts remain. */
  purgedThreads: z.number().int().min(0),
});
export type IgUnlinkResult = z.infer<typeof igUnlinkResultSchema>;
