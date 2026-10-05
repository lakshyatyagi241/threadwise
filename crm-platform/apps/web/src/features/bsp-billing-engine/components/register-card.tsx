'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { BspAllocation, BspAllocationStatus } from '@crm/contracts';
import { Alert, Badge, Button, Card, ConfirmDialog, Spinner } from '@crm/ui';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { KEYS, operatorApi } from '../api';
import { errorView } from '../lib/errors';
import { wabaTail } from '../lib/format';

const TONE: Record<BspAllocationStatus, 'success' | 'neutral' | 'danger'> = {
  attached: 'success',
  revoked: 'neutral',
  failed: 'danger',
};

/** Every credit-line attempt of every workspace, newest first, with a revoke action on the attached ones. */
export function RegisterCard({ canEdit }: { canEdit: boolean }) {
  const t = useTranslations('bsp-billing-engine.console.register');
  const te = useTranslations('bsp-billing-engine.errors');
  const tc = useTranslations('bsp-billing-engine.common');
  const qc = useQueryClient();
  const toast = useToast();
  const [revoking, setRevoking] = useState<BspAllocation | null>(null);

  const q = useInfiniteQuery({
    queryKey: KEYS.allocations,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => operatorApi.allocations(pageParam, signal),
    getNextPageParam: (last) =>
      last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
    refetchOnWindowFocus: false,
  });

  const revoke = useMutation({
    mutationFn: (al: BspAllocation) => operatorApi.revoke(al.id, al.rowVersion),
    onSuccess: async () => {
      toast.success(t('revoked'));
      setRevoking(null);
      await qc.invalidateQueries({ queryKey: KEYS.allocations });
      await qc.invalidateQueries({ queryKey: KEYS.candidates });
    },
    onError: (err) => {
      setRevoking(null);
      const view = errorView(err);
      toast.error(
        view.kind === 'metaRejected'
          ? t('revokeFailed', { error: view.detail ?? '' })
          : te(view.kind),
      );
    },
  });

  const rows = q.data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <Card className="space-y-3">
      <h2 className="text-base font-semibold">{t('title')}</h2>
      {q.isPending ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner label={tc('loading')} />
          {tc('loading')}
        </div>
      ) : q.isError ? (
        <Alert tone="danger" className="flex items-center justify-between gap-2">
          {tc('loadFailed')}
          <Button variant="secondary" size="sm" onClick={() => void q.refetch()}>
            {tc('retry')}
          </Button>
        </Alert>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm" aria-label={t('label')}>
              <thead>
                <tr className="border-b border-border text-start text-xs text-muted-foreground">
                  {(
                    ['workspace', 'waba', 'allocation', 'currency', 'status', 'action'] as const
                  ).map((c) => (
                    <th key={c} scope="col" className="px-2 py-2 text-start font-medium">
                      {t(`columns.${c}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-2 py-8 text-center text-muted-foreground">
                      {t('empty')}
                    </td>
                  </tr>
                )}
                {rows.map((al) => (
                  <tr key={al.id} className="border-b border-border/60 last:border-0">
                    <td className="px-2 py-2">
                      <div className="font-medium">{al.workspaceName}</div>
                      <div className="text-xs text-muted-foreground">
                        {al.workspaceBillingMode === 'reseller' ? t('reseller') : t('direct')}
                      </div>
                    </td>
                    <td className="px-2 py-2 font-mono text-xs" dir="ltr">
                      {wabaTail(al.wabaId)}
                    </td>
                    <td className="px-2 py-2 font-mono text-xs" dir="ltr">
                      {al.allocationConfigId ?? '–'}
                    </td>
                    <td className="px-2 py-2">{al.currency}</td>
                    <td className="px-2 py-2">
                      <span className="inline-flex items-center gap-1.5">
                        <Badge tone={TONE[al.status]}>{t(`status.${al.status}`)}</Badge>
                        {al.lastError && (
                          <span
                            title={al.lastError}
                            aria-label={al.lastError}
                            className="cursor-help font-semibold text-danger"
                          >
                            !
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-2 py-2">
                      {al.status === 'attached' && canEdit ? (
                        <Button variant="secondary" size="sm" onClick={() => setRevoking(al)}>
                          {t('revoke')}
                        </Button>
                      ) : (
                        '–'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {q.hasNextPage && (
            <div className="flex justify-center">
              <Button
                variant="secondary"
                size="sm"
                disabled={q.isFetchingNextPage}
                onClick={() => void q.fetchNextPage()}
              >
                {q.isFetchingNextPage ? t('loadingMore') : t('loadMore')}
              </Button>
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={revoking !== null}
        tone="danger"
        title={t('revokeTitle')}
        message={
          <div className="space-y-2">
            <p>{t('revokeBody')}</p>
            {revoking?.workspaceBillingMode === 'reseller' && (
              <p className="text-warning">{t('revokeStillReseller')}</p>
            )}
          </div>
        }
        confirmLabel={t('revokeConfirm')}
        cancelLabel={tc('cancel')}
        busy={revoke.isPending}
        onConfirm={() => revoking && revoke.mutate(revoking)}
        onClose={() => setRevoking(null)}
      />
    </Card>
  );
}
