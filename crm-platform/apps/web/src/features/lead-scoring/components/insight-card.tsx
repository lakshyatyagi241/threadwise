'use client';

import { useTranslations } from 'next-intl';
import { useId } from 'react';
import type { LscDigest, LscInsight, LscSuggestion } from '@crm/contracts';
import { Alert, Badge, Button, Spinner, cn, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useDecideSuggestions, useDigestContact, useLscInsight } from '../api/hooks';
import { errorKey, requestIdOf } from '../lib/errors';
import { confidencePercent } from '../lib/suggestions-model';
import { LinkButton, SparkleIcon, useFormatDate } from './parts';

export interface ChatInsightCardProps {
  contactId: string;
  /** Called after the chat was read or a stage was accepted, so the caller can refresh the contact everywhere it is shown. */
  onChanged?: () => void | Promise<unknown>;
  className?: string;
}

/**
 * What AI lead scoring made of the contact's conversation: the intent, a few signals, a short summary, and the stage move it would
 * suggest, for a person to accept or dismiss. Shows nothing at all until the workspace has the chat reading on (it is a pilot), so
 * the contact page of every other workspace is unchanged.
 */
export function ChatInsightCard({ contactId, onChanged, className }: ChatInsightCardProps) {
  const canRead = useCan('lsc.runs.read');
  const q = useLscInsight(contactId, canRead);
  if (!q.data?.active) return null;
  return (
    <InsightBody
      contactId={contactId}
      insight={q.data}
      onChanged={onChanged}
      className={className}
    />
  );
}

function InsightBody({
  contactId,
  insight,
  onChanged,
  className,
}: {
  contactId: string;
  insight: LscInsight;
  onChanged?: () => void | Promise<unknown>;
  className?: string;
}) {
  const t = useTranslations('lead-scoring.insight');
  const canScore = useCan('lsc.contacts.score');
  const read = useDigestContact(contactId, onChanged);
  const titleId = useId();
  const { digest, suggestion } = insight;

  return (
    <section
      aria-labelledby={titleId}
      className={cn('rounded-md border border-border bg-background p-4', className)}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={titleId} className="text-xs font-medium text-muted-foreground">
            {t('title')}
          </h2>
          {digest ? (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="text-lg font-semibold" data-testid="lsc-intent">
                {t(`intent.${digest.intent}`)}
              </span>
              <Badge tone="neutral" className="gap-1">
                {digest.source === 'ai' && <SparkleIcon />}
                {digest.source === 'ai' ? t('sourceAi') : t('sourceRules')}
              </Badge>
            </div>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">{t('empty')}</p>
          )}
        </div>
        {canScore && (
          <Button variant="secondary" disabled={read.isPending} onClick={() => read.mutate()}>
            {read.isPending ? <Spinner /> : <SparkleIcon className="size-4" />}
            {read.isPending ? t('analyzing') : t('analyze')}
          </Button>
        )}
      </div>

      {digest && <DigestDetails digest={digest} />}
      {suggestion && <SuggestionBox suggestion={suggestion} onChanged={onChanged} />}

      <div className="mt-3 space-y-2 text-xs text-muted-foreground">
        <p aria-live="polite" className="sr-only">
          {read.isPending ? t('analyzingSlow') : ''}
        </p>
        {read.isPending && <p aria-hidden="true">{t('analyzingSlow')}</p>}
        <p>{t('privacy')}</p>
      </div>
      {read.isError && <ReadError error={read.error} />}
    </section>
  );
}

const SIGNALS = ['askedPrice', 'readyToBuy', 'objection', 'urgent'] as const;

function DigestDetails({ digest }: { digest: LscDigest }) {
  const t = useTranslations('lead-scoring.insight');
  const fmt = useFormatDate();
  const on = SIGNALS.filter((k) => digest.signals[k]);
  return (
    <div className="mt-3 space-y-2 text-sm">
      {on.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={t('signals')}>
          {on.map((k) => (
            <li key={k}>
              <Badge tone={k === 'objection' ? 'warning' : 'neutral'}>{t(`signal.${k}`)}</Badge>
            </li>
          ))}
        </ul>
      )}
      {digest.summary && <p>{digest.summary}</p>}
      <p className="text-xs text-muted-foreground">
        {t('readOn', { date: fmt(digest.createdAt), count: digest.messagesRead })}
      </p>
    </div>
  );
}

function SuggestionBox({
  suggestion,
  onChanged,
}: {
  suggestion: LscSuggestion;
  onChanged?: () => void | Promise<unknown>;
}) {
  const t = useTranslations('lead-scoring.insight.suggestion');
  const { toast } = useToast();
  const canReview = useCan('lsc.stage.review');
  const decide = useDecideSuggestions(onChanged);
  const run = (action: 'accept' | 'dismiss') =>
    decide.mutate(
      { action, ids: [suggestion.id] },
      {
        onSuccess: (res) => {
          if (res.done > 0) {
            toast(
              action === 'accept'
                ? t('accepted', { stage: suggestion.toStageLabel })
                : t('dismissed'),
              'success',
            );
          }
        },
      },
    );
  return (
    <div
      className="mt-4 rounded-md border border-border bg-muted/40 p-3 text-sm"
      role="group"
      aria-label={t('title')}
    >
      <h3 className="text-xs font-medium text-muted-foreground">{t('title')}</h3>
      <p className="mt-1 font-medium">
        {t('move', { from: suggestion.fromStageLabel, to: suggestion.toStageLabel })}
        <span className="ms-2 text-xs font-normal text-muted-foreground">
          {t('confidence', { percent: confidencePercent(suggestion.confidence) })}
        </span>
      </p>
      {suggestion.reasons.length > 0 && (
        <ul className="mt-1 list-disc space-y-0.5 ps-5 text-muted-foreground">
          {suggestion.reasons.map((r, i) => (
            <li key={`${i}-${r}`}>{r}</li>
          ))}
        </ul>
      )}
      {canReview ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="brand"
            size="sm"
            disabled={decide.isPending}
            onClick={() => run('accept')}
          >
            {decide.isPending && <Spinner />}
            {t('accept')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={decide.isPending}
            onClick={() => run('dismiss')}
          >
            {t('dismiss')}
          </Button>
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">{t('noRight')}</p>
      )}
      {decide.isError && <ReadError error={decide.error} />}
      {decide.isSuccess && decide.data.failed.length > 0 && (
        <Alert tone="warning" className="mt-2">
          {t('couldNot')}
        </Alert>
      )}
    </div>
  );
}

function ReadError({ error }: { error: unknown }) {
  const t = useTranslations('lead-scoring.scoreErrors');
  const tc = useTranslations('lead-scoring.common');
  const canSettings = useCan('lsc.runs.read');
  const canKeys = useCan('aiadm.keys.read');
  const key = errorKey(error);
  const id = requestIdOf(error);
  const tone =
    key === 'notEnabled' || key === 'noKey' || key === 'notEnoughChat' || key === 'suggestionGone'
      ? 'warning'
      : 'danger';
  return (
    <Alert tone={tone} className="mt-3 space-y-2">
      <p>{t(key)}</p>
      {key === 'notEnabled' && canSettings && (
        <LinkButton href="/lead-scoring">{t('openSettings')}</LinkButton>
      )}
      {key === 'noKey' && canKeys && <LinkButton href="/ai-keys">{t('openKeys')}</LinkButton>}
      {id && <p className="text-xs opacity-80">{tc('requestId', { id })}</p>}
    </Alert>
  );
}
