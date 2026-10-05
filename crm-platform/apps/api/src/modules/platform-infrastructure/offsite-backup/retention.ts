/**
 * What to keep off-host: every dump from the last `dailyDays` days, the first dump of each calendar month (UTC) for the last
 * `months` months, and always the newest `keepNewest`. Everything else may go. A name this tool did not give (no timestamp in it)
 * is never listed for deletion.
 */
export interface RemoteDump {
  key: string;
  /** When the dump was taken, from its file name; null if the name has no timestamp. */
  at: Date | null;
}

export interface RetentionPolicy {
  dailyDays: number;
  months: number;
  keepNewest: number;
}

export const DEFAULT_RETENTION: RetentionPolicy = { dailyDays: 30, months: 12, keepNewest: 3 };

const NAME = /^desk-([a-z0-9-]+)-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.dump(\.enc)?$/;

/** `desk-daily-20261004T020000Z.dump.enc` -> the time in it, or null. `key` may include a prefix path. */
export function takenAt(key: string): Date | null {
  const m = NAME.exec(key.split('/').pop() ?? '');
  if (!m) return null;
  const [, , y, mo, d, h, mi, s] = m;
  const at = new Date(Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!, +s!));
  return Number.isNaN(at.getTime()) ? null : at;
}

export const isDumpName = (name: string): boolean => NAME.test(name);

export function planRetention(
  dumps: RemoteDump[],
  now: Date,
  policy: RetentionPolicy = DEFAULT_RETENTION,
): { keep: string[]; remove: string[] } {
  const dated = dumps
    .filter((d): d is RemoteDump & { at: Date } => d.at !== null)
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  const keep = new Set<string>(dumps.filter((d) => d.at === null).map((d) => d.key));

  const dailyFrom = now.getTime() - policy.dailyDays * 86_400_000;
  for (const d of dated) if (d.at.getTime() >= dailyFrom) keep.add(d.key);

  for (const d of dated.slice(-policy.keepNewest)) keep.add(d.key);

  // first dump of each month, for the last `months` months including this one
  const monthFloor = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (policy.months - 1), 1);
  const seen = new Set<string>();
  for (const d of dated) {
    if (d.at.getTime() < monthFloor) continue;
    const month = `${d.at.getUTCFullYear()}-${d.at.getUTCMonth()}`;
    if (!seen.has(month)) {
      seen.add(month);
      keep.add(d.key);
    }
  }
  return { keep: [...keep], remove: dated.filter((d) => !keep.has(d.key)).map((d) => d.key) };
}
