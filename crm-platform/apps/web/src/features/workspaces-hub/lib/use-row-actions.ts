'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { WorkspaceHubRow } from '@crm/contracts';
import type { ActionTarget } from '../components/action-dialogs';
import type { HubActionId } from '../components/row-actions';

export const workspacePath = (id: string, tab?: string) =>
  `/admin/workspaces/${id}${tab ? `?tab=${tab}` : ''}`;

/** Runs a menu choice: the dashboard and the plan-and-limits tab are pages, the rest open a dialog. */
export function useRowActions() {
  const router = useRouter();
  const [target, setTarget] = useState<ActionTarget | null>(null);
  const run = useCallback(
    (row: ActionTarget['row'] & Pick<WorkspaceHubRow, 'workspaceId'>, action: HubActionId) => {
      if (action === 'dashboard') router.push(workspacePath(row.workspaceId));
      else if (action === 'planLimits') router.push(workspacePath(row.workspaceId, 'plan'));
      else setTarget({ action, row });
    },
    [router],
  );
  const close = useCallback(() => setTarget(null), []);
  return { target, run, close };
}
