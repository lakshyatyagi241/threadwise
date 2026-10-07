'use client';

import { useTranslations } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Modal, Spinner } from '@crm/ui';
import {
  PLANS_QUERY_KEY,
  fetchPlans,
} from '@/features/auth-registration-security/platform/plans/plans-query';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { AttachDialog } from '@/features/plans-subscriptions-trials/operator/attach-dialog';
import { WORKSPACE_PLANS_KEY } from '@/features/plans-subscriptions-trials/api';
import { fetchWorkspacePlan, hubKeys } from '../api';
import { HubErrorLine } from './error-line';

/**
 * "Edit & change plan": fetches the workspace's plan state and the plan catalogue, then hands both to the plans domain's own
 * dialog (not a copy of it), so plan, end date, trial and per-workspace limits behave exactly as on the plans screen.
 */
export function PlanDialog({
  workspaceId,
  name,
  onClose,
}: {
  workspaceId: string | null;
  name: string;
  onClose: () => void;
}) {
  const t = useTranslations('workspaces-hub.plan');
  const tc = useTranslations('workspaces-hub.common');
  const toast = useToast();
  const qc = useQueryClient();
  const open = workspaceId !== null;

  const plan = useQuery({
    queryKey: hubKeys.plan(workspaceId ?? ''),
    queryFn: ({ signal }) => fetchWorkspacePlan(workspaceId!, signal),
    enabled: open,
    refetchOnWindowFocus: false,
    gcTime: 0,
  });
  const plans = useQuery({
    queryKey: PLANS_QUERY_KEY,
    queryFn: ({ signal }) => fetchPlans(signal),
    enabled: open,
    refetchOnWindowFocus: false,
  });

  if (open && plan.data && plans.data) {
    return (
      <AttachDialog
        workspace={plan.data}
        plans={plans.data.data}
        onClose={onClose}
        onSaved={() => {
          toast.success(t('saved', { name }));
          onClose();
          void qc.invalidateQueries({ queryKey: hubKeys.all });
          void qc.invalidateQueries({ queryKey: WORKSPACE_PLANS_KEY });
          void qc.invalidateQueries({ queryKey: PLANS_QUERY_KEY });
        }}
      />
    );
  }

  const failed = plan.isError ? plan.error : plans.isError ? plans.error : null;
  return (
    <Modal open={open} onClose={onClose} title={name} closeLabel={tc('close')}>
      {failed ? (
        <div className="space-y-3">
          <Alert tone="danger">{t('loadFailed')}</Alert>
          <HubErrorLine error={failed} />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void plan.refetch();
              void plans.refetch();
            }}
          >
            {tc('retry')}
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner label={t('loading')} /> {t('loading')}
        </div>
      )}
    </Modal>
  );
}
