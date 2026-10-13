'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Alert, Badge, Button, Spinner, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useDecideSuggestions, useLscSuggestions } from '../api/hooks';
import { errorKey } from '../lib/errors';
import { BULK_ACCEPT_PERCENT, bulkAcceptable, confidencePercent } from '../lib/suggestions-model';
import { LoadError, SectionCard, SkeletonRows, useFormatDate } from './parts';

/**
 * The stage moves the AI suggests after reading conversations, all in one place: accept or dismiss each, or take every confident one
 * at once. Nothing changes until a person accepts, and an accepted move goes through the ordinary contact edit.
 */
export function SuggestionsPanel({
  onContactsChanged,
}: {
  onContactsChanged?: () => void | Promise<unknown>;
}) {
  const t = useTranslations('lead-scoring.suggestions');
  const { toast } = useToast();
  const qc = useQueryClient();
  const fmt = useFormatDate();
  const canReview = useCan('lsc.stage.review');
  const list = useLscSuggestions(true);
  const decide = useDecideSuggestions(async () => {
    await onContactsChanged?.();
    await qc.invalidateQueries({ queryKey: ['lead-scoring', 'suggestions'] });
  });

  const run = (action: 'accept' | 'dismiss', ids: string[]) =>
    decide.mutate(
      { action, ids },
      {
        onSuccess: (res) => {
          if (res.done > 0)
            toast(
              action === 'accept'
                ? t('doneAccept', { count: res.done })
                : t('doneDismiss', { count: res.done }),
              'success',
            );
        },
      },
    );
  const confident = bulkAcceptable(list.items);

  return (
    <SectionCard id="lsc-suggestions" title={t('title')} hint={t('hint')}>
      {list.isPending && <SkeletonRows rows={3} />}
      {list.isError && (
        <LoadError
          errorKey={errorKey(list.error)}
          error={list.error}
          onRetry={() => void list.refetch()}
        />
      )}
      {list.isSuccess && list.items.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      )}
      {list.items.length > 0 && (
        <>
          {canReview && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="brand"
                size="sm"
                disabled={confident.length === 0 || decide.isPending}
                onClick={() =>
                  run(
                    'accept',
                    confident.map((s) => s.id),
                  )
                }
              >
                {decide.isPending && <Spinner />}
                {t('acceptConfident', { percent: BULK_ACCEPT_PERCENT, count: confident.length })}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={decide.isPending}
                onClick={() =>
                  run(
                    'dismiss',
                    list.items.map((s) => s.id),
                  )
                }
              >
                {t('dismissAll')}
              </Button>
            </div>
          )}
          <ul
            className="divide-y divide-border rounded-md border border-border"
            aria-label={t('title')}
          >
            {list.items.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="font-medium">{s.contactName ?? t('unnamed')}</p>
                  <p className="text-muted-foreground">
                    {t('move', { from: s.fromStageLabel, to: s.toStageLabel })}
                  </p>
                  {s.reasons[0] && <p className="text-xs text-muted-foreground">{s.reasons[0]}</p>}
                  <p className="text-xs text-muted-foreground">{fmt(s.createdAt)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    tone={
                      confidencePercent(s.confidence) >= BULK_ACCEPT_PERCENT ? 'success' : 'neutral'
                    }
                  >
                    {t('confidence', { percent: confidencePercent(s.confidence) })}
                  </Badge>
                  {canReview && (
                    <>
                      <Button
                        size="sm"
                        variant="brand"
                        disabled={decide.isPending}
                        onClick={() => run('accept', [s.id])}
                      >
                        {t('accept')}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={decide.isPending}
                        onClick={() => run('dismiss', [s.id])}
                      >
                        {t('dismiss')}
                      </Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {list.hasNextPage && (
            <Button
              size="sm"
              variant="secondary"
              disabled={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              {list.isFetchingNextPage && <Spinner />}
              {t('more')}
            </Button>
          )}
          {!canReview && <p className="text-xs text-muted-foreground">{t('noRight')}</p>}
        </>
      )}
      {decide.isError && <LoadError errorKey={errorKey(decide.error)} error={decide.error} />}
      {decide.isSuccess && decide.data.failed.length > 0 && (
        <Alert tone="warning">{t('couldNot', { count: decide.data.failed.length })}</Alert>
      )}
    </SectionCard>
  );
}
