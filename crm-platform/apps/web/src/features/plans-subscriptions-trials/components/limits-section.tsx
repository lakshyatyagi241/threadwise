'use client';

import { useId, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { PlanLimitGroup, UsageMeter } from '@crm/contracts';
import { Card, cn } from '@crm/ui';
import { useUnofficialWhatsapp } from '@/lib/use-unofficial-whatsapp';
import { countUnlimited, groupLimits, type LimitRow, type LimitTone } from '../lib/limits';

const NS = 'plans-subscriptions-trials';

const BAR_TONE: Record<LimitTone, string> = {
  normal: 'bg-primary',
  warning: 'bg-warning',
  danger: 'bg-danger',
};

/**
 * "Usage and limits": every limit of the plan in its group, with a bar for each capped one. Groups with a cap start open, the others
 * collapsed; unlimited limits stay out of the way behind "Show N unlimited limits".
 */
export function LimitsSection({ meters }: { meters: readonly UsageMeter[] }) {
  const t = useTranslations(`${NS}.usage`);
  const [showAll, setShowAll] = useState(false);
  // The devices cap is hidden unless the platform has the unofficial WhatsApp engine on: official numbers are not capped by it.
  const unofficial = useUnofficialWhatsapp();
  const groups = groupLimits(meters, { showAll, unofficial });
  const unlimited = countUnlimited(meters, unofficial);

  return (
    <section aria-labelledby="meters-title" className="space-y-3" data-testid="limits-section">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="meters-title" className="text-base font-semibold">
          {t('meters')}
        </h3>
        {unlimited > 0 && (
          <button
            type="button"
            aria-pressed={showAll}
            onClick={() => setShowAll((v) => !v)}
            data-testid="limits-toggle"
            className="text-sm font-medium text-primary hover:underline focus-visible:ring-2 focus-visible:ring-primary"
          >
            {showAll ? t('hideUnlimited') : t('showUnlimited', { count: unlimited })}
          </button>
        )}
      </div>
      {groups.length === 0 && <p className="text-sm text-muted-foreground">{t('noLimits')}</p>}
      {groups.map((g) => (
        <LimitGroup
          key={g.group}
          group={g.group}
          rows={g.rows}
          defaultOpen={g.defaultOpen}
          hiddenUnlimited={g.hiddenUnlimited}
        />
      ))}
    </section>
  );
}

function LimitGroup({
  group,
  rows,
  defaultOpen,
  hiddenUnlimited,
}: {
  group: PlanLimitGroup;
  rows: LimitRow[];
  defaultOpen: boolean;
  hiddenUnlimited: number;
}) {
  const t = useTranslations(`${NS}.usage`);
  const tg = useTranslations(`${NS}.limitGroups`);
  const [open, setOpen] = useState<boolean | null>(null);
  const isOpen = open ?? defaultOpen;
  const panelId = useId();
  return (
    <div
      className="rounded-xl border border-border"
      data-testid={`limit-group-${group}`}
      data-open={isOpen}
    >
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={() => setOpen(!isOpen)}
        className="flex w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-start focus-visible:ring-2 focus-visible:ring-primary"
      >
        <span className="font-medium">{tg(group)}</span>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          {t('groupCount', { count: rows.length })}
          <span
            aria-hidden="true"
            className={cn('transition-transform rtl:-scale-x-100', isOpen && 'rotate-90')}
          >
            ›
          </span>
        </span>
      </button>
      {isOpen && (
        <div id={panelId} className="space-y-3 border-t border-border p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {rows.map((r) => (
              <LimitMeter key={r.key} row={r} />
            ))}
          </div>
          {hiddenUnlimited > 0 && (
            <p className="text-xs text-muted-foreground">
              {t('groupHidden', { count: hiddenUnlimited })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function LimitMeter({ row }: { row: LimitRow }) {
  const t = useTranslations(`${NS}.usage`);
  const tl = useTranslations(`${NS}.limits`);
  const th = useTranslations(`${NS}.limitHints`);
  const locale = useLocale();
  const n = (v: number) => new Intl.NumberFormat(locale).format(v);

  const summary = !row.tracked
    ? t('noUsageTracked')
    : row.platformDefault
      ? t('platformDefault')
      : row.unlimited
        ? t('ofUnlimited', { used: row.used ?? 0 })
        : t('ofLimit', { used: row.used ?? 0, limit: row.limit });
  const showBar = row.tracked && !row.platformDefault;

  return (
    <Card className="space-y-2 p-4" data-testid={`meter-${row.key}`} data-tone={row.tone}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium">{tl(row.key)}</p>
        {row.window && (
          <p className="shrink-0 text-xs text-muted-foreground">
            {t(row.window === 'month' ? 'month' : 'total')}
          </p>
        )}
      </div>
      {showBar && (
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={row.percent ?? 0}
          aria-valuetext={row.unlimited ? t('unlimited') : `${n(row.percent ?? 0)}%`}
          aria-label={tl(row.key)}
          className="h-2 overflow-hidden rounded-full bg-muted"
        >
          <div
            className={cn('h-full rounded-full', BAR_TONE[row.tone], row.unlimited && 'opacity-30')}
            style={{ width: `${row.unlimited ? 8 : (row.percent ?? 0)}%` }}
          />
        </div>
      )}
      <p
        className={cn(
          'text-sm',
          row.tone === 'danger' && 'font-medium text-danger',
          row.tone === 'warning' && 'text-warning',
          !row.tracked && 'text-muted-foreground',
        )}
      >
        {summary}
      </p>
      <p className="text-xs text-muted-foreground">{th(row.key)}</p>
    </Card>
  );
}
