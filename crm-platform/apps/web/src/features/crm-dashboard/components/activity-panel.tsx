'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { CrmDashboardResponse } from '@crm/contracts';
import { Panel } from '@/features/dashboards-analytics-charts/components/parts';

type Entry = NonNullable<CrmDashboardResponse['activity']>[number];

const DEAL_TYPES = new Set(['note', 'stage_change', 'call', 'message', 'email', 'meeting', 'task']);

/** The newest things people did on deals and contacts. A row opens the deal or the contact. */
export function ActivityPanel({
  entries,
  timezone,
}: {
  entries: Entry[];
  timezone: string;
}) {
  const t = useTranslations('crm-dashboard.activity');
  const locale = useLocale();
  const when = (iso: string) => {
    try {
      return new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: timezone,
      }).format(new Date(iso));
    } catch {
      return iso;
    }
  };
  const what = (e: Entry): string => {
    if (e.stageChange) {
      return e.stageChange.from
        ? t('stageMoved', { from: e.stageChange.from, to: e.stageChange.to ?? '' })
        : t('stagePlaced', { to: e.stageChange.to ?? '' });
    }
    if (e.kind === 'deal' && DEAL_TYPES.has(e.type)) return t(`type.${e.type}`);
    return e.type.replace(/[_-]+/g, ' ');
  };
  return (
    <Panel title={t('title')}>
      {entries.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {entries.map((e, i) => (
            <li key={`${e.kind}-${e.subjectId}-${e.at}-${i}`} className="flex items-start justify-between gap-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="truncate">
                  <span className="font-medium">{what(e)}</span>
                  {e.subject && (
                    <>
                      <span className="text-muted-foreground"> · </span>
                      <Link
                        href={e.kind === 'deal' ? `/deals?deal=${e.subjectId}` : `/contacts/${e.subjectId}`}
                        className="hover:underline"
                      >
                        {e.subject}
                      </Link>
                    </>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {e.actor ? t('by', { name: e.actor.name }) : t('system')}
                </div>
              </div>
              <time dateTime={e.at} className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {when(e.at)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
