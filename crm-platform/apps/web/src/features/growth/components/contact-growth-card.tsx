'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useContactGrowth, useGrowthSettings } from '../api/hooks';
import { CARD, useFormatDate } from './parts';

export interface ContactGrowthCardProps {
  contactId: string;
  className?: string;
}

/** The growth pilot's two facts about one contact: how likely they are to convert, and what the enrichment lookup found. */
export function ContactGrowthCard({ contactId, className }: ContactGrowthCardProps) {
  const canRead = useCan('lsc.runs.read');
  const settings = useGrowthSettings(canRead);
  const f = settings.data;
  const on = !!f && f.available && (f.features.propensity || f.features.enrichment);
  const q = useContactGrowth(contactId, on);
  if (!q.data || (!q.data.propensity && !q.data.enrichment)) return null;
  return <Body facts={q.data} className={className} />;
}

function Body({
  facts,
  className,
}: {
  facts: NonNullable<ReturnType<typeof useContactGrowth>['data']>;
  className?: string;
}) {
  const t = useTranslations('growth.contactCard');
  const fmt = useFormatDate();
  const enrichment = facts.enrichment
    ? Object.entries(facts.enrichment.data).filter(
        ([, v]) => typeof v === 'string' || typeof v === 'number',
      )
    : [];
  return (
    <section aria-label={t('title')} className={cn(CARD, 'space-y-2 p-4 text-sm', className)}>
      <h3 className="font-semibold">{t('title')}</h3>
      {facts.propensity && (
        <p>
          {t('propensity', { score: Math.round(facts.propensity.score) })}{' '}
          <span className="text-muted-foreground">
            {t('computedAt', { when: fmt(facts.propensity.computedAt) })}
          </span>
        </p>
      )}
      {enrichment.length > 0 && (
        <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
          {enrichment.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k.replace(/_/g, ' ')}</dt>
              <dd>{String(v)}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
