import type { DashRange } from '@crm/contracts';

/** The windows the phone offers. The web also has "custom" (two dates): it needs a date picker the app does not have yet. */
export const RANGES = ['24h', '7d', '30d', 'qtd'] as const satisfies readonly DashRange[];
export type Range = (typeof RANGES)[number];
