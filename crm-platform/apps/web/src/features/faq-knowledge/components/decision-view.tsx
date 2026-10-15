'use client';

import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { FaqCandidate, FaqMatchDecision } from '@crm/contracts';
import { Badge, Button, Spinner, cn, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { refreshFaqs, useFaqEntry } from '../api/hooks';
import { faqApi } from '../api/service';
import { marginOf, pct, scoreBar, tierKey, verdictTone, verdictWithCheck } from '../lib/decision';
import { errorKey } from '../lib/errors';
import { useFaqFlow } from './faq-flow';
import { CheckIcon, FlowIcon } from './icons';
import { CARD, ScoreBar } from './parts';
import { VerifyDetail } from './verify-parts';

/**
 * One matching decision in plain terms: what would happen, the score against the bar it had to reach, which tier decided and why,
 * the best five candidates and the numbers behind them. Used by the playground and the editor's "Try it" box.
 */
export function DecisionView({
  decision,
  query,
  compact,
}: {
  decision: FaqMatchDecision;
  query: string;
  /** The editor's box: no "add as variation" actions. */
  compact?: boolean;
}) {
  const t = useTranslations('faq.decision');
  const verdict = verdictWithCheck(decision);
  const tone = verdictTone(verdict);
  const bar = scoreBar(decision.score, decision.threshold);
  const margin = marginOf(decision);
  const needsMargin = decision.score !== null && decision.secondScore !== null;

  return (
    <div className="space-y-4" aria-live="polite">
      <div className={cn(CARD, 'space-y-4 p-4')}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={tone} className="gap-1 text-sm">
            {verdict === 'answer' && <CheckIcon className="size-3.5" />}
            {t(`verdict.${verdict}.title`)}
          </Badge>
          {decision.tier && <Badge>{t(`tier.${tierKey(decision.tier)}.name`)}</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">{t(`verdict.${verdict}.body`)}</p>

        {decision.score !== null && (
          <div className="space-y-2">
            <ScoreBar
              fillPct={bar.fillPct}
              markerPct={bar.markerPct}
              reached={bar.reached}
              label={t('scoreLabel', {
                score: pct(decision.score),
                threshold: pct(decision.threshold),
              })}
            />
            <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
              <div>
                <dt className="inline">{t('score')}: </dt>
                <dd className="inline font-semibold tabular-nums text-foreground">
                  {pct(decision.score)}%
                </dd>
              </div>
              <div>
                <dt className="inline">{t('threshold')}: </dt>
                <dd className="inline font-semibold tabular-nums text-foreground">
                  {pct(decision.threshold)}%
                </dd>
              </div>
              {needsMargin && margin !== null && (
                <div>
                  <dt className="inline">{t('margin')}: </dt>
                  <dd className="inline font-semibold tabular-nums text-foreground">
                    {t('marginValue', {
                      margin: Math.round(margin * 100),
                      needed: Math.round(decision.minMargin * 100),
                    })}
                  </dd>
                </div>
              )}
            </dl>
          </div>
        )}

        {decision.verify && <VerifyDetail verify={decision.verify} />}

        {decision.tier && (
          <p className="rounded-md bg-muted/60 p-3 text-sm">
            <span className="font-medium">{t(`tier.${tierKey(decision.tier)}.name`)}. </span>
            {t(`tier.${tierKey(decision.tier)}.body`)}
          </p>
        )}
        {decision.note && (
          <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
            <span className="font-medium">{t('note')}: </span>
            {decision.note}
          </p>
        )}

        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
          <div>
            <dt className="inline">{t('model')}: </dt>
            <dd className="inline font-mono text-foreground">
              {decision.embeddingModel ?? t('noModel')}
            </dd>
          </div>
          <div>
            <dt className="inline">{t('latency')}: </dt>
            <dd className="inline tabular-nums text-foreground">
              {t('ms', { ms: decision.latencyMs })}
            </dd>
          </div>
        </dl>
      </div>

      {decision.faqId && verdict === 'answer' && <Winner faqId={decision.faqId} />}

      {decision.candidates.length > 0 && (
        <section className={cn(CARD, 'overflow-hidden')} aria-label={t('candidates.title')}>
          <h3 className="border-b border-border bg-muted/40 px-4 py-2.5 text-sm font-semibold">
            {t('candidates.title')}
          </h3>
          <ol className="divide-y divide-border">
            {decision.candidates.slice(0, 5).map((c, i) => (
              <CandidateRow
                key={c.faqId}
                candidate={c}
                rank={i + 1}
                winner={c.faqId === decision.faqId}
                threshold={decision.threshold}
                query={query}
                allowAdd={!compact}
              />
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

/** The answer that would be sent (text) or the flow that would start. */
function Winner({ faqId }: { faqId: string }) {
  const t = useTranslations('faq.decision.winner');
  const q = useFaqEntry(faqId);
  const { href } = useFaqFlow();
  const e = q.data;
  return (
    <section className={cn(CARD, 'space-y-2 border-success/40 p-4')} aria-label={t('title')}>
      <h3 className="text-sm font-semibold">{t('title')}</h3>
      {q.isPending ? (
        <div aria-hidden="true" className="h-12 animate-pulse rounded-md bg-muted" />
      ) : !e ? (
        <p className="text-sm text-muted-foreground">{t('unavailable')}</p>
      ) : (
        <>
          <p className="font-medium">
            <Link href={href({ faqId: e.id })} className="underline-offset-2 hover:underline">
              {e.question}
            </Link>
          </p>
          {e.answerType === 'text' ? (
            <p className="max-w-prose whitespace-pre-wrap rounded-2xl rounded-ss-sm bg-success/10 p-3 text-sm">
              {e.answerText}
            </p>
          ) : (
            <p className="flex items-center gap-2 text-sm">
              <FlowIcon />
              {e.flowName ? t('flow', { name: e.flowName }) : t('flowMissing')}
            </p>
          )}
        </>
      )}
    </section>
  );
}

function CandidateRow({
  candidate,
  rank,
  winner,
  threshold,
  query,
  allowAdd,
}: {
  candidate: FaqCandidate;
  rank: number;
  winner: boolean;
  threshold: number;
  query: string;
  allowAdd: boolean;
}) {
  const t = useTranslations('faq.decision.candidates');
  const te = useTranslations('faq.errors');
  const { toast } = useToast();
  const qc = useQueryClient();
  const canCreate = useCan('faq.entries.create');
  const { flowId, href } = useFaqFlow();
  const [added, setAdded] = useState(false);
  const bar = scoreBar(candidate.score, threshold);
  const add = useMutation({
    mutationFn: () =>
      faqApi.addVariations(flowId, candidate.faqId, { texts: [query], source: 'manual' }),
    onSuccess: (created) => {
      setAdded(true);
      void refreshFaqs(qc);
      toast(
        created.length > 0 ? t('addedToast', { question: candidate.question }) : t('alreadyThere'),
      );
    },
    onError: (e) => toast(te(errorKey(e)), 'danger'),
  });

  return (
    <li className="space-y-2 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">
            <span className="me-2 text-muted-foreground tabular-nums">{rank}.</span>
            {candidate.question}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('matchedOn')} <q>{candidate.matchedText}</q>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {winner && <Badge tone="success">{t('best')}</Badge>}
          {candidate.status === 'paused' && <Badge tone="warning">{t('paused')}</Badge>}
          <span className="text-sm font-semibold tabular-nums">{pct(candidate.score)}%</span>
        </div>
      </div>
      <ScoreBar
        fillPct={bar.fillPct}
        markerPct={bar.markerPct}
        reached={bar.reached}
        label={t('scoreLabel', { score: pct(candidate.score) })}
      />
      <div className="flex flex-wrap gap-2">
        {allowAdd && canCreate && (
          <Button
            size="sm"
            variant="secondary"
            disabled={add.isPending || added}
            onClick={() => add.mutate()}
          >
            {add.isPending && <Spinner />}
            {added ? t('added') : t('addVariation', { question: candidate.question })}
          </Button>
        )}
        <Link
          href={href({ faqId: candidate.faqId })}
          className="inline-flex h-8 items-center rounded-md border border-border px-3 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
        >
          {t('open')}
        </Link>
      </div>
    </li>
  );
}
