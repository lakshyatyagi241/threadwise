import type { ContactResponse } from '@crm/contracts';

/** The pieces of a contact the score UI reads; a list row or the detail response both carry them. */
export type ScoreFields = Pick<
  ContactResponse,
  'leadScore' | 'leadScoreSource' | 'leadScoreReasons' | 'leadScoredAt' | 'leadScoreModel'
>;

export type ScoreBand = 'cold' | 'warm' | 'hot';

/** Cold below 34, warm 34 to 66, hot from 67 (thirds of 0 to 100). */
export const WARM_FROM = 34;
export const HOT_FROM = 67;

export function bandOf(score: number): ScoreBand {
  return score >= HOT_FROM ? 'hot' : score >= WARM_FROM ? 'warm' : 'cold';
}

/**
 * A score is the AI's only when the AI wrote it. Any other number (typed by a person, or typed before AI scoring existed and so
 * stored without a source) is theirs, and the scorer never overwrites it.
 */
export function isManualScore(c: Pick<ScoreFields, 'leadScore' | 'leadScoreSource'>): boolean {
  return c.leadScore !== null && c.leadScoreSource !== 'ai';
}

export const SCORE_MAX = 100;

/** What a person typed in the score field: nothing, a whole number from 0 to 100, or something else. */
export type ScoreInput = { kind: 'empty' } | { kind: 'value'; value: number } | { kind: 'invalid' };

export function parseScoreInput(text: string): ScoreInput {
  const s = text.trim();
  if (s === '') return { kind: 'empty' };
  if (!/^\d{1,3}$/.test(s)) return { kind: 'invalid' };
  const value = Number(s);
  return value <= SCORE_MAX ? { kind: 'value', value } : { kind: 'invalid' };
}

/**
 * What to put in an update for the typed score: `undefined` when it is the score the contact already has (so saving an
 * unrelated field never turns an AI score into a manual one), `null` to clear it, or the number.
 */
export function scoreChange(text: string, previous: number | null): number | null | undefined {
  const input = parseScoreInput(text);
  if (input.kind === 'invalid') return undefined;
  const next = input.kind === 'empty' ? null : input.value;
  return next === previous ? undefined : next;
}

/** The form text of a stored score. */
export const scoreToText = (score: number | null | undefined): string =>
  score === null || score === undefined ? '' : String(score);
