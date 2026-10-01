/**
 * Drizzle's raw `execute()` hands timestamps back as ISO strings (it installs
 * its own parsers so it can map them itself), so a row typed `Date` is a lie.
 * Every place that does date arithmetic on a raw row goes through these.
 */
export type DateLike = Date | string;

export const toDate = (v: DateLike): Date => (v instanceof Date ? v : new Date(v));
export const toMs = (v: DateLike): number => toDate(v).getTime();
export const toIsoString = (v: DateLike): string => toDate(v).toISOString();
