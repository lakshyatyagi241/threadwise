'use client';

import { useTranslations } from 'next-intl';
import {
  RETENTION_GROUPS,
  retentionDeleteAfterDays,
  type RetentionItemView,
  type RetentionOverview,
} from '@crm/contracts';
import { Badge, Card } from '@crm/ui';

const NS = 'data-retention';

/** The days after writing that a row is gone for good, or null when it is kept for ever. */
export function deletedAfter(item: RetentionItemView): number | null {
  if (!item.canArchive) return item.liveDays;
  return retentionDeleteAfterDays(item);
}

/**
 * Every retention number on one screen, grouped, so an admin can read them off and decide without opening each card. A row links to its
 * card below, where the numbers are changed.
 */
export function RetentionTable({
  items,
  archiveDriver,
}: {
  items: readonly RetentionItemView[];
  archiveDriver: RetentionOverview['engine']['archiveDriver'];
}) {
  const t = useTranslations(NS);
  return (
    <Card className="space-y-3 overflow-x-auto" data-testid="retention-table">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{t('table.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('table.description')}</p>
      </div>
      <table className="w-full min-w-[44rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-start text-xs text-muted-foreground">
            <th scope="col" className="py-2 pe-3 text-start font-medium">
              {t('table.item')}
            </th>
            <th scope="col" className="py-2 pe-3 text-start font-medium">
              {t('table.storedIn')}
            </th>
            <th scope="col" className="py-2 pe-3 text-start font-medium">
              {t('table.live')}
            </th>
            <th scope="col" className="py-2 pe-3 text-start font-medium">
              {t('table.archive')}
            </th>
            <th scope="col" className="py-2 pe-3 text-start font-medium">
              {t('table.deleted')}
            </th>
            <th scope="col" className="py-2 text-start font-medium">
              {t('table.setting')}
            </th>
          </tr>
        </thead>
        {RETENTION_GROUPS.map((group) => {
          const rows = items.filter((i) => i.group === group);
          if (rows.length === 0) return null;
          return (
            <tbody key={group} data-testid={`retention-table-group-${group}`}>
              <tr>
                <th
                  scope="colgroup"
                  colSpan={6}
                  className="bg-muted/40 px-2 py-1.5 text-start font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground"
                >
                  {t(`groups.${group}`)}
                </th>
              </tr>
              {rows.map((item) => {
                const gone = deletedAfter(item);
                return (
                  <tr
                    key={item.id}
                    className="border-b border-border/60 align-top"
                    data-testid={`retention-row-${item.id}`}
                  >
                    <th scope="row" className="py-2 pe-3 text-start font-medium">
                      <a
                        href={`#retention-${item.id}`}
                        className="underline-offset-2 hover:underline"
                      >
                        {t(`items.${item.id}.title`)}
                      </a>
                    </th>
                    <td className="py-2 pe-3 text-muted-foreground">
                      {t(`table.where.${item.kind}`, {
                        driver: archiveDriver === 's3' ? 'S3 / R2' : 'local',
                      })}
                    </td>
                    <td
                      className="py-2 pe-3 tabular-nums"
                      data-testid={`retention-row-live-${item.id}`}
                    >
                      {t('table.days', { count: item.liveDays })}
                    </td>
                    <td
                      className="py-2 pe-3 tabular-nums"
                      data-testid={`retention-row-archive-${item.id}`}
                    >
                      {!item.canArchive
                        ? t('table.noArchive')
                        : item.archiveDays === null
                          ? t('table.forever')
                          : t('table.days', { count: item.archiveDays })}
                    </td>
                    <td
                      className="py-2 pe-3 tabular-nums"
                      data-testid={`retention-row-deleted-${item.id}`}
                    >
                      {gone === null ? t('table.never') : t('table.days', { count: gone })}
                    </td>
                    <td className="py-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone={item.source === 'custom' ? 'success' : 'neutral'}>
                          {t(`status.${item.source}`)}
                        </Badge>
                        {!item.applied && <Badge tone="warning">{t('status.notApplied')}</Badge>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          );
        })}
      </table>
    </Card>
  );
}
