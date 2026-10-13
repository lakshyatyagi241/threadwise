'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { Alert, Badge, Button, Spinner, cn } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useLscRuns, useScoreContact } from '../api/hooks';
import { formatCostUsd, formatCount } from '../lib/cost';
import { errorKey, requestIdOf, type ErrorKey } from '../lib/errors';
import { bandOf, isManualScore, type ScoreFields } from '../lib/score';
import { LinkButton, SparkleIcon, useFormatDate } from './parts';
import { RunsTable } from './runs-table';
import { ScoreBadge } from './score-badge';

const HISTORY_SIZE = 10;

export interface ScoreCardProps {
  contactId: string;
  contact: ScoreFields;
  /** Called after a successful score so the caller can refresh the contact everywhere it is shown. */
  onScored?: () => void | Promise<unknown>;
  className?: string;
}

/**
 * The lead score on a contact's page: the number and who set it, the reasons the AI gave, the Score with AI button (with the
 * cost of the last run), and the contact's scoring history. A score a person typed is theirs: the button is disabled and says
 * how to hand it back to the AI.
 */
export function ScoreCard({ contactId, contact, onScored, className }: ScoreCardProps) {
  const t = useTranslations('lead-scoring.card');
  const locale = useLocale();
  const fmt = useFormatDate();
  const canScore = useCan('lsc.contacts.score');
  const score = useScoreContact(contactId, onScored);
  const manualId = useId();
  const manual = isManualScore(contact);
  const ai = contact.leadScore !== null && contact.leadScoreSource === 'ai';
  const reasons = ai ? (contact.leadScoreReasons ?? []) : [];
  const result = score.isSuccess ? score.data : null;

  return (
    <section
      aria-labelledby={`${manualId}-title`}
      className={cn('rounded-md border border-border bg-background p-4', className)}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={`${manualId}-title`} className="text-xs font-medium text-muted-foreground">
            {t('title')}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span
              className="text-3xl font-semibold leading-none tabular-nums"
              data-testid="lsc-score"
            >
              {contact.leadScore ?? '—'}
            </span>
            {contact.leadScore !== null && (
              <>
                <ScoreBadge
                  score={contact.leadScore}
                  source={contact.leadScoreSource}
                  scoredAt={contact.leadScoredAt}
                />
                <span className="text-sm text-muted-foreground">
                  {t(`band.${bandOf(contact.leadScore)}`)}
                </span>
              </>
            )}
            {ai && (
              <Badge tone="neutral" className="gap-1">
                <SparkleIcon />
                {t('sourceAi')}
              </Badge>
            )}
            {manual && <Badge tone="neutral">{t('sourceManual')}</Badge>}
          </div>
        </div>
        {canScore && (
          <Button
            variant={contact.leadScore === null ? 'brand' : 'secondary'}
            disabled={manual || score.isPending}
            aria-describedby={manual ? `${manualId}-manual` : undefined}
            onClick={() => score.mutate()}
          >
            {score.isPending ? <Spinner /> : <SparkleIcon className="size-4" />}
            {score.isPending
              ? t('scoring')
              : contact.leadScore === null
                ? t('score')
                : t('rescore')}
          </Button>
        )}
      </div>

      <div className="mt-3 space-y-2 text-sm">
        {contact.leadScore === null && !score.isPending && (
          <p className="text-muted-foreground">{t('neverScored')}</p>
        )}
        {ai && (
          <p className="text-xs text-muted-foreground">
            {contact.leadScoredAt && contact.leadScoreModel
              ? t('scoredBy', { date: fmt(contact.leadScoredAt), model: contact.leadScoreModel })
              : contact.leadScoredAt
                ? t('scoredOn', { date: fmt(contact.leadScoredAt) })
                : t('scoredByAi')}
          </p>
        )}
        {ai && reasons.length > 0 && (
          <div>
            <h3 className="text-xs font-medium text-muted-foreground">{t('reasons')}</h3>
            <ul className="mt-1 list-disc space-y-0.5 ps-5">
              {reasons.map((r, i) => (
                <li key={`${i}-${r}`}>{r}</li>
              ))}
            </ul>
          </div>
        )}
        {manual && (
          <p id={`${manualId}-manual`} className="text-muted-foreground">
            {canScore ? t('manualWhy') : t('manualNote')}
          </p>
        )}
        <p aria-live="polite" className="sr-only">
          {score.isPending ? t('scoringSlow') : ''}
        </p>
        {score.isPending && (
          <p className="text-xs text-muted-foreground" aria-hidden="true">
            {t('scoringSlow')}
          </p>
        )}
        {result && (
          <p role="status" className="text-xs text-muted-foreground">
            {t('lastRun', {
              score: result.score,
              cost: formatCostUsd(result.costUsd, locale),
              tokens: formatCount(result.promptTokens + result.completionTokens, locale),
            })}
          </p>
        )}
        {score.isError && <ScoreError error={score.error} />}
      </div>

      <History contactId={contactId} />
    </section>
  );
}

/** One precise message per failure; the ones the person can fix come with the screen that fixes them. */
function ScoreError({ error }: { error: unknown }) {
  const t = useTranslations('lead-scoring.scoreErrors');
  const canSettings = useCan('lsc.runs.read');
  const canKeys = useCan('aiadm.keys.read');
  const key: ErrorKey = errorKey(error);
  const id = requestIdOf(error);
  const tc = useTranslations('lead-scoring.common');
  const tone =
    key === 'notEnabled' || key === 'manualScore' || key === 'noKey' ? 'warning' : 'danger';
  return (
    <Alert tone={tone} className="space-y-2">
      <p>{t(key)}</p>
      {key === 'notEnabled' && canSettings && (
        <LinkButton href="/lead-scoring">{t('openSettings')}</LinkButton>
      )}
      {key === 'noKey' && canKeys && <LinkButton href="/ai-keys">{t('openKeys')}</LinkButton>}
      {id && <p className="text-xs opacity-80">{tc('requestId', { id })}</p>}
    </Alert>
  );
}

/** The contact's own scoring log: when, the score change, what triggered it, tokens and cost. Needs `lsc.runs.read`. */
function History({ contactId }: { contactId: string }) {
  const t = useTranslations('lead-scoring.card');
  const canRead = useCan('lsc.runs.read');
  const [open, setOpen] = useState(false);
  const regionId = useId();
  const runs = useLscRuns({ contactId }, canRead && open, HISTORY_SIZE);
  if (!canRead) return null;
  return (
    <div className="mt-4 border-t border-border pt-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => setOpen((v) => !v)}
        className="text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary"
      >
        {open ? t('hideHistory') : t('showHistory')}
      </button>
      <div id={regionId} hidden={!open} className="mt-2">
        {open &&
          (runs.isPending ? (
            <p className="text-sm text-muted-foreground">{t('historyLoading')}</p>
          ) : runs.isError ? (
            <Alert tone="danger">{t('historyFailed')}</Alert>
          ) : runs.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('historyEmpty')}</p>
          ) : (
            <>
              <RunsTable runs={runs.items} compact caption={t('historyCaption')} />
              {runs.hasNextPage && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-2"
                  disabled={runs.isFetchingNextPage}
                  onClick={() => void runs.fetchNextPage()}
                >
                  {runs.isFetchingNextPage && <Spinner />}
                  {t('historyMore')}
                </Button>
              )}
            </>
          ))}
      </div>
    </div>
  );
}
