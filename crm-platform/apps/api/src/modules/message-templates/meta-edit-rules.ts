/**
 * Meta's rules for editing a template it holds ("Edit templates" in Meta's template management docs):
 * - only an APPROVED, REJECTED or PAUSED template can be edited, and a template in review cannot;
 * - the name and the language never change; only the category, the components and the time-to-live do;
 * - an approved template can be edited once in 24 hours and ten times in 30 days; a rejected or paused one has no limit.
 * A template Meta has never received (a draft, or one whose submit failed) is not on Meta, so its edits stay local.
 */

export const META_EDIT_DAY_MS = 24 * 60 * 60 * 1000;
export const META_EDIT_MONTH_MS = 30 * META_EDIT_DAY_MS;
export const META_EDIT_MONTH_LIMIT = 10;

export type LimitBlock = { reason: 'daily_limit' | 'monthly_limit'; until: Date };
export type MetaEditBlock = { reason: 'in_review'; until: null } | LimitBlock;

/** The edit times kept on a row that are still inside the 30-day window, oldest first. */
export function metaEditTimes(log: readonly string[], now: Date): Date[] {
  const floor = now.getTime() - META_EDIT_MONTH_MS;
  return log
    .map((iso) => new Date(iso))
    .filter((d) => !Number.isNaN(d.getTime()) && d.getTime() > floor)
    .sort((a, b) => a.getTime() - b.getTime());
}

/** The edit log after an edit sent to Meta now: the times still in the window, plus this one (ISO strings, as stored). */
export function metaEditLogAfter(log: readonly string[], now: Date): string[] {
  return [...metaEditTimes(log, now).map((d) => d.toISOString()), now.toISOString()];
}

/**
 * Why Meta would refuse an edit of this template right now, or null when it would accept one. The rule that binds last is
 * the one reported, since the template can only be edited again once that one has passed.
 */
export function metaEditBlockOf(
  row: { status: string; metaTemplateId: string | null; metaEditLog: readonly string[] },
  now: Date,
): MetaEditBlock | null {
  if (row.metaTemplateId === null) return null;
  if (row.status === 'pending') return { reason: 'in_review', until: null };
  if (row.status !== 'approved') return null;

  const times = metaEditTimes(row.metaEditLog, now);
  const blocks: LimitBlock[] = [];
  const last = times[times.length - 1];
  if (last && now.getTime() - last.getTime() < META_EDIT_DAY_MS)
    blocks.push({ reason: 'daily_limit', until: new Date(last.getTime() + META_EDIT_DAY_MS) });
  if (times.length >= META_EDIT_MONTH_LIMIT) {
    const oldestCounted = times[times.length - META_EDIT_MONTH_LIMIT];
    blocks.push({
      reason: 'monthly_limit',
      until: new Date(oldestCounted.getTime() + META_EDIT_MONTH_MS),
    });
  }
  return blocks.reduce<LimitBlock | null>(
    (latest, b) => (latest === null || b.until.getTime() > latest.until.getTime() ? b : latest),
    null,
  );
}
