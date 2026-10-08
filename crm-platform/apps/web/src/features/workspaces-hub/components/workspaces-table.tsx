'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { WorkspaceHubRow } from '@crm/contracts';
import { Card, cn } from '@crm/ui';
import type { ColumnId } from '../lib/columns';
import type { HubAccess } from '../lib/permissions';
import {
  EndsCell,
  LastActiveCell,
  LimitsCell,
  Messages7dCell,
  MrrCell,
  NumbersCell,
  OwnerCell,
  PlanCell,
  ProviderCell,
  StateCell,
  WalletCell,
  WorkspaceCell,
} from './cells';
import { RowActions, type HubActionId } from './row-actions';

const RIGHT: ReadonlySet<ColumnId> = new Set(['wallet', 'mrr', 'messages7d', 'numbers']);

function cellFor(id: ColumnId, row: WorkspaceHubRow, currency: string): ReactNode {
  switch (id) {
    case 'workspace':
      return <WorkspaceCell row={row} />;
    case 'provider':
      return <ProviderCell row={row} />;
    case 'numbers':
      return <NumbersCell row={row} />;
    case 'plan':
      return <PlanCell row={row} />;
    case 'state':
      return <StateCell row={row} />;
    case 'ends':
      return <EndsCell row={row} />;
    case 'limits':
      return <LimitsCell row={row} />;
    case 'wallet':
      return <WalletCell row={row} />;
    case 'owner':
      return <OwnerCell row={row} />;
    case 'mrr':
      return <MrrCell row={row} currency={currency} />;
    case 'messages7d':
      return <Messages7dCell row={row} />;
    case 'lastActive':
      return <LastActiveCell row={row} />;
  }
}

/** The workspace table: only the chosen columns, a tinted row for a suspended workspace, the action menu at the end. */
export function WorkspacesTable({
  rows,
  columns,
  currency,
  access,
  onAction,
}: {
  rows: readonly WorkspaceHubRow[];
  columns: readonly ColumnId[];
  currency: string;
  access: HubAccess;
  onAction: (row: WorkspaceHubRow, action: HubActionId) => void;
}) {
  const t = useTranslations('workspaces-hub.list');
  const tc = useTranslations('workspaces-hub.list.columns');
  return (
    <Card className="overflow-x-auto p-0">
      <table
        className="w-full min-w-max text-sm"
        aria-label={t('tableLabel')}
        data-testid="hub-table"
      >
        <thead>
          <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
            {columns.map((c) => (
              <th
                key={c}
                scope="col"
                data-col={c}
                className={cn(
                  'whitespace-nowrap px-3 py-2.5 font-medium',
                  RIGHT.has(c) ? 'text-end' : 'text-start',
                )}
              >
                {tc(c)}
              </th>
            ))}
            <th scope="col" className="w-12 px-3 py-2.5">
              <span className="sr-only">{tc('actions')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.workspaceId}
              data-testid="hub-row"
              className={cn(
                'border-b border-border align-top last:border-0',
                row.status === 'suspended' && 'bg-danger/5',
              )}
            >
              {columns.map((c) => (
                <td key={c} data-col={c} className={cn('px-3 py-2.5', RIGHT.has(c) && 'text-end')}>
                  {cellFor(c, row, currency)}
                </td>
              ))}
              <td className="px-3 py-2.5 text-end">
                <RowActions row={row} access={access} onAction={(a) => onAction(row, a)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
