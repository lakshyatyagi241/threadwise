'use client';

import { useTranslations } from 'next-intl';
import type { GrowthFeatures } from '@crm/contracts';
import { Button, Spinner, StatTile, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import {
  useEnrichment,
  usePropensity,
  useQuality,
  useRecomputePropensity,
  useRunEnrichment,
  useSendTimes,
} from '../api/hooks';
import { errorKey } from '../lib/errors';
import {
  LoadError,
  SectionCard,
  SkeletonRows,
  useFormatDate,
  useFormatHour,
  useFormatNumber,
} from './parts';

/** The measurements: when contacts are reachable, how well the conversion model does, whether the AI's suggestions are being used. */
export function InsightsTab({ features }: { features: GrowthFeatures }) {
  return (
    <div className="space-y-4">
      {features.send_times && <SendTimesCard />}
      {features.propensity && <PropensityCard />}
      {features.quality && <QualityCard />}
      {features.enrichment && <EnrichmentCard />}
    </div>
  );
}

function SendTimesCard() {
  const t = useTranslations('growth.insights.sendTimes');
  const hour = useFormatHour();
  const num = useFormatNumber();
  const q = useSendTimes(true);
  return (
    <SectionCard id="growth-send-times" title={t('title')} hint={t('hint')}>
      {q.isPending && <SkeletonRows rows={2} />}
      {q.isError && (
        <LoadError errorKey={errorKey(q.error)} error={q.error} onRetry={() => void q.refetch()} />
      )}
      {q.isSuccess &&
        (q.data.bestHours.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <>
            <p className="text-sm">
              {t('best', { hours: q.data.bestHours.map(hour).join(', '), zone: q.data.timezone })}
            </p>
            {q.data.quietHours.length > 0 && (
              <p className="text-sm text-muted-foreground">
                {t('quiet', { hours: q.data.quietHours.map(hour).join(', ') })}
              </p>
            )}
            <Histogram
              label={t('chart')}
              values={q.data.inboundByHour.map((n, h) => n + (q.data.readByHour[h] ?? 0))}
              best={q.data.bestHours}
              hour={hour}
            />
            <p className="text-xs text-muted-foreground">
              {t('sample', { count: num.count(q.data.sampleSize) })}
            </p>
          </>
        ))}
    </SectionCard>
  );
}

/** 24 bars, one per hour; the best hours are filled in the brand colour. A table-free chart, so it carries a text label per bar. */
function Histogram({
  label,
  values,
  best,
  hour,
}: {
  label: string;
  values: number[];
  best: number[];
  hour: (h: number) => string;
}) {
  const max = Math.max(1, ...values);
  return (
    <div role="img" aria-label={label} className="flex h-28 items-end gap-0.5">
      {values.map((v, h) => (
        <div key={h} className="flex h-full flex-1 flex-col justify-end" title={`${hour(h)}: ${v}`}>
          <div
            className={best.includes(h) ? 'rounded-t bg-brand' : 'rounded-t bg-muted-foreground/30'}
            style={{ height: `${Math.max(2, Math.round((v / max) * 100))}%` }}
          />
        </div>
      ))}
    </div>
  );
}

function PropensityCard() {
  const t = useTranslations('growth.insights.propensity');
  const { toast } = useToast();
  const fmt = useFormatDate();
  const num = useFormatNumber();
  const canRun = useCan('lsc.contacts.score');
  const q = usePropensity(true);
  const recompute = useRecomputePropensity();
  return (
    <SectionCard
      id="growth-propensity"
      title={t('title')}
      hint={t('hint')}
      aside={
        canRun && (
          <Button
            size="sm"
            variant="secondary"
            disabled={recompute.isPending}
            onClick={() =>
              recompute.mutate(undefined, {
                onSuccess: () => toast(t('done'), 'success'),
                onError: () => toast(t('failed'), 'danger'),
              })
            }
          >
            {recompute.isPending && <Spinner />}
            {t('recompute')}
          </Button>
        )
      }
    >
      {q.isPending && <SkeletonRows rows={2} />}
      {q.isError && (
        <LoadError errorKey={errorKey(q.error)} error={q.error} onRetry={() => void q.refetch()} />
      )}
      {q.isSuccess && (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <StatTile label={t('contacts')} value={num.count(q.data.contacts)} />
            <StatTile label={t('converted')} value={num.count(q.data.positives)} />
            <StatTile
              label={t('auc')}
              value={q.data.auc === null ? t('none') : num.decimal(q.data.auc)}
              tone="accent"
            />
            <StatTile
              label={t('capture')}
              value={
                q.data.topDecileCapture === null ? t('none') : num.percent(q.data.topDecileCapture)
              }
              hint={t('captureHint')}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            {q.data.trained ? t('trained') : t('notTrained')}
            {q.data.computedAt && ` ${t('computedAt', { when: fmt(q.data.computedAt) })}`}
          </p>
          {q.data.weights.length > 0 && (
            <div>
              <h3 className="text-sm font-medium">{t('drivers')}</h3>
              <ul className="mt-1 space-y-1 text-sm">
                {q.data.weights.map((w) => (
                  <li key={w.feature} className="flex justify-between gap-3">
                    <span>{t(`features.${w.feature}` as 'features.chat_messages_total')}</span>
                    <span className="text-muted-foreground">{num.decimal(w.weight)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </SectionCard>
  );
}

function QualityCard() {
  const t = useTranslations('growth.insights.quality');
  const num = useFormatNumber();
  const q = useQuality(true);
  return (
    <SectionCard id="growth-quality" title={t('title')} hint={t('hint')}>
      {q.isPending && <SkeletonRows rows={3} />}
      {q.isError && (
        <LoadError errorKey={errorKey(q.error)} error={q.error} onRetry={() => void q.refetch()} />
      )}
      {q.isSuccess && (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <StatTile
              label={t('scoreAuc')}
              value={q.data.scoreAuc === null ? t('none') : num.decimal(q.data.scoreAuc)}
              hint={t('scoreAucHint', {
                scored: num.count(q.data.scoredContacts),
                converted: num.count(q.data.convertedContacts),
              })}
            />
            <StatTile label={t('calls')} value={num.count(q.data.cost.calls)} />
            <StatTile label={t('cost')} value={`$${q.data.cost.costUsd}`} />
            <StatTile
              label={t('autoApplied')}
              value={num.count(q.data.suggestions.autoApplied)}
              hint={t('undone', { count: q.data.suggestions.undone })}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {(['chat', 'engagement'] as const).map((k) => {
              const s = q.data.suggestions[k];
              return (
                <div key={k} className="text-sm">
                  <h3 className="font-medium">{t(`suggestions.${k}`)}</h3>
                  <p className="text-muted-foreground">
                    {t('suggestionLine', {
                      accepted: s.accepted,
                      dismissed: s.dismissed,
                      pending: s.pending,
                    })}
                  </p>
                </div>
              );
            })}
          </div>
          {q.data.actions.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="py-2 pe-3 text-start font-medium">{t('cols.type')}</th>
                    <th className="px-3 py-2 text-end font-medium">{t('cols.done')}</th>
                    <th className="px-3 py-2 text-end font-medium">{t('cols.dismissed')}</th>
                    <th className="ps-3 py-2 text-end font-medium">{t('cols.open')}</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.actions.map((a) => (
                    <tr key={a.type} className="border-b border-border last:border-0">
                      <td className="py-2 pe-3">{t(`actionTypes.${a.type}`)}</td>
                      <td className="px-3 py-2 text-end">{num.count(a.done)}</td>
                      <td className="px-3 py-2 text-end">{num.count(a.dismissed)}</td>
                      <td className="ps-3 py-2 text-end">{num.count(a.open)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </SectionCard>
  );
}

function EnrichmentCard() {
  const t = useTranslations('growth.insights.enrichment');
  const { toast } = useToast();
  const num = useFormatNumber();
  const canRun = useCan('lsc.contacts.score');
  const q = useEnrichment(true);
  const run = useRunEnrichment();
  return (
    <SectionCard
      id="growth-enrichment"
      title={t('title')}
      hint={t('hint')}
      aside={
        canRun &&
        q.data?.configured && (
          <Button
            size="sm"
            variant="secondary"
            disabled={run.isPending}
            onClick={() =>
              run.mutate(undefined, {
                onSuccess: (r) => toast(t('asked', { count: r.asked }), 'success'),
                onError: () => toast(t('failed'), 'danger'),
              })
            }
          >
            {run.isPending && <Spinner />}
            {t('run')}
          </Button>
        )
      }
    >
      {q.isPending && <SkeletonRows rows={1} />}
      {q.isError && (
        <LoadError errorKey={errorKey(q.error)} error={q.error} onRetry={() => void q.refetch()} />
      )}
      {q.isSuccess &&
        (q.data.configured ? (
          <p className="text-sm">
            {t('status', {
              provider: q.data.provider ?? '',
              found: num.count(q.data.found),
              notFound: num.count(q.data.notFound),
              failed: num.count(q.data.failed),
            })}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">{t('notConfigured')}</p>
        ))}
    </SectionCard>
  );
}
