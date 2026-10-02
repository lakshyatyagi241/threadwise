import {
  updateNodePacingSchema,
  type NodePacing,
  type UpdateNodePacingInput,
} from '@crm/contracts';

/** The pacing form as typed: numbers stay strings until the save, so a half-typed value is never coerced. */
export interface PacingDraft {
  msgGap: string;
  batchesGap: string;
  bwMsgGap: string;
  enableBatches: boolean;
}

export const draftFromPacing = (p: NodePacing): PacingDraft => ({
  msgGap: String(p.msgGap),
  batchesGap: String(p.batchesGap),
  bwMsgGap: String(p.bwMsgGap),
  enableBatches: p.enableBatches,
});

export type PacingField = 'msgGap' | 'batchesGap' | 'bwMsgGap';

/** The request body, or the first field that does not fit its limit (the server enforces the same limits). */
export function toPacingBody(
  draft: PacingDraft,
  rowVersion: number,
): { body: UpdateNodePacingInput } | { error: PacingField } {
  const fields: PacingField[] = ['msgGap', 'batchesGap', 'bwMsgGap'];
  const num = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v.trim()) : Number.NaN);
  const candidate = {
    msgGap: num(draft.msgGap),
    batchesGap: num(draft.batchesGap),
    bwMsgGap: num(draft.bwMsgGap),
    enableBatches: draft.enableBatches,
    rowVersion,
  };
  const parsed = updateNodePacingSchema.safeParse(candidate);
  if (parsed.success) return { body: parsed.data };
  const bad = parsed.error.issues
    .map((i) => i.path[0])
    .find((p): p is PacingField => fields.includes(p as PacingField));
  return { error: bad ?? 'msgGap' };
}
