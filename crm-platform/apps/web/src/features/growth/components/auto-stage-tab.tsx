'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Badge, Button, Spinner, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useAutoStage, useUndoAutoStage } from '../api/hooks';
import { errorKey } from '../lib/errors';
import {
  LoadError,
  Nothing,
  SectionCard,
  SkeletonRows,
  useFormatDate,
  useFormatNumber,
} from './parts';

/**
 * The stage changes the pilot made on its own (only readings it was very sure of, up to a daily cap). Each one can be put back as long
 * as nobody moved the contact since.
 */
export function AutoStageTab() {
  const t = useTranslations('growth.autoStage');
  const { toast } = useToast();
  const fmt = useFormatDate();
  const num = useFormatNumber();
  const canReview = useCan('lsc.stage.review');
  const q = useAutoStage(true);
  const undo = useUndoAutoStage();

  return (
    <SectionCard id="growth-auto-stage" title={t('title')} hint={t('hint')}>
      {q.isPending && <SkeletonRows rows={3} />}
      {q.isError && (
        <LoadError errorKey={errorKey(q.error)} error={q.error} onRetry={() => void q.refetch()} />
      )}
      {q.isSuccess && (
        <>
          <p className="text-sm text-muted-foreground">
            {t('today', { done: num.count(q.data.appliedToday), cap: num.count(q.data.dailyCap) })}
          </p>
          {q.data.data.length === 0 && <Nothing>{t('empty')}</Nothing>}
          <ul className="divide-y divide-border">
            {q.data.data.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0 text-sm">
                  <Link
                    href={`/contacts/${r.contactId}`}
                    className="font-medium text-primary underline"
                  >
                    {r.contactName ?? t('contact')}
                  </Link>
                  <p>
                    {t('moved', { from: r.fromStageLabel, to: r.toStageLabel })}{' '}
                    <span className="text-muted-foreground">
                      {t('confidence', { percent: Math.round(r.confidence * 100) })} ·{' '}
                      {fmt(r.appliedAt)}
                    </span>
                  </p>
                </div>
                {r.status === 'undone' ? (
                  <Badge>{t('undone')}</Badge>
                ) : (
                  canReview && (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={undo.isPending}
                      onClick={() =>
                        undo.mutate(r.id, {
                          onSuccess: () => toast(t('undoDone'), 'success'),
                          onError: (e) =>
                            toast(
                              t(errorKey(e) === 'undoRefused' ? 'undoRefused' : 'undoFailed'),
                              'danger',
                            ),
                        })
                      }
                    >
                      {undo.isPending && undo.variables === r.id && <Spinner />}
                      {t('undo')}
                    </Button>
                  )
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </SectionCard>
  );
}
