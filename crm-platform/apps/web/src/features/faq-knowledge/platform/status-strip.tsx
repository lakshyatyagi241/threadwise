'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { Alert, Badge, Card } from '@crm/ui';
import type { FaqPlatformOverview } from '@crm/contracts';
import { answerRate } from './logic';

const NS = 'faq-knowledge-admin.status';
/** The platform's AI provider keys page (the old /admin/ai-keys address redirects here). */
export const AI_KEYS_HREF = '/admin/api-keys';

function StatusCard({
  title,
  badge,
  children,
}: {
  title: string;
  badge?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Card className="space-y-2" role="group" aria-label={title}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-medium text-muted-foreground">{title}</h2>
        {badge}
      </div>
      {children}
    </Card>
  );
}

/** The header strip: is the engine on, can it reach OpenRouter, which model, is the index healthy, what happened in 30 days. */
export function StatusStrip({ overview }: { overview: FaqPlatformOverview }) {
  const t = useTranslations(NS);
  const format = useFormatter();
  const { config, stats, platformKeyReady } = overview;
  const model = config.allowedModels.find((m) => m.id === config.embeddingModel);
  const rate = answerRate(stats.answered30d, stats.matches30d);
  const n = (v: number) => format.number(v);

  return (
    <section aria-label={t('label')} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <StatusCard
        title={t('engine.title')}
        badge={
          <Badge tone={config.engineEnabled ? 'success' : 'danger'}>
            {config.engineEnabled ? t('engine.on') : t('engine.off')}
          </Badge>
        }
      >
        <p className="text-sm text-muted-foreground">
          {config.engineEnabled
            ? t('engine.hintOn', { count: stats.workspacesEnabled })
            : t('engine.hintOff')}
        </p>
      </StatusCard>

      <StatusCard
        title={t('key.title')}
        badge={
          <Badge tone={platformKeyReady ? 'success' : 'warning'}>
            {platformKeyReady ? t('key.ready') : t('key.missing')}
          </Badge>
        }
      >
        <p className="text-sm text-muted-foreground">
          {platformKeyReady ? t('key.explainReady') : t('key.explainMissing')}
        </p>
        {!platformKeyReady && (
          <Link
            href={AI_KEYS_HREF}
            className="inline-block text-sm font-medium text-primary underline underline-offset-2"
          >
            {t('key.link')}
          </Link>
        )}
      </StatusCard>

      <StatusCard title={t('model.title')}>
        <p className="font-semibold">{model?.label ?? config.embeddingModel}</p>
        <p className="font-mono text-xs text-muted-foreground" dir="ltr">
          {config.embeddingModel}
        </p>
        <p className="text-xs text-muted-foreground">
          {model ? t('model.dimensions', { count: model.dimensions }) : t('model.unknown')}
        </p>
      </StatusCard>

      <StatusCard title={t('index.title')}>
        <dl className="grid grid-cols-3 gap-2 text-center">
          {(
            [
              ['ready', stats.ready, ''],
              ['waiting', stats.pending, ''],
              ['failed', stats.failed, stats.failed > 0 ? 'text-danger' : ''],
            ] as const
          ).map(([key, value, tone]) => (
            <div key={key} className="flex flex-col-reverse">
              <dt className="text-xs text-muted-foreground">{t(`index.${key}`)}</dt>
              <dd className={`text-2xl font-semibold tabular-nums ${tone}`}>{n(value)}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-muted-foreground">
          {t('index.totals', { faqs: stats.faqs, variations: stats.variations })}
        </p>
        {stats.staleModel > 0 && (
          <Alert tone="warning" className="text-xs">
            {t('index.stale', { count: stats.staleModel })}
          </Alert>
        )}
      </StatusCard>

      <StatusCard title={t('activity.title')}>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">{t('activity.matches')}</dt>
            <dd className="text-lg font-semibold tabular-nums">{n(stats.matches30d)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t('activity.answered')}</dt>
            <dd className="text-lg font-semibold tabular-nums">{n(stats.answered30d)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t('activity.rate')}</dt>
            <dd className="text-lg font-semibold tabular-nums">
              {rate === null ? '-' : format.number(rate, { style: 'percent' })}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t('activity.tokens')}</dt>
            <dd className="text-lg font-semibold tabular-nums">{n(stats.embeddingTokens30d)}</dd>
          </div>
        </dl>
      </StatusCard>
    </section>
  );
}
