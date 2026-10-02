import type { SetGroup } from '@crm/contracts';

/** React Query keys shared by the hub and the group pages (a save or a test refreshes the hub). */
export const hubKey = ['operator', 'settings', 'set', 'hub'] as const;
export const groupKey = (group: SetGroup) =>
  ['operator', 'settings', 'set', 'group', group] as const;
