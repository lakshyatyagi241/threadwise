import type { GrandfatherSubscriptionsRequest, MarketGrandfatherResult } from '@crm/contracts';
import { textRule, type TextRule } from './confirmations';
import {
  OPERATOR_NOTE_MAX,
  OPERATOR_NOTE_MIN,
  parseMonths,
  type CompDuration,
} from './subscriptions';

/**
 * "Comp existing users": a feature that becomes a paid app is not taken from the workspaces that already have it. The operator first
 * asks for a dry run (who would be comped), looks at the count and the sample, and only then runs it for real. The rules below are the
 * contract's (`grandfatherSubscriptionsSchema`); the pure pieces are here so they are tested and the dialog only reads them.
 */

export interface GrandfatherDraft {
  duration: CompDuration;
  /** Whole months as typed, 1 to 36. */
  months: string;
  note: string;
}

/** Existing users had the feature without an end, so the comp starts as "until I end it". */
export const initialGrandfatherDraft = (): GrandfatherDraft => ({
  duration: 'open',
  months: '12',
  note: '',
});

export interface GrandfatherCheck {
  months: boolean;
  note: TextRule;
  canPreview: boolean;
}

export function grandfatherCheck(d: GrandfatherDraft): GrandfatherCheck {
  const months = d.duration === 'open' || parseMonths(d.months) !== null;
  const note = textRule(d.note, OPERATOR_NOTE_MIN, OPERATOR_NOTE_MAX);
  return { months, note, canPreview: months && note.ok };
}

/** The POST body. `dryRun: true` only counts and lists; the real run sends the same draft with `dryRun: false`. */
export function grandfatherPayload(
  d: GrandfatherDraft,
  dryRun: boolean,
): GrandfatherSubscriptionsRequest {
  return {
    months: d.duration === 'open' ? null : (parseMonths(d.months) ?? Number.NaN),
    note: d.note.trim(),
    dryRun,
  };
}

export interface GrandfatherPreview {
  matched: number;
  /** Names the API listed (it lists at most 25). */
  shown: string[];
  /** Matched workspaces beyond the sample. */
  more: number;
  /** The real run is offered only after a dry run that found someone. */
  canRun: boolean;
}

export function grandfatherPreview(r: MarketGrandfatherResult): GrandfatherPreview {
  return {
    matched: r.matched,
    shown: r.sample.map((s) => s.name),
    more: Math.max(0, r.matched - r.sample.length),
    canRun: r.dryRun && r.matched > 0,
  };
}
