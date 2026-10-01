import type { Stage, StageInput, StageKind } from '../api/schemas';

/** Rules for editing a pipeline's stages (TW-DEAL-041, with the spec's recommendations). Pure. */

export const STAGE_COLORS = [
  '#64748B',
  '#0EA5E9',
  '#6366F1',
  '#F59E0B',
  '#16A34A',
  '#DC2626',
  '#0F766E',
  '#BE185D',
] as const;

export type StageProblem =
  | 'nameRequired'
  | 'nameTooLong'
  | 'probability'
  | 'color'
  | 'twoWon'
  | 'twoLost';

/** A stage's probability follows its kind: won is 100, lost is 0. */
export function probabilityFor(kind: StageKind, wanted: number): number {
  if (kind === 'won') return 100;
  if (kind === 'lost') return 0;
  return Math.max(0, Math.min(100, Math.round(Number.isFinite(wanted) ? wanted : 0)));
}

export function validateStage(
  input: StageInput,
  siblings: readonly Pick<Stage, 'id' | 'kind'>[],
  selfId?: string,
): StageProblem[] {
  const out: StageProblem[] = [];
  const name = input.name.trim();
  if (name === '') out.push('nameRequired');
  else if (name.length > 120) out.push('nameTooLong');
  if (!Number.isInteger(input.probability) || input.probability < 0 || input.probability > 100) {
    out.push('probability');
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(input.color)) out.push('color');
  const others = siblings.filter((s) => s.id !== selfId);
  if (input.kind === 'won' && others.some((s) => s.kind === 'won')) out.push('twoWon');
  if (input.kind === 'lost' && others.some((s) => s.kind === 'lost')) out.push('twoLost');
  return out;
}

/** Moves the item at `from` to `to`; a copy of the same order when nothing changes. */
export function moveStage<T>(items: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) {
    return [...items];
  }
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

/**
 * A new open stage goes before the first Won or Lost stage so closing stages stay at the end of the board.
 * A new Won or Lost stage goes last.
 */
export function insertionIndex(stages: readonly Pick<Stage, 'kind'>[], kind: StageKind): number {
  if (kind !== 'open') return stages.length;
  const firstClosing = stages.findIndex((s) => s.kind !== 'open');
  return firstClosing === -1 ? stages.length : firstClosing;
}

/** Stages a deleted stage's deals can move to: every other stage of the pipeline. */
export const reassignTargets = <T extends Pick<Stage, 'id'>>(
  stages: readonly T[],
  deletedId: string,
): T[] => stages.filter((s) => s.id !== deletedId);

/** The delete needs a destination exactly when deals still sit in the stage. */
export const needsReassign = (stage: Pick<Stage, 'dealCount'>): boolean => stage.dealCount > 0;
