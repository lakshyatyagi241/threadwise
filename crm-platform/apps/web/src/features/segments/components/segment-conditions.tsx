'use client';

import { useTranslations } from 'next-intl';
import { useSegmentCatalog } from '../api/lookups';
import { useSegment } from '../api/segments';
import { summarizeConditions } from '../lib/summary';
import { fromWire } from '../lib/wire';
import { useSummaryContext } from './use-summary';

/**
 * A segment's own conditions, in the words its page uses. The contacts list filtered to a segment applies these rules on the
 * server, so the Filter panel shows them too: otherwise the person sees a segment name and nothing about what it matches. Draws
 * nothing while the segment cannot be read or a lookup failed (the list still filters).
 */
export function SegmentConditions({ segmentId }: { segmentId: string }) {
  const t = useTranslations('segments.detail');
  const query = useSegment(segmentId);
  const lookups = useSegmentCatalog();
  const ctx = useSummaryContext(lookups.catalog);
  const segment = query.data;
  if (!segment) return null;
  if (!lookups.ready) {
    return (
      <div
        role="status"
        aria-label={t('loading')}
        className="h-4 w-2/3 animate-pulse rounded bg-muted"
      />
    );
  }
  // A failed lookup leaves its list short, so a live tag or owner would read as deleted: draw nothing instead.
  if (lookups.failed) return null;
  const lines = summarizeConditions(fromWire(segment.rules), ctx);
  if (lines.length === 0) return null;
  return (
    <div
      role="group"
      aria-label={t('rulesTitle')}
      className="space-y-1 px-2.5 pb-1 text-xs text-muted-foreground"
    >
      <p>{t(segment.rules.combinator === 'and' ? 'matchAll' : 'matchAny')}</p>
      <ul className="space-y-0.5">
        {lines.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
    </div>
  );
}
