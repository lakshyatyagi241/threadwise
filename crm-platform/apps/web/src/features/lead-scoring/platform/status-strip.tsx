'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { Badge, Card } from '@crm/ui';
import type { LscPlatformOverview } from '@crm/contracts';

const NS = 'lead-scoring-admin.status';
/** The platform's AI provider keys page (where the shared OpenRouter key is saved). */
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

/** The header strip: is scoring on for the platform, which model, can it reach OpenRouter, how many workspaces and contacts. */
export function StatusStrip({ overview }: { overview: LscPlatformOverview }) {
  const t = useTranslations(NS);
  const format = useFormatter();
  const { config, platformKeyReady } = overview;
  const model = config.models.find((m) => m.id === config.model);

  return (
    <section aria-label={t('label')} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatusCard
        title={t('switch.title')}
        badge={
          <Badge tone={config.platformEnabled ? 'success' : 'danger'}>
            {config.platformEnabled ? t('switch.on') : t('switch.off')}
          </Badge>
        }
      >
        <p className="text-sm text-muted-foreground">
          {config.platformEnabled ? t('switch.hintOn') : t('switch.hintOff')}
        </p>
      </StatusCard>

      <StatusCard title={t('model.title')}>
        <p className="font-semibold">{model?.label ?? config.model}</p>
        <p className="break-all font-mono text-xs text-muted-foreground" dir="ltr">
          {config.model}
        </p>
        {!model && <p className="text-xs text-muted-foreground">{t('model.custom')}</p>}
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

      <StatusCard title={t('reach.title')}>
        <dl className="grid grid-cols-2 gap-2">
          <div className="flex flex-col-reverse">
            <dt className="text-xs text-muted-foreground">{t('reach.workspaces')}</dt>
            <dd className="text-2xl font-semibold tabular-nums">
              {format.number(overview.workspacesEnabled)}
            </dd>
          </div>
          <div className="flex flex-col-reverse">
            <dt className="text-xs text-muted-foreground">{t('reach.contacts')}</dt>
            <dd className="text-2xl font-semibold tabular-nums">
              {format.number(overview.contactsScored)}
            </dd>
          </div>
        </dl>
      </StatusCard>
    </section>
  );
}
