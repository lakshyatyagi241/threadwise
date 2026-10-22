'use client';

import Link from 'next/link';
import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import type { OrgLifecycleResponse } from '@crm/contracts';
import { Badge, Button, Card, Menu, MenuItem, cn } from '@crm/ui';
import type { RetentionAccess } from '../lib/permissions';
import { MoreIcon } from './icons';
import type { RetentionAction } from './retention-dialogs';

const STATUS_TONE = {
  active: 'success',
  archived: 'warning',
  suspended: 'danger',
  deleted: 'danger',
} as const;

/** The actions the caller may run on one row. A control without its key is not rendered at all. */
export function retentionActions(
  row: Pick<OrgLifecycleResponse, 'status'>,
  access: Pick<RetentionAccess, 'manage' | 'legalHold'>,
): RetentionAction[] {
  const out: RetentionAction[] = [];
  if (access.manage) {
    out.push('policy', 'exempt');
    if (row.status === 'archived') out.push('restore');
  }
  if (access.legalHold) out.push('legalHold');
  return out;
}

function DateText({ iso, locale }: { iso: string | null; locale: string }) {
  const t = useTranslations('workspaces-hub.common');
  const timeZone = useTimeZone();
  if (!iso) return <span className="text-muted-foreground">{t('none')}</span>;
  return (
    <time dateTime={iso}>
      {new Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'medium' }).format(new Date(iso))}
    </time>
  );
}

/** Never delete, legal hold and paid-plan exemption, each with its reason and expiry where there is one. */
export function ProtectionBadges({ row }: { row: OrgLifecycleResponse }) {
  const t = useTranslations('workspaces-hub.retention.badge');
  const locale = useLocale();
  const timeZone = useTimeZone();
  const date = (iso: string) =>
    new Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'medium' }).format(new Date(iso));
  const exemptTitle = [
    row.retentionExemptReason,
    row.retentionExemptUntil
      ? t('until', { date: date(row.retentionExemptUntil) })
      : t('indefinite'),
    row.retentionExemptBy ? t('by', { who: row.retentionExemptBy }) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="flex flex-wrap gap-1">
      {row.retentionExempt && (
        <Badge tone="success" title={exemptTitle} data-testid="badge-never-delete">
          {t('neverDelete')}
        </Badge>
      )}
      {row.legalHold && (
        <Badge tone="danger" data-testid="badge-legal-hold">
          {t('legalHold')}
        </Badge>
      )}
      {row.exemptByPlan && (
        <Badge tone="neutral" title={t('paidPlanHint')} data-testid="badge-paid-plan">
          {t('paidPlan')}
        </Badge>
      )}
    </div>
  );
}

/** The keyset-paged table of workspaces, most idle first. */
export function RetentionTable({
  rows,
  access,
  onAction,
  onHistory,
}: {
  rows: readonly OrgLifecycleResponse[];
  access: RetentionAccess;
  onAction: (row: OrgLifecycleResponse, action: RetentionAction) => void;
  onHistory: (row: OrgLifecycleResponse) => void;
}) {
  const t = useTranslations('workspaces-hub.retention');
  const tc = useTranslations('workspaces-hub.retention.columns');
  const ts = useTranslations('workspaces-hub.retention.status');
  const ta = useTranslations('workspaces-hub.retention.actions');
  const locale = useLocale();
  const num = new Intl.NumberFormat(locale);
  const cols = [
    'workspace',
    'status',
    'daysInactive',
    'lastActivity',
    'archiveOn',
    'eraseOn',
    'reminders',
    'protection',
  ] as const;
  return (
    <Card className="overflow-x-auto p-0">
      <table
        className="w-full min-w-max text-sm"
        aria-label={t('tableLabel')}
        data-testid="retention-table"
      >
        <thead>
          <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
            {cols.map((c) => (
              <th
                key={c}
                scope="col"
                data-col={c}
                className={cn(
                  'whitespace-nowrap px-3 py-2.5 font-medium',
                  c === 'daysInactive' ? 'text-end' : 'text-start',
                )}
              >
                {tc(c)}
              </th>
            ))}
            <th scope="col" className="px-3 py-2.5 text-end">
              <span className="sr-only">{tc('actions')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const actions = retentionActions(row, access);
            return (
              <tr
                key={row.id}
                data-testid="retention-row"
                className="border-b border-border align-top last:border-0"
              >
                <td className="px-3 py-2.5">
                  <Link
                    href={`/admin/workspaces/${row.id}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {row.name}
                  </Link>
                  <div className="font-mono text-xs text-muted-foreground">{row.slug}</div>
                </td>
                <td className="px-3 py-2.5">
                  <Badge tone={STATUS_TONE[row.status]}>{ts(row.status)}</Badge>
                </td>
                <td className="px-3 py-2.5 text-end tabular-nums">
                  {num.format(row.daysInactive)}
                </td>
                <td className="px-3 py-2.5">
                  <DateText iso={row.lastActivityAt} locale={locale} />
                </td>
                <td className="px-3 py-2.5">
                  <DateText iso={row.scheduledArchiveAt} locale={locale} />
                </td>
                <td className="px-3 py-2.5">
                  <DateText iso={row.scheduledDeleteAt} locale={locale} />
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">
                  <div>{t('remindersArchive', { n: row.remindersSent.archive })}</div>
                  <div>{t('remindersErase', { n: row.remindersSent.delete })}</div>
                </td>
                <td className="px-3 py-2.5">
                  <ProtectionBadges row={row} />
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-end">
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="sm" onClick={() => onHistory(row)}>
                      {ta('history')}
                    </Button>
                    {actions.length > 0 && (
                      <Menu
                        label={ta('menu', { name: row.name })}
                        align="end"
                        placement="fixed"
                        triggerClassName="size-8 px-0"
                        triggerProps={{ 'aria-label': ta('menu', { name: row.name }) }}
                        trigger={<MoreIcon className="size-4" />}
                      >
                        {actions.map((id) => (
                          <MenuItem
                            key={id}
                            danger={id === 'legalHold' && !row.legalHold}
                            onSelect={() => onAction(row, id)}
                          >
                            {ta(
                              id === 'exempt'
                                ? row.retentionExempt
                                  ? 'exemptOff'
                                  : 'exemptOn'
                                : id === 'legalHold'
                                  ? row.legalHold
                                    ? 'holdOff'
                                    : 'holdOn'
                                  : id,
                            )}
                          </MenuItem>
                        ))}
                      </Menu>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
