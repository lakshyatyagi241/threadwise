import type { SecurityPolicy } from '@crm/contracts';

export type EnforcementStatus = 'enforced' | 'partial' | 'reserved';
export interface EnforcementRow {
  /** Human label of the row. */
  key: string;
  /** The exact policy keys this row covers. */
  controls: readonly string[];
  consumer: string;
  status: EnforcementStatus;
}

/** The matrix row that says what a control does today, or null when the API does not list it (then no badge is shown rather than a guess). */
export function enforcementFor(
  matrix: readonly EnforcementRow[],
  control: keyof SecurityPolicy,
): EnforcementRow | null {
  return matrix.find((row) => row.controls.includes(control)) ?? null;
}

export type BadgeTone = 'success' | 'warning' | 'neutral';
export const enforcementTone = (status: EnforcementStatus): BadgeTone =>
  status === 'enforced' ? 'success' : status === 'partial' ? 'warning' : 'neutral';
