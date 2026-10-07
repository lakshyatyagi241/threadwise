'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { Badge, Button, EmptyState } from '@crm/ui';
import type { WorkspaceOption, WorkspaceRow } from './lib/workspaces';

const NS = 'node-bridge-runtime.workspaces';

/** The "add workspace" search hits: name, slug, plan, owner e-mail and the Add button (or "Already allowed"). */
export function OptionList({
  options,
  busy,
  onAdd,
}: {
  options: readonly WorkspaceOption[];
  busy: boolean;
  onAdd: (option: WorkspaceOption) => void;
}) {
  const t = useTranslations(NS);
  return (
    <ul
      className="divide-y divide-border rounded-md border border-border"
      aria-label={t('search.results')}
      data-testid="workspace-options"
    >
      {options.map((o) => (
        <li key={o.orgUuid} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
          <div className="min-w-0 flex-1 space-y-0.5 text-sm">
            <p className="truncate font-medium">{o.name}</p>
            <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
              <span dir="ltr" className="font-mono">
                {o.slug}
              </span>
              <Badge>{o.planSlug ?? t('search.noPlan')}</Badge>
              {o.ownerEmail && (
                <span dir="ltr" className="truncate">
                  {t('search.owner', { email: o.ownerEmail })}
                </span>
              )}
            </p>
          </div>
          {o.canAdd ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => onAdd(o)}
              data-testid={`workspace-add-${o.slug}`}
            >
              {t('search.add')}
            </Button>
          ) : (
            <Badge tone="success">{t('search.alreadyAdded')}</Badge>
          )}
        </li>
      ))}
    </ul>
  );
}

/** The allow-list: one row per workspace. Remove is drawn only when `onRemove` is given (a super admin). */
export function WorkspaceTable({
  rows,
  busy,
  onRemove,
}: {
  rows: readonly WorkspaceRow[];
  busy: boolean;
  onRemove?: (row: WorkspaceRow) => void;
}) {
  const t = useTranslations(NS);
  const format = useFormatter();
  if (rows.length === 0) {
    return <EmptyState title={t('empty.title')} message={t('empty.message')} />;
  }
  const th = 'px-3 py-2 text-start font-medium';
  return (
    <div className="overflow-x-auto rounded-md border border-border" data-testid="workspace-table">
      <table className="w-full min-w-[56rem] text-sm">
        <caption className="sr-only">{t('table.caption')}</caption>
        <thead className="bg-muted text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th scope="col" className={th}>
              {t('table.workspace')}
            </th>
            <th scope="col" className={th}>
              {t('table.plan')}
            </th>
            <th scope="col" className={th}>
              {t('table.devices')}
            </th>
            <th scope="col" className={th}>
              {t('table.since')}
            </th>
            <th scope="col" className={th}>
              {t('table.by')}
            </th>
            <th scope="col" className={th}>
              {t('table.note')}
            </th>
            {onRemove && (
              <th scope="col" className={th}>
                <span className="sr-only">{t('table.actions')}</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.orgUuid} data-testid={`workspace-row-${r.slug}`} className="align-top">
              <td className="px-3 py-2">
                <p className="font-medium">{r.name}</p>
                <p dir="ltr" className="text-start font-mono text-xs text-muted-foreground">
                  {r.slug}
                </p>
              </td>
              <td className="px-3 py-2">
                <Badge>{r.planSlug ?? t('table.noPlan')}</Badge>
              </td>
              <td className="px-3 py-2 tabular-nums">
                {r.activeDeviceCount === null
                  ? r.deviceCount
                  : t('table.devicesValue', { active: r.activeDeviceCount, total: r.deviceCount })}
              </td>
              <td className="px-3 py-2">
                {format.dateTime(new Date(r.enabledAt), { dateStyle: 'medium' })}
              </td>
              <td className="px-3 py-2">{r.enabledByName ?? t('table.system')}</td>
              <td className="max-w-64 break-words px-3 py-2 text-muted-foreground">
                {r.note === '' ? t('table.noNote') : r.note}
              </td>
              {onRemove && (
                <td className="px-3 py-2 text-end">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => onRemove(r)}
                    data-testid={`workspace-remove-${r.slug}`}
                  >
                    {t('table.remove')}
                  </Button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
