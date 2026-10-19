/** Error codes of the storage quota (docs/specs/storage-quota-and-archival.md). Spread into ERROR_CODES (common/errors.ts). */
export const STORAGE_ERROR_CODES = {
  /**
   * A counted upload or recording was refused because the workspace's storage is full (422). `errors[]` carries the PLAN_LIMIT_REACHED
   * field names (`limit`, `reason`, `used`, `limitValue`, `requested`, `category`, `upgradeUrl`) so client code written for plan caps
   * degrades gracefully. NOTHING raises this in observe mode (phases S0 and S1): the code is registered so every client can handle it
   * before enforcement is switched on.
   */
  STORAGE_QUOTA_EXCEEDED: 'STORAGE_QUOTA_EXCEEDED',
} as const;
