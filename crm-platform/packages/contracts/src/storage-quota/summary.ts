import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import {
  STORAGE_CATEGORIES,
  STORAGE_LEVELS,
  STORAGE_MODES,
  STORAGE_OBJECT_STATES,
  STORAGE_TIERS,
} from './categories';

/**
 * The shapes the storage quota exposes (spec docs/specs/storage-quota-and-archival.md sections 6.1, 11.1 and 12). Bytes are numbers on the
 * wire (a workspace would need 9 PB to leave the safe integer range). Phases S0 and S1 serve the operator's read-only fleet view; the
 * workspace summary (`storageSummarySchema`) is the shape Settings > Storage will read in phase S2 and is registered now so the API,
 * the web app and the mobile app agree before anything is built on it.
 */

export const storageCategorySchema = z.enum(STORAGE_CATEGORIES);
export const storageTierSchema = z.enum(STORAGE_TIERS);
export const storageLevelSchema = z.enum(STORAGE_LEVELS);
export const storageModeSchema = z.enum(STORAGE_MODES);
export const storageObjectStateSchema = z.enum(STORAGE_OBJECT_STATES);

const bytes = z.number().int().nonnegative();

/** `details` of a STORAGE_QUOTA_EXCEEDED problem, in the field names of PLAN_LIMIT_REACHED. */
export const storageQuotaExceededDetailsSchema = z.object({
  limit: z.literal('storage_gb'),
  reason: z.literal('storage_full'),
  used: bytes,
  limitValue: bytes,
  requested: bytes,
  category: storageCategorySchema,
  upgradeUrl: z.string(),
});
export type StorageQuotaExceededDetails = z.infer<typeof storageQuotaExceededDetailsSchema>;

/** Usage of one category: what is hot, what is cold (not counted), how many objects. */
export const storageCategoryUsageSchema = z.object({
  category: storageCategorySchema,
  hotBytes: bytes,
  coldBytes: bytes,
  objects: bytes,
});
export type StorageCategoryUsage = z.infer<typeof storageCategoryUsageSchema>;

/** One workspace's storage: used of allowed, level, and the breakdown. `capBytes` 0 means unlimited. */
export const storageSummarySchema = z.object({
  mode: storageModeSchema,
  hotBytes: bytes,
  reservedBytes: bytes,
  coldBytes: bytes,
  capBytes: bytes,
  level: storageLevelSchema,
  overSince: z.string().datetime().nullable(),
  byCategory: z.array(storageCategoryUsageSchema),
  lastReconciledAt: z.string().datetime().nullable(),
});
export type StorageSummary = z.infer<typeof storageSummarySchema>;

// --- operator console (read only) -----------------------------------------------------------------------------------------------

/** A workspace in the fleet view. */
export const storageFleetWorkspaceSchema = z.object({
  workspaceId: uuidSchema,
  name: z.string(),
  plan: z.string(),
  hotBytes: bytes,
  coldBytes: bytes,
  reservedBytes: bytes,
  capBytes: bytes,
  level: storageLevelSchema,
  lastReconciledAt: z.string().datetime().nullable(),
});
export type StorageFleetWorkspace = z.infer<typeof storageFleetWorkspaceSchema>;

export const storageFleetResponseSchema = z.object({
  /** The platform mode in force, so the console says plainly that observe mode refuses nothing. */
  mode: storageModeSchema,
  generatedAt: z.string().datetime(),
  totals: z.object({
    workspaces: bytes,
    hotBytes: bytes,
    coldBytes: bytes,
    reservedBytes: bytes,
    objects: bytes,
  }),
  byCategory: z.array(storageCategoryUsageSchema),
  /** The 20 workspaces holding the most hot bytes. */
  top: z.array(storageFleetWorkspaceSchema),
  /** How many workspaces are at each level (computed against the plan's `storage_gb`; nothing is enforced in observe mode). */
  levels: z.record(storageLevelSchema, bytes),
  /** The nightly counter check: when it last ran, how many workspaces it found drifting, and by how many bytes in total. */
  drift: z.object({
    lastRunAt: z.string().datetime().nullable(),
    workspacesWithDrift: bytes,
    driftBytes: bytes,
  }),
});
export type StorageFleetResponse = z.infer<typeof storageFleetResponseSchema>;

export const storageWorkspaceDetailResponseSchema = z.object({
  workspaceId: uuidSchema,
  name: z.string(),
  plan: z.string(),
  summary: storageSummarySchema,
  /** Pending registry rows older than an hour with no owner (orphans the sweep of phase S5 will clear). */
  orphanCandidates: bytes,
});
export type StorageWorkspaceDetailResponse = z.infer<typeof storageWorkspaceDetailResponseSchema>;
