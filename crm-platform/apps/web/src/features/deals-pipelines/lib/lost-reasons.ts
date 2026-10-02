/**
 * Reasons for a lost deal. The workspace keeps a catalogue (settings screen); until it has entries the dialog offers these
 * presets. `other` always asks for a few words of free text.
 */
export const LOST_REASON_KEYS = [
  'price',
  'competitor',
  'noBudget',
  'noResponse',
  'timing',
  'notFit',
] as const;
export type LostReasonKey = (typeof LOST_REASON_KEYS)[number];

export const LOST_REASON_MAX = 191;
export const OTHER = 'other';

/** One choice in the picker. `id` is set for a catalogue reason; a preset travels as text. */
export interface ReasonOption {
  value: string;
  label: string;
  id?: string;
}

/** What the API takes: a catalogue id, or free text. */
export type LostReasonPayload = { lostReasonId: string } | { lostReason: string };

/** The payload for the person's choice, or null while the form is not complete. */
export function resolveLostReason(
  choice: string,
  options: readonly ReasonOption[],
  otherText: string,
): LostReasonPayload | null {
  if (!choice) return null;
  if (choice === OTHER) {
    const text = otherText.trim().slice(0, LOST_REASON_MAX);
    return text === '' ? null : { lostReason: text };
  }
  const found = options.find((o) => o.value === choice);
  if (!found) return null;
  if (found.id) return { lostReasonId: found.id };
  const label = found.label.trim().slice(0, LOST_REASON_MAX);
  return label === '' ? null : { lostReason: label };
}
