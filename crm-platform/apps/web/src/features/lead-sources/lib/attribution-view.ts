import type { AttributionTouch, ContactAttributionResponse } from '@crm/contracts';
import { sourceHref } from './source-view';

/** The contact page's "Lead attribution" card: what to show, or nothing at all. */

export interface TouchView {
  id: string;
  platform: string | null;
  sourceLabel: string;
  /** The labelled values that exist, in reading order. */
  details: Array<{ field: 'campaign' | 'adset' | 'ad' | 'form'; value: string }>;
  capturedAt: string;
  /** Where the lead source is managed, when the touch still has one. */
  sourceHref: string | null;
}

export interface AttributionView {
  /** First and latest are the same row: one block "First and latest touch". */
  single: boolean;
  first: TouchView;
  latest: TouchView;
  /** Touches in total; shown only when there is more than one. */
  total: number;
}

const DETAIL_FIELDS = ['campaign', 'adset', 'ad', 'form'] as const;

export function touchView(t: AttributionTouch): TouchView {
  return {
    id: t.id,
    platform: t.platform && t.platform.trim() !== '' ? t.platform : null,
    sourceLabel: t.sourceLabel,
    details: DETAIL_FIELDS.flatMap((field) => {
      const value = t[field];
      return value && value.trim() !== '' ? [{ field, value }] : [];
    }),
    capturedAt: t.capturedAt,
    sourceHref: t.leadSourceId ? sourceHref(t.leadSourceId) : null,
  };
}

/** Null (render nothing) when the contact never came through a lead source. */
export function attributionView(
  res: ContactAttributionResponse | undefined,
): AttributionView | null {
  if (!res || res.total === 0) return null;
  const first = res.first ?? res.latest;
  const latest = res.latest ?? res.first;
  if (!first || !latest) return null;
  return {
    single: first.id === latest.id,
    first: touchView(first),
    latest: touchView(latest),
    total: res.total,
  };
}
