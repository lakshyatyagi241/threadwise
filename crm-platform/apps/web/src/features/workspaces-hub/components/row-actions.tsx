'use client';

import { useTranslations } from 'next-intl';
import type { WorkspaceHubRow } from '@crm/contracts';
import { Menu, MenuItem, MenuSeparator, cn } from '@crm/ui';
import type { HubAccess } from '../lib/permissions';
import { MoreIcon } from './icons';

export type HubActionId =
  'dashboard' | 'editPlan' | 'planLimits' | 'provider' | 'impersonate' | 'suspend' | 'unsuspend';

/** The menu's rows for one workspace: Reactivate replaces Suspend while the workspace is suspended. */
export function actionsFor(row: Pick<WorkspaceHubRow, 'status'>): HubActionId[] {
  return [
    'dashboard',
    'editPlan',
    'planLimits',
    'provider',
    'impersonate',
    row.status === 'suspended' ? 'unsuspend' : 'suspend',
  ];
}

/** Each menu row and whether the caller may run it (the dashboard is always open to an operator who can see the page). */
export function actionState(
  row: Pick<WorkspaceHubRow, 'status'>,
  access: HubAccess,
): Array<{ id: HubActionId; enabled: boolean }> {
  return actionsFor(row).map((id) => ({ id, enabled: access[id] }));
}

/**
 * The kebab menu of one workspace. An action the caller may not run stays in the menu, greyed, with the reason beside it, so
 * the operator sees it exists; the server stays the authority.
 */
export function RowActions({
  row,
  access,
  onAction,
  triggerClassName,
}: {
  row: Pick<WorkspaceHubRow, 'workspaceId' | 'name' | 'status'>;
  access: HubAccess;
  onAction: (action: HubActionId) => void;
  triggerClassName?: string;
}) {
  const t = useTranslations('workspaces-hub.actions');
  const items = actionState(row, access);
  return (
    <Menu
      label={t('menu', { name: row.name })}
      align="end"
      triggerClassName={cn('size-8 px-0', triggerClassName)}
      triggerProps={{ 'aria-label': t('menu', { name: row.name }) }}
      trigger={<MoreIcon className="size-4" />}
    >
      {items.map(({ id, enabled }) => (
        <div key={id} className="contents">
          {id === 'impersonate' && <MenuSeparator />}
          <MenuItem
            disabled={!enabled}
            hint={enabled ? undefined : t('denied')}
            danger={id === 'suspend'}
            onSelect={() => onAction(id)}
          >
            {t(id)}
          </MenuItem>
        </div>
      ))}
    </Menu>
  );
}
