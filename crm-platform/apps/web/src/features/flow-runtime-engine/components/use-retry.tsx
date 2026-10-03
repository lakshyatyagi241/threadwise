'use client';

import { useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ConfirmDialog, useToast } from '@crm/ui';
import { FLR_ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { refreshAll, retryMany, retrySubscriber } from '../api/flow-runtime';
import { MAX_BATCH, clampBatch, retryManyTone, retryOneMessage } from '../lib/history-model';
import { useErrorText } from './parts';

/**
 * Retry one failed run or a batch of them, with Reference's confirmation and result messages (TW-FLR-057, 058). `ask` opens the
 * confirmation for the given subscriber ids (one id is the single retry); `dialog` must be rendered once by the caller.
 */
export function useRetryActions(onDone?: () => void): {
  ask: (ids: string[]) => void;
  dialog: ReactNode;
  busy: boolean;
} {
  const t = useTranslations('flr.retry');
  const errText = useErrorText();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [ids, setIds] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  const ask = (picked: string[]) => {
    if (picked.length === 0) {
      toast(t('selectFirst'), 'danger');
      return;
    }
    const batch = clampBatch(picked);
    if (batch.truncated) toast(t('onlyFirst', { n: MAX_BATCH }), 'info');
    setIds(batch.ids);
  };

  const run = async () => {
    if (!ids) return;
    setBusy(true);
    try {
      if (ids.length === 1) {
        const m = retryOneMessage(await retrySubscriber(ids[0]!));
        toast(
          m.key === 'failedAgain'
            ? m.reason
              ? t('failedAgain', { reason: m.reason })
              : t('failedAgainNoReason')
            : t(m.key),
          m.tone,
        );
      } else {
        const r = await retryMany(ids);
        toast(
          t('summary', {
            queued: r.queued,
            succeeded: r.succeeded,
            failed: r.failed,
            skipped: r.skipped,
          }),
          retryManyTone(r),
        );
      }
      onDone?.();
    } catch (e) {
      toast(
        e instanceof ApiError && e.code === FLR_ERROR_CODES.FLR_FLOW_INACTIVE
          ? t('flowInactive')
          : errText(e),
        'danger',
      );
    } finally {
      setBusy(false);
      setIds(null);
      // A retry rewrites run status, retry counters and the retry log, so every table is refetched rather than patched.
      void refreshAll(qc);
    }
  };

  const many = (ids?.length ?? 0) > 1;
  const dialog = (
    <ConfirmDialog
      open={ids !== null}
      title={many ? t('manyTitle', { n: ids?.length ?? 0 }) : t('oneTitle')}
      message={many ? t('manyBody', { n: ids?.length ?? 0 }) : t('oneBody')}
      confirmLabel={t('confirm')}
      cancelLabel={t('cancel')}
      busy={busy}
      onConfirm={() => void run()}
      onClose={() => setIds(null)}
    />
  );
  return { ask, dialog, busy };
}
