'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import type { CatalogHealth } from '@crm/contracts';
import { healthReasons, scoreTone, type ScoreTone } from '../lib/health';
import { AlertIcon, ChevronRightIcon, ImageIcon, PriceIcon } from './icons';
import { CARD, TEXT_LINK } from './parts';

const TONE: Record<ScoreTone, { text: string; bar: string; ring: string }> = {
  good: { text: 'text-success', bar: 'bg-success', ring: 'border-success' },
  warn: { text: 'text-warning', bar: 'bg-warning', ring: 'border-warning' },
  bad: { text: 'text-danger', bar: 'bg-danger', ring: 'border-danger' },
};

/** The 0 to 100 score of products that can sell as they are, with the counts and the products to fix (WD-CAT-007). */
export function HealthCard({ health, score }: { health: CatalogHealth; score: number }) {
  const t = useTranslations('catalogProducts.health');
  const tone = TONE[scoreTone(score)];
  const chip = 'inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium';
  return (
    <section className={cn(CARD, 'p-5')} aria-labelledby="cat-health-title">
      <div className="flex flex-wrap items-center gap-4">
        <div
          className={cn(
            'grid size-16 shrink-0 place-items-center rounded-full border-4',
            tone.ring,
          )}
        >
          <span className={cn('font-serif text-[22px] leading-none tabular-nums', tone.text)}>
            {score}
          </span>
        </div>
        <div className="min-w-[180px] flex-1">
          <h3 id="cat-health-title" className="font-serif text-[16px] font-normal leading-tight">
            {t('title')}
          </h3>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">
            {health.flagged > 0 ? t('needAttention', { count: health.flagged }) : t('allGood')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {health.noImage > 0 && (
            <span className={cn(chip, 'bg-danger/10 text-danger')}>
              <ImageIcon className="size-3" />
              {health.noImage.toLocaleString()} {t('noImage')}
            </span>
          )}
          {health.noPrice > 0 && (
            <span className={cn(chip, 'bg-warning/15 text-warning')}>
              <PriceIcon className="size-3" />
              {health.noPrice.toLocaleString()} {t('noPrice')}
            </span>
          )}
          {health.errored > 0 && (
            <span className={cn(chip, 'bg-danger/10 text-danger')}>
              <AlertIcon className="size-3" />
              {health.errored.toLocaleString()} {t('syncError')}
            </span>
          )}
        </div>
      </div>

      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div className={cn('h-full transition-all', tone.bar)} style={{ width: `${score}%` }} />
      </div>

      {health.samples.length > 0 && (
        <details className="group mt-4">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11.5px] font-semibold text-brand outline-none focus-visible:underline dark:text-primary">
            <ChevronRightIcon className="size-3 transition-transform group-open:rotate-90 rtl:rotate-180 rtl:group-open:rotate-90" />
            {t('showFix')}
          </summary>
          <ul className="mt-2 divide-y divide-border overflow-hidden rounded-xl border border-border">
            {health.samples.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-3 bg-background px-4 py-2.5"
              >
                <div className="min-w-0">
                  <div className="truncate text-[12.5px] font-medium">
                    {s.name || `#${s.id.slice(0, 8)}`}
                  </div>
                  <div className="font-mono text-[10.5px] text-danger">
                    {healthReasons(s)
                      .map((r) => t(r))
                      .join(' · ')}
                  </div>
                </div>
                <Link
                  href={`/store/products/${s.id}/edit`}
                  className={cn(TEXT_LINK, 'shrink-0 text-[11px]')}
                >
                  {t('fix')}
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
