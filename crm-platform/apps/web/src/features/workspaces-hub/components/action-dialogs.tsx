'use client';

import type { WorkspaceHubRow } from '@crm/contracts';
import { ImpersonateDialog } from './impersonate-dialog';
import { PlanDialog } from './plan-dialog';
import { ProviderDialog } from './provider-dialog';
import { SuspendDialog } from './suspend-dialog';

export type DialogAction = 'editPlan' | 'provider' | 'impersonate' | 'suspend' | 'unsuspend';
export interface ActionTarget {
  action: DialogAction;
  row: Pick<WorkspaceHubRow, 'workspaceId' | 'name' | 'status' | 'provider'>;
}

/** Every dialog a row action can open, mounted once per page; only the one named by `target` is open. */
export function ActionDialogs({
  target,
  onClose,
}: {
  target: ActionTarget | null;
  onClose: () => void;
}) {
  const row = target?.row ?? null;
  const is = (a: DialogAction) => (target?.action === a ? row : null);
  return (
    <>
      <PlanDialog
        workspaceId={is('editPlan')?.workspaceId ?? null}
        name={row?.name ?? ''}
        onClose={onClose}
      />
      <ProviderDialog workspace={is('provider')} onClose={onClose} />
      <ImpersonateDialog workspace={is('impersonate')} onClose={onClose} />
      <SuspendDialog workspace={is('suspend')} mode="suspend" onClose={onClose} />
      <SuspendDialog workspace={is('unsuspend')} mode="unsuspend" onClose={onClose} />
    </>
  );
}
