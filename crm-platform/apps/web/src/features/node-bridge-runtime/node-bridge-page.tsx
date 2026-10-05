'use client';

import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { nodeBridgeResponseSchema } from '@crm/contracts';
import { Alert, Button, Spinner } from '@crm/ui';
import { useOperator } from '@/features/auth-registration-security/platform/operator-context';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { BridgeCard } from './bridge-card';
import { errorKind } from './lib/errors';
import { PacingCard } from './pacing-card';
import { NODE_BRIDGE_QUERY_KEY } from './queries';

const NS = 'node-bridge-runtime';

/** The Node bridge address and token, then the send pacing, as one console page (TW-NODE-052, 029). */
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
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {!canEdit && <Alert tone="info">{t('page.superOnly')}</Alert>}
      {/* Remounted on every new version so a save or conflict leaves the forms showing what the server holds. */}
      <BridgeCard key={`b${q.data.rowVersion}`} data={q.data} canEdit={canEdit} />
      <PacingCard key={`p${q.data.pacingRowVersion}`} data={q.data} canEdit={canEdit} />
    </div>
  );
}
