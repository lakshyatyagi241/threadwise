/**
 * Picking the agent (WD-TIB2-020, with the port's fixes: a real rotation instead of "oldest updated_at", the load a live count).
 * Pure: the engine hands in the people who may take the conversation right now and what it remembers.
 */

/**
 * Round robin: the next person in id order after the one who got the last conversation of this rule (`cursor`, an internal user
 * id), wrapping to the first. The cursor is an id, not a position, so people joining, leaving or being skipped as unavailable never
 * make the rotation repeat or jump; a cursor whose person is gone simply continues from where their id would have been.
 * `pool` is the available people, any order. Null when nobody is available.
 */
export function pickRoundRobin(pool: readonly number[], cursor: number | null): number | null {
  if (pool.length === 0) return null;
  const sorted = [...new Set(pool)].sort((a, b) => a - b);
  if (cursor === null) return sorted[0]!;
  return sorted.find((id) => id > cursor) ?? sorted[0]!;
}

/** Least busy: the fewest open conversations; a tie is broken by the rotation, so equal people still take turns. */
export function pickLeastBusy(
  pool: ReadonlyArray<{ userId: number; open: number }>,
  cursor: number | null,
): number | null {
  if (pool.length === 0) return null;
  const fewest = Math.min(...pool.map((p) => p.open));
  return pickRoundRobin(
    pool.filter((p) => p.open === fewest).map((p) => p.userId),
    cursor,
  );
}
