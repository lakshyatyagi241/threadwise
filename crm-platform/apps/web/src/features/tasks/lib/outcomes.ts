import type { TaskOutcomeRef, TaskOutcomeResponse } from '@crm/contracts';

/**
 * The options of an outcome picker, in the workspace's order: every outcome offered, plus the one the task already carries when it
 * is no longer offered (hidden), so a saved task never shows an empty picker for a value it holds. Pure, so it is tested alone.
 */
export function outcomeChoices(
  offered: readonly Pick<TaskOutcomeResponse, 'id' | 'name' | 'isActive'>[],
  current: TaskOutcomeRef | null,
): TaskOutcomeRef[] {
  const out: TaskOutcomeRef[] = offered.map((o) => ({ id: o.id, name: o.name, isActive: o.isActive }));
  if (current && !out.some((o) => o.id === current.id)) out.push(current);
  return out;
}

/** Moves the item at `from` to `to` (a new array); an out-of-range move changes nothing. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  if (from < 0 || from >= next.length || to < 0 || to >= next.length || from === to) return next;
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

/** The client-side checks of the outcome name (the server decides uniqueness): empty, or longer than the limit. */
export function validateOutcomeName(
  name: string,
  max: number,
): 'nameRequired' | 'nameTooLong' | null {
  const n = name.trim();
  if (n === '') return 'nameRequired';
  if ([...n].length > max) return 'nameTooLong';
  return null;
}
