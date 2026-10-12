'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import { describeSegments } from '../lib/segment-model';

/**
 * The live "characters, segments, encoding" line under an SMS text (TW-SMS-009), with the operator warning once the text costs
 * more than one segment. Reference computed this and never showed it; the composers of the SMS channel show it.
 */
export function SegmentCounter({ text, className }: { text: string; className?: string }) {
  const t = useTranslations('sms.segments');
  const v = describeSegments(text);
  return (
    <div className={cn('mt-1.5 space-y-1', className)} data-testid="sms-segment-counter">
      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[11px] text-muted-foreground"
        aria-live="polite"
      >
        <span>{t('summary', { units: v.units, segments: v.segments, encoding: v.encoding })}</span>
        <span>{t('remaining', { remaining: v.remaining })}</span>
      </div>
      {v.warning !== 'none' && (
        <p role="note" className="text-[11.5px] leading-snug text-warning">
          {v.warning === 'ucs2'
            ? t('ucs2', { perSegment: v.perSegment, segments: v.segments })
            : t('gsm', { units: v.units, segments: v.segments })}
        </p>
      )}
    </div>
  );
}
