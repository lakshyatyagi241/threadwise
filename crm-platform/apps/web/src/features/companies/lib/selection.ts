/** Which rows of the list are ticked. Pure, so the rules (and the mixed header state) are tested without a screen. */
export type CheckState = 'none' | 'some' | 'all';

export function toggle(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (!next.delete(id)) next.add(id);
  return next;
}

/** The header checkbox: every loaded row ticked, some, or none. */
export function headerState(ids: readonly string[], selected: ReadonlySet<string>): CheckState {
  if (ids.length === 0) return 'none';
  const ticked = ids.filter((id) => selected.has(id)).length;
  return ticked === 0 ? 'none' : ticked === ids.length ? 'all' : 'some';
}

/** Ticks or unticks every loaded row, keeping what is ticked outside them (rows from a page that is still loaded). */
export function setAll(
  ids: readonly string[],
  selected: ReadonlySet<string>,
  on: boolean,
): Set<string> {
  const next = new Set(selected);
  for (const id of ids) {
    if (on) next.add(id);
    else next.delete(id);
  }
  return next;
}

/** Drops ticks of rows that are gone (deleted, or filtered out), so a bulk action never names a row nobody can see. */
export function retain(selected: ReadonlySet<string>, ids: readonly string[]): Set<string> {
  const here = new Set(ids);
  return new Set([...selected].filter((id) => here.has(id)));
}

/** Slices of at most `size` ids for the bulk endpoints (they take 100). */
export function chunk<T>(items: readonly T[], size = 100): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
