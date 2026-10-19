'use client';

import { Spinner } from '@crm/ui';
import { useTranslations } from 'next-intl';
import type { WspTeamUsage } from '@crm/contracts';
import { useTeamUsage } from '../api/team-usage';

/** The lines of the "what will change" list, in the order a person weighs them; a zero count is left out. */
const LINES = [
  'members',
  'routingRules',
  'assignmentRules',
  'segmentShares',
  'conversationsAssigned',
  'peopleWithReachChange',
] as const satisfies ReadonlyArray<keyof WspTeamUsage>;

export function usageLines(
  usage: WspTeamUsage,
): Array<{ key: (typeof LINES)[number]; count: number }> {
  return LINES.map((key) => ({ key, count: usage[key] })).filter((l) => l.count > 0);
}

/**
 * "What will change" inside the delete-team confirmation (BL-380). Counts of everything that refers to the team, in neutral words: a
 * team is used by conversations, by "team records" access, by assignment rules and by shared segments, not by the inbox alone. A failed
 * read never blocks the delete: the person is told the check did not run.
 */
export function TeamUsageSummary({ teamId, open }: { teamId: string; open: boolean }) {
  const t = useTranslations('workspaces-teams-tenancy.teams.deleteUsage');
  const usage = useTeamUsage(teamId, open);
  if (usage.isPending) {
    return (
      <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
        <Spinner /> {t('loading')}
      </p>
    );
  }
  if (usage.isError) {
    return <p className="mt-3 text-xs text-muted-foreground">{t('failed')}</p>;
  }
  const lines = usageLines(usage.data);
  return (
    <div className="mt-3 text-sm" data-testid="team-usage" aria-live="polite">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {t('title')}
      </p>
      {lines.length === 0 ? (
        <p className="mt-1">{t('nothing')}</p>
      ) : (
        <ul className="mt-1 list-disc space-y-1 ps-5">
          {lines.map((l) => (
            <li key={l.key}>{t(l.key, { count: l.count })}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
