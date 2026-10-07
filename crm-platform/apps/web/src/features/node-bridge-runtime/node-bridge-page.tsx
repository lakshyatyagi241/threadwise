'use client';

import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { nodeBridgeResponseSchema } from '@crm/contracts';
import { Alert, Button, Spinner, cn } from '@crm/ui';
import { useOperator } from '@/features/auth-registration-security/platform/operator-context';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { BridgeCard } from './bridge-card';
import { errorKind } from './lib/errors';
import { unofficialView } from './lib/unofficial';
import { PacingCard } from './pacing-card';
import { NODE_BRIDGE_QUERY_KEY } from './queries';
import { UnofficialCard } from './unofficial-card';
import { WorkspacesPanel } from './workspaces-panel';

const NS = 'node-bridge-runtime';

/** The Node bridge address and token, then the send pacing, as one console page (WD-NODE-052, 029). */
export function NodeBridgePage() {
  const t = useTranslations(NS);
  const { operator } = useOperator();
  const canEdit = operator.role === 'super_admin';
  const q = useQuery({
    queryKey: NODE_BRIDGE_QUERY_KEY,
    queryFn: ({ signal }) =>
      operatorFetch('/node-bridge', { schema: nodeBridgeResponseSchema, signal }),
    refetchOnWindowFocus: false,
  });

  if (q.isPending) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <Spinner /> {t('loading')}
      </div>
    );
  }
  if (q.isError) {
    return (
      <Alert tone="danger" role="alert">
        <p>{t(`errors.${errorKind(q.error)}`)}</p>
        <Button variant="secondary" size="sm" className="mt-2" onClick={() => void q.refetch()}>
          {t('retry')}
        </Button>
      </Alert>
    );
  }
  const view = unofficialView(q.data.unofficialEnabled);
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {!canEdit && <Alert tone="info">{t('page.superOnly')}</Alert>}
      <UnofficialCard data={q.data} canEdit={canEdit} />
      <WorkspacesPanel
        platformOn={q.data.unofficialEnabled}
        workspaceCount={q.data.unofficialWorkspaceCount}
        canEdit={canEdit}
      />
      {view.dimRest && (
        <Alert tone="warning" data-testid="unofficial-off-note">
          {t('unofficial.dimNote')}
        </Alert>
      )}
      {/* While the switch is off nothing below is used: it stays visible, dimmed, so it can be prepared before the engine is turned on. */}
      <div
        className={cn('space-y-6 transition-opacity', view.dimRest && 'opacity-50')}
        data-testid="node-bridge-settings"
        data-dimmed={view.dimRest || undefined}
      >
        {/* Remounted on every new version so a save or conflict leaves the forms showing what the server holds. */}
        <BridgeCard key={`b${q.data.rowVersion}`} data={q.data} canEdit={canEdit} />
        <PacingCard key={`p${q.data.pacingRowVersion}`} data={q.data} canEdit={canEdit} />
      </div>
    </div>
  );
}
