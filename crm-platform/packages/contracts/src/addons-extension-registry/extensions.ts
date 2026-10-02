import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/** Platform-operator surface for code add-ons ("modules", TW-ADD-001..024). Every identifier is a uuid. */

export const extensionStatusSchema = z.enum(['active', 'disabled']);
export type ExtensionStatus = z.infer<typeof extensionStatusSchema>;

const navItemSchema = z.object({
  key: z.string(),
  href: z.string(),
  label: z.string(),
  icon: z.string().nullable(),
  after: z.string(),
});

/** What a module contributes, summarised for the list. */
export const moduleContributionsSchema = z.object({
  navItems: z.number().int().nonnegative(),
  planFeatures: z.number().int().nonnegative(),
  planLimits: z.number().int().nonnegative(),
});

/** A package installed from a ZIP: its registry row. */
export const installedExtensionSchema = z.object({
  id: uuidSchema,
  slug: z.string(),
  name: z.string(),
  version: z.string(),
  status: extensionStatusSchema,
  fileCount: z.number().int().nonnegative(),
  contributions: moduleContributionsSchema,
  installedAt: z.string().datetime().nullable(),
  rowVersion: z.number().int(),
});
export type InstalledExtension = z.infer<typeof installedExtensionSchema>;

/** A module found in the modules folder with no registry row ("in-place"). */
export const inPlaceModuleSchema = z.object({
  slug: z.string(),
  name: z.string(),
  version: z.string(),
  active: z.boolean(),
  contributions: moduleContributionsSchema,
});
export type InPlaceModule = z.infer<typeof inPlaceModuleSchema>;

export const ENGINE_KEYS = ['instagram', 'email'] as const;
export const engineKeySchema = z.enum(ENGINE_KEYS);
export type EngineKey = z.infer<typeof engineKeySchema>;

export const engineStateSchema = z.object({
  engine: engineKeySchema,
  url: z.string(),
  brand: z.string(),
  connected: z.boolean(),
  hasSecret: z.boolean(),
  lastCheckAt: z.string().datetime().nullable(),
  /** Why the last connect failed (kept so the card can show it after a reload). */
  lastError: z.string().nullable(),
  /** Instagram only: a native module owns the engine, so a remote one cannot be connected. */
  blockedByNative: z.boolean(),
});
export type EngineState = z.infer<typeof engineStateSchema>;

export const extensionsPageResponseSchema = z.object({
  coreVersion: z.string(),
  extensions: z.array(installedExtensionSchema),
  modules: z.array(inPlaceModuleSchema),
  /** Uploaded extensions plus in-place-only modules (the count chip, TW-ADD-001). */
  installedCount: z.number().int().nonnegative(),
  engines: z.object({ instagram: engineStateSchema, email: engineStateSchema }),
});
export type ExtensionsPageResponse = z.infer<typeof extensionsPageResponseSchema>;

export const verifyPurchaseRequestSchema = z.object({
  purchaseCode: z.string().trim().max(191).default(''),
});
export type VerifyPurchaseRequest = z.input<typeof verifyPurchaseRequestSchema>;

export const verifyPurchaseResponseSchema = z.object({ ok: z.boolean(), message: z.string() });
export type VerifyPurchaseResponse = z.infer<typeof verifyPurchaseResponseSchema>;

export const uploadExtensionResponseSchema = z.object({
  ok: z.literal(true),
  message: z.string(),
  extension: installedExtensionSchema,
  filesWritten: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  /** True when the slug already existed (an upgrade, TW-ADD-005 rule 6). */
  upgraded: z.boolean(),
});
export type UploadExtensionResponse = z.infer<typeof uploadExtensionResponseSchema>;

export const toggleExtensionRequestSchema = z.object({ rowVersion: z.number().int().positive() });
export type ToggleExtensionRequest = z.infer<typeof toggleExtensionRequestSchema>;

export const toggleExtensionResponseSchema = z.object({
  ok: z.literal(true),
  status: extensionStatusSchema,
  rowVersion: z.number().int(),
});
export type ToggleExtensionResponse = z.infer<typeof toggleExtensionResponseSchema>;

export const removeExtensionResponseSchema = z.object({
  ok: z.literal(true),
  message: z.string(),
  removedFiles: z.number().int().nonnegative(),
});
export type RemoveExtensionResponse = z.infer<typeof removeExtensionResponseSchema>;

export const toggleModuleResponseSchema = z.object({
  ok: z.literal(true),
  active: z.boolean(),
  message: z.string(),
});
export type ToggleModuleResponse = z.infer<typeof toggleModuleResponseSchema>;

// --- engine connections (TW-ADD-017..020) ------------------------------------------------------------------

export const connectEngineRequestSchema = z.object({
  url: z.string().trim().url().max(255),
  /** Blank keeps the engine's default display name. */
  brand: z.string().trim().max(40).default(''),
  /** Blank keeps the stored secret. */
  secret: z.string().max(255).optional(),
});
export type ConnectEngineRequest = z.input<typeof connectEngineRequestSchema>;

export const connectEngineResponseSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  engine: engineStateSchema,
});
export type ConnectEngineResponse = z.infer<typeof connectEngineResponseSchema>;

// --- what modules contribute to the rest of the product (TW-ADD-012, 013) ------------------------------------

export const navContributionsResponseSchema = z.object({
  admin: z.array(navItemSchema.extend({ module: z.string() })),
  user: z.array(navItemSchema.extend({ module: z.string() })),
});
export type NavContributionsResponse = z.infer<typeof navContributionsResponseSchema>;

export const grantFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  group: z.string(),
  /** 'core' or the slug of the module that contributes it. */
  source: z.string(),
});
export type GrantField = z.infer<typeof grantFieldSchema>;

export const grantFieldsResponseSchema = z.object({
  /** Active currencies for the price (the form's Currency list, TW-ADD-026). */
  currencies: z.array(z.object({ code: z.string(), name: z.string() })).default([]),
  features: z.array(grantFieldSchema),
  limits: z.array(
    grantFieldSchema.extend({ default: z.number().int().nullable(), hint: z.string() }),
  ),
});
export type GrantFieldsResponse = z.infer<typeof grantFieldsResponseSchema>;
