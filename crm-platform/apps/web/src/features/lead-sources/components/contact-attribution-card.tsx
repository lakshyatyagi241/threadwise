'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { fetchAttribution, leadKeys } from '../api';
import { attributionView, type TouchView } from '../lib/attribution-view';
import { LEADS_READ } from '../lib/permissions';
import { useCan } from '@/features/auth-registration-security/shared/session-context';

/**
 * "Lead attribution" on the contact page: where the person first came from and where they came from last (platform, campaign, ad
 * set, ad, form, when). It renders nothing while loading, on any error (no access, plan, a route this server lacks) and for a contact
 * that never came through a lead source, so the contact page is exactly as it was for everyone else.
 */
export function ContactAttributionCard({ contactId }: { contactId: string }) {
  const t = useTranslations('lead-sources.attribution');
  const canOpenSource = useCan(LEADS_READ);
  const q = useQuery({
    queryKey: leadKeys.attribution(contactId),
    queryFn: ({ signal }) => fetchAttribution(contactId, signal),
    retry: false,
    staleTime: 60_000,
  });
  const view = q.isSuccess ? attributionView(q.data) : null;
  if (!view) return null;

  const heading = `lead-attribution-${contactId}`;
  return (
    <section
      aria-labelledby={heading}
      data-testid="lead-attribution"
      className="space-y-4 rounded-md border border-border bg-background p-4 sm:p-5"
    >
      <h2
        id={heading}
        className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
      >
        {t('title')}
      </h2>
      {view.single ? (
        <Touch label={t('firstAndLatest')} touch={view.first} canOpenSource={canOpenSource} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Touch label={t('first')} touch={view.first} canOpenSource={canOpenSource} />
          <Touch label={t('latest')} touch={view.latest} canOpenSource={canOpenSource} />
        </div>
      )}
      {view.total > 1 && (
        <p className="text-xs text-muted-foreground">{t('total', { count: view.total })}</p>
      )}
    </section>
  );
}

function Touch({
  label,
  touch,
  canOpenSource,
}: {
  label: string;
  touch: TouchView;
  canOpenSource: boolean;
}) {
  const t = useTranslations('lead-sources.attribution');
  const format = useFormatter();
  const at = new Date(touch.capturedAt);
  return (
    <div className="min-w-0 space-y-1.5" data-testid="attribution-touch">
      <h3 className="text-sm font-semibold">{label}</h3>
      <dl className="space-y-1 text-sm">
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-muted-foreground">{t('platform')}</dt>
          <dd dir="auto" className="break-words">
            {touch.platform ?? touch.sourceLabel}
          </dd>
        </div>
        {touch.platform && touch.sourceLabel !== touch.platform && (
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-muted-foreground">{t('source')}</dt>
            <dd dir="auto" className="break-words">
              {touch.sourceLabel}
            </dd>
          </div>
        )}
        {touch.details.map((d) => (
          <div key={d.field} className="flex flex-wrap gap-x-2">
            <dt className="text-muted-foreground">{t(`fields.${d.field}`)}</dt>
            <dd dir="auto" className="break-words">
              {d.value}
            </dd>
          </div>
        ))}
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-muted-foreground">{t('capturedAt')}</dt>
          <dd>{format.dateTime(at, { dateStyle: 'medium', timeStyle: 'short' })}</dd>
        </div>
      </dl>
      {touch.sourceHref && canOpenSource && (
        <Link
          href={touch.sourceHref}
          className="text-xs text-primary underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-primary"
        >
          {t('openSource')}
        </Link>
      )}
    </div>
  );
}
