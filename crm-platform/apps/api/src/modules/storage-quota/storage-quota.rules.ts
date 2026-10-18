import {
  BYTES_PER_GB,
  STORAGE_CATEGORIES,
  STORAGE_MODES,
  STORAGE_WARN_RATIO,
  isCountedStorageCategory,
  type StorageCategory,
  type StorageLevel,
  type StorageMode,
} from '@crm/contracts';

/** A reservation not committed or released within this long is returned by the reaper (spec 4.1: 15 minutes). */
export const RESERVATION_TTL_MS = 15 * 60_000;

/** A `pending` registry row that no owner row claimed within this long is an orphan candidate (spec 4.2: one hour). */
export const ORPHAN_AFTER_MS = 60 * 60_000;

/** The largest whole-GB cap whose byte count is still exactly representable (about 8.4 million GB, 8 petabytes). */
const MAX_CAP_GB = Math.floor(Number.MAX_SAFE_INTEGER / BYTES_PER_GB);

/**
 * The cap in bytes from the plan limit `storage_gb` (whole GB; 0 = unlimited, which stays 0). A limit beyond what a JavaScript number holds
 * exactly (the plan schema allows up to 2,000,000,000) is clamped to the largest cap that is: 8 petabytes is "unlimited" for any workspace.
 */
export function capBytesFromGb(storageGb: number): number {
  if (!Number.isFinite(storageGb) || storageGb <= 0) return 0;
  return Math.min(Math.floor(storageGb), MAX_CAP_GB) * BYTES_PER_GB;
}

/**
 * Where a workspace stands against its cap, for DISPLAY (spec 7.1). `capBytes` 0 means unlimited. Observe mode refuses nothing at any
 * level; the level only tells the operator who would be affected.
 */
export function levelFor(hotBytes: number, capBytes: number): StorageLevel {
  if (capBytes <= 0) return 'ok';
  if (hotBytes > capBytes) return 'over';
  if (hotBytes === capBytes) return 'full';
  return hotBytes >= capBytes * STORAGE_WARN_RATIO ? 'warn80' : 'ok';
}

/**
 * The mode in force from the platform setting's raw value. A missing or unknown value is `observe`. `enforce` is not built yet (phase
 * S2): a build that finds it behaves as `observe`, so flipping the setting early can never start refusing uploads.
 */
export function effectiveMode(raw: unknown): 'off' | 'observe' {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  const known = (STORAGE_MODES as readonly string[]).includes(value)
    ? (value as StorageMode)
    : 'observe';
  return known === 'off' ? 'off' : 'observe';
}

export {
  TEAM_CHAT_BLOB_TABLE,
  pgBlobKey,
  teamChatBlobKey,
} from '../../common/storage-meter/storage-key-category';

export const isStorageCategory = (value: string): value is StorageCategory =>
  (STORAGE_CATEGORIES as readonly string[]).includes(value);

export { isCountedStorageCategory };

/** Percent of the cap used, or null when unlimited. */
export function usedPercent(hotBytes: number, capBytes: number): number | null {
  return capBytes > 0 ? Math.floor((hotBytes / capBytes) * 100) : null;
}
