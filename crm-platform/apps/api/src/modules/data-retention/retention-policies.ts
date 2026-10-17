/**
 * Which partitioned streams are cut, and when (docs/superpowers/specs/2026-10-16-event-based-analytics-design.md, section 6).
 *
 * A stream's cut ships only after its readers have switched to the rollups, so the registry grows phase by phase. Phase 0 registers
 * the event store itself.
 */
export interface StreamPolicy {
  /** Partitioned parent table in `public`. Partitions are named `<stream>_YYYYMM` (see `ensure_monthly_partition`). */
  stream: string;
  /** The range-partition column. */
  partitionKey: string;
  /** The unique, ascending id column the export pages by (every stream's primary key is `(id, <partition key>)`). */
  idColumn: string;
  /** The column holding the workspace id; one archive object is written per value. */
  orgColumn: string;
  /** A month is archived and dropped once its end is this many days in the past. */
  liveDays: number;
  /** Archive objects older than this are deleted. `null` keeps them forever. */
  archiveDays: number | null;
  /** Columns left out of the archive object (links to a person, so a contact erase never has to rewrite an archive). */
  omitColumns: readonly string[];
}

export const STREAM_POLICIES: readonly StreamPolicy[] = [
  {
    stream: 'an_events',
    partitionKey: 'recorded_at',
    idColumn: 'id',
    orgColumn: 'org_id',
    liveDays: 60,
    archiveDays: null,
    omitColumns: ['contact_id'],
  },
];

/** Nest injection token for the list of policies, so tests can run the engine on a synthetic stream. Bound to `STREAM_POLICIES`. */
export const RETENTION_POLICIES = Symbol('RETENTION_POLICIES');

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DAY_MS = 86_400_000;
function parseMonth(month: string): { year: number; month: number } {
  const m = MONTH.exec(month);
  if (!m) throw new Error(`not a YYYY-MM month: ${JSON.stringify(month)}`);
  return { year: Number(m[1]), month: Number(m[2]) };
}

/** First instant of the month (inclusive) and of the next month (exclusive), in UTC. */
export function monthBounds(month: string): { from: Date; to: Date } {
  const { year, month: m } = parseMonth(month);
  return { from: new Date(Date.UTC(year, m - 1, 1)), to: new Date(Date.UTC(year, m, 1)) };
}

/** `an_events` + `2026-08` -> `an_events_202608`. Throws on anything that is not a month. */
export function partitionName(stream: string, month: string): string {
  const { year, month: m } = parseMonth(month);
  return `${stream}_${String(year).padStart(4, '0')}${String(m).padStart(2, '0')}`;
}

/** `an_events_202608` -> `2026-08`, or null when the table name is not a monthly partition of `stream`. */
export function monthOfPartition(stream: string, table: string): string | null {
  if (!table.startsWith(`${stream}_`)) return null;
  const m = /^(\d{4})(0[1-9]|1[0-2])$/.exec(table.slice(stream.length + 1));
  return m ? `${m[1]}-${m[2]}` : null;
}

/** True when the month's end is at least `liveDays` before `now`: the month is closed and its live window is over. */
export function isPastLiveWindow(month: string, now: Date, liveDays: number): boolean {
  if (!Number.isInteger(liveDays) || liveDays < 0) {
    throw new Error(`liveDays must be a whole number of days, got ${liveDays}`);
  }
  return monthBounds(month).to.getTime() <= now.getTime() - liveDays * DAY_MS;
}
