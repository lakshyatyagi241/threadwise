import type { ModuleKey } from '@crm/contracts';

/** The contact column a status-option group is stored in. */
export type ContactOptionColumn = 'lifecycleStage' | 'status' | 'lostReason';

const GROUP_COLUMN: Record<string, ContactOptionColumn> = {
  lifecycle_stage: 'lifecycleStage',
  status: 'status',
  contact_status: 'status',
  lost_reason: 'lostReason',
};

/**
 * Which contact column holds the values of an option group, or `null` when no contact column does (deal statuses,
 * subscription statuses, companies): deleting such an option never has contacts to move.
 */
export function contactColumnFor(
  moduleKey: ModuleKey,
  optionGroup: string,
): ContactOptionColumn | null {
  return moduleKey === 'contacts' ? (GROUP_COLUMN[optionGroup] ?? null) : null;
}
