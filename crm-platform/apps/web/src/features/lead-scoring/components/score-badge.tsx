'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import { bandOf, type ScoreBand } from '../lib/score';
import { SparkleIcon, useFormatDate } from './parts';

const TONES: Record<ScoreBand, string> = {
  cold: 'bg-muted text-muted-foreground ring-border',
  warm: 'bg-warning/15 text-warning ring-warning/30',
  hot: 'bg-success/15 text-success ring-success/30',
};

export interface ScoreBadgeProps {
  score: number | null;
  /** 'ai' marks the number with a sparkle; 'manual' or null (a score typed before AI scoring existed) is a person's. */
  source?: 'manual' | 'ai' | null;
  scoredAt?: string | null;
  className?: string;
}

/**
 * The lead score as a compact pill for lists and cards: the number (0 to 100), a colour band (cold, warm, hot) and a sparkle when
 * the AI wrote it. Colour is never the only signal: the number is printed and the accessible name spells out band and source.
 */
export function ScoreBadge({ score, source = null, scoredAt = null, className }: ScoreBadgeProps) {
  const t = useTranslations('lead-scoring.badge');
  const fmt = useFormatDate();
  if (score === null) {
    return (
      <span
        role="img"
        aria-label={t('none')}
        title={t('none')}
        className={cn('text-muted-foreground', className)}
      >
        <span aria-hidden="true">—</span>
      </span>
    );
  }
  const band = bandOf(score);
  const ai = source === 'ai';
  const sourceText = ai
    ? scoredAt
      ? t('titleAiOn', { date: fmt(scoredAt) })
      : t('titleAi')
    : t('titleManual');
  return (
    <span
      role="img"
      aria-label={t('aria', {
        score,
        band: t(`band.${band}`),
        source: ai ? t('source.ai') : t('source.manual'),
      })}
      title={`${t(`band.${band}`)}. ${sourceText}`}
      data-band={band}
      data-source={ai ? 'ai' : 'manual'}
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ring-1 ring-inset',
        TONES[band],
        className,
      )}
    >
      <span aria-hidden="true">{score}</span>
      {ai && <SparkleIcon />}
    </span>
  );
}
