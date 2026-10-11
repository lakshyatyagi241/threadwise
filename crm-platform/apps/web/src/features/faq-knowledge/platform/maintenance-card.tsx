'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Card, ConfirmDialog } from '@crm/ui';
import type { FaqPlatformOverview, FaqPlatformReindexInput } from '@crm/contracts';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { errorKind, progressPercent } from './logic';
import { OVERVIEW_KEY, reindexSchema } from './queries';

const NS = 'faq-knowledge-admin.maintenance';

/** Re-index buttons and the live progress of the queue (the page re-reads the overview while anything waits). */
export function MaintenanceCard({ stats }: { stats: FaqPlatformOverview['stats'] }) {
  const t = useTranslations(NS);
  const tc = useTranslations('faq-knowledge-admin.common');
  const toast = useToast();
  const qc = useQueryClient();
  const [asking, setAsking] = useState<FaqPlatformReindexInput['scope'] | null>(null);

  // `isPending` only turns true after the next render, so a fast double click would queue twice; the ref closes that window.
  const sending = useRef(false);

  const reindex = useMutation({
    mutationFn: (scope: FaqPlatformReindexInput['scope']) =>
      operatorFetch('/faq/reindex', { method: 'POST', body: { scope }, schema: reindexSchema }),
    onSuccess: ({ queued }) => {
      setAsking(null);
      toast.success(t('queued', { count: queued }));
      return qc.invalidateQueries({ queryKey: OVERVIEW_KEY });
    },
    onError: (err) => {
      setAsking(null);
      toast.error(tc(`errors.${errorKind(err)}`));
    },
    onSettled: () => {
      sending.current = false;
    },
  });

  const send = (scope: FaqPlatformReindexInput['scope']) => {
    if (sending.current) return;
    sending.current = true;
    reindex.mutate(scope);
  };

  const percent = progressPercent(stats);
  const total = stats.ready + stats.pending;
  const copy = asking === 'failed' ? 'confirmFailed' : 'confirmAll';

  return (
    <Card className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{t('title')}</h2>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>

      <div className="space-y-1.5">
        {percent !== null && (
          <>
            <div
              role="progressbar"
              aria-label={t('progressLabel')}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              className="h-2 overflow-hidden rounded-full bg-muted"
            >
              <div
                className="h-full bg-primary transition-[width] duration-500 motion-reduce:transition-none"
                style={{ width: `${percent}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground tabular-nums">
              {t('progress', { ready: stats.ready, total })}
            </p>
          </>
        )}
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {stats.pending > 0 ? t('polling', { count: stats.pending }) : t('idle')}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" disabled={reindex.isPending} onClick={() => setAsking('all')}>
          {t('reindexAll')}
        </Button>
        <Button
          variant="secondary"
          disabled={reindex.isPending || stats.failed === 0}
          onClick={() => setAsking('failed')}
        >
          {t('retryFailed')}
        </Button>
        {stats.failed === 0 && (
          <span className="text-xs text-muted-foreground">{t('retryFailedNone')}</span>
        )}
      </div>

      <ConfirmDialog
        open={asking !== null}
        title={t(`${copy}.title`)}
        message={t(`${copy}.message`)}
        confirmLabel={t(`${copy}.confirm`)}
        cancelLabel={tc('cancel')}
        busy={reindex.isPending}
        onConfirm={() => asking && send(asking)}
        onClose={() => setAsking(null)}
      />
    </Card>
  );
}
