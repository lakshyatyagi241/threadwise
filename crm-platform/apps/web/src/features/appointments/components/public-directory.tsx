'use client';

import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { publicApi } from '../api/service';
import type { PublicType } from '../api/schemas';
import { safeColor } from '../lib/format';
import { priceLabel } from '../lib/public-booking';
import { ChevronRightIcon, ClockIcon, CoinIcon, InfoIcon, flip } from './icons';
import {
  InfoRow,
  LocationIcon,
  ProblemCard,
  PublicSkeleton,
  useDurationLabel,
} from './public-parts';
import { PublicShell } from './public-shell';

/**
 * `/book/<org>`: the services a business offers online. Each card shows what the visitor needs to choose (name, what it is,
 * how long, where, what it costs) and leads to the service's own page, where times are picked.
 */
export function PublicDirectory({ org }: { org: string }) {
  const t = useTranslations('appointments.public.directory');
  const q = useQuery({
    queryKey: ['appointments', 'public', 'directory', org],
    queryFn: ({ signal }) => publicApi.directory(org, signal),
    retry: false,
    staleTime: 30_000,
  });

  return (
    <PublicShell orgName={q.data?.org.name}>
      {q.isPending ? (
        <PublicSkeleton />
      ) : q.isError ? (
        <ProblemCard error={q.error} context="org" onRetry={() => void q.refetch()} />
      ) : (
        <div className="space-y-5">
          <div>
            <h1 className="text-xl font-semibold" dir="auto">
              {t('title')}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('subtitle', { name: q.data.org.name })}
            </p>
          </div>
          {q.data.types.length === 0 ? (
            <div
              role="status"
              className="rounded-xl border border-border bg-background p-8 text-center"
            >
              <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <InfoIcon className="size-6" />
              </span>
              <h2 className="mt-4 text-base font-semibold">{t('empty.title')}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{t('empty.message')}</p>
            </div>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2" aria-label={t('services')}>
              {q.data.types.map((type) => (
                <li key={type.slug} className="min-w-0">
                  <ServiceCard org={org} type={type} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </PublicShell>
  );
}

function ServiceCard({ org, type }: { org: string; type: PublicType }) {
  const t = useTranslations('appointments.public');
  const locale = useLocale();
  const duration = useDurationLabel();
  const price = priceLabel(type, locale);
  return (
    <Link
      href={`/book/${encodeURIComponent(org)}/${encodeURIComponent(type.slug)}`}
      className="group flex h-full flex-col overflow-hidden rounded-xl border border-border bg-background shadow-sm outline-none transition hover:border-brand/50 hover:shadow-md focus-visible:ring-2 focus-visible:ring-primary"
    >
      <span
        aria-hidden="true"
        className="block h-1.5"
        style={{ backgroundColor: safeColor(type.color) }}
      />
      <span className="flex flex-1 flex-col gap-3 p-4">
        <span className="block text-base font-semibold" dir="auto">
          {type.name}
        </span>
        {type.description && (
          <span
            className="line-clamp-3 block whitespace-pre-line text-sm text-muted-foreground"
            dir="auto"
          >
            {type.description}
          </span>
        )}
        <span className="mt-auto flex flex-col gap-1.5 pt-1">
          <InfoRow icon={<ClockIcon />} className="items-center">
            {duration(type.durationMinutes)}
          </InfoRow>
          <InfoRow icon={<LocationIcon type={type.locationType} />} className="items-center">
            {t(`location.${type.locationType}`)}
          </InfoRow>
          {price && (
            <InfoRow icon={<CoinIcon />} className="items-center">
              {price}
            </InfoRow>
          )}
        </span>
        <span className="inline-flex items-center gap-1 text-sm font-medium text-brand dark:text-primary">
          {t('directory.choose')}
          <ChevronRightIcon className={flip} />
        </span>
      </span>
    </Link>
  );
}
