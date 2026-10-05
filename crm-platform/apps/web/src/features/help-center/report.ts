export interface PendingRow {
  unit: string;
  domain: string;
  owner: string;
}

/**
 * `docs/help-pending.md`: the units with no guide, grouped by owner and domain. The first line is a machine-readable count that
 * the post-merge hook and the Claude session-start hook read (see `pendingCount`), so keep it first.
 */
export function renderPending(
  rows: readonly PendingRow[],
  problems: { stale: readonly string[]; bad: readonly string[] },
): string {
  const lines = [`<!-- help-pending: ${rows.length} -->`];
  if (rows.length === 0) {
    lines.push('', 'All features have help guides.');
  } else {
    lines.push(
      '# Help center: features without a guide',
      '',
      `${rows.length} features have no help guide yet. Draft them with the \`help-docs-sync\` skill, or record why not in \`apps/web/src/features/help-center/pending.json\`.`,
    );
    const groups = new Map<string, string[]>();
    for (const row of [...rows].sort(
      (a, b) =>
        a.owner.localeCompare(b.owner) ||
        a.domain.localeCompare(b.domain) ||
        a.unit.localeCompare(b.unit),
    )) {
      const key = `${row.domain} (${row.owner})`;
      groups.set(key, [...(groups.get(key) ?? []), row.unit]);
    }
    for (const [heading, units] of groups) {
      lines.push('', `## ${heading}`, '', ...units.map((u) => `- ${u}`));
    }
  }
  if (problems.stale.length > 0 || problems.bad.length > 0) {
    lines.push('', '## Problems in pending.json');
    for (const unit of problems.stale)
      lines.push(`- ${unit}: stale (documented now, or not a real unit); remove it`);
    for (const unit of problems.bad)
      lines.push(`- ${unit}: needs a known owner, a reason, and to appear once`);
  }
  return `${lines.join('\n')}\n`;
}

/** The count on the first line of a `help-pending.md`; 0 when the line is missing or unreadable. */
export function pendingCount(text: string): number {
  const match = /^<!-- help-pending: (\d+) -->/.exec(text);
  return match ? Number(match[1]) : 0;
}
