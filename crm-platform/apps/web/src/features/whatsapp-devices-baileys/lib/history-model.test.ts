import { describe, expect, it } from 'vitest';
import { NOT_REQUESTED_STATUS, type HistoryImportStatus } from '@crm/contracts';
import {
  DEFAULT_HISTORY_CHOICE,
  HISTORY_CHOICES,
  HISTORY_POLL_MS,
  canCancelHistory,
  hasHistoryCounts,
  historyErrorKey,
  historyPercent,
  historyPollMs,
  historyTone,
} from './history-model';

const run = (over: Partial<HistoryImportStatus>): HistoryImportStatus => ({
  ...NOT_REQUESTED_STATUS,
  mode: 'recent',
  ...over,
});

describe('the history choice', () => {
  it('offers none, recent and full, and defaults to none (nothing is pre-selected)', () => {
    expect(HISTORY_CHOICES).toEqual(['none', 'recent', 'full']);
    expect(DEFAULT_HISTORY_CHOICE).toBe('none');
  });
});

describe('the card', () => {
  it('polls only while the run can still change', () => {
    expect(historyPollMs('idle')).toBe(HISTORY_POLL_MS);
    expect(historyPollMs('running')).toBe(HISTORY_POLL_MS);
    for (const s of ['done', 'failed', 'cancelled', 'limit_reached', 'not_requested'] as const) {
      expect(historyPollMs(s)).toBe(false);
    }
  });

  it('may be cancelled only while idle or running', () => {
    expect(canCancelHistory(run({ state: 'idle' }))).toBe(true);
    expect(canCancelHistory(run({ state: 'running' }))).toBe(true);
    expect(canCancelHistory(run({ state: 'done' }))).toBe(false);
    expect(canCancelHistory(NOT_REQUESTED_STATUS)).toBe(false);
  });

  it('colours a limit as a warning and a failure as danger', () => {
    expect(historyTone('limit_reached')).toBe('warning');
    expect(historyTone('failed')).toBe('danger');
    expect(historyTone('done')).toBe('success');
    expect(historyTone('cancelled')).toBe('neutral');
  });

  it('counts show once something was stored; the error key follows the code', () => {
    expect(hasHistoryCounts(run({ state: 'idle' }))).toBe(false);
    expect(hasHistoryCounts(run({ state: 'running', messages: 3 }))).toBe(true);
    expect(
      historyErrorKey(run({ state: 'failed', lastError: { code: 'history_not_received' } })),
    ).toBe('error.history_not_received');
    expect(historyErrorKey(run({ state: 'cancelled' }))).toBeNull();
  });

  it('the bar is full for a clean finish and bounded otherwise', () => {
    expect(historyPercent(run({ state: 'done', progress: 40 }))).toBe(100);
    expect(
      historyPercent(run({ state: 'done', progress: 40, lastError: { code: 'chat_cap_reached' } })),
    ).toBe(40);
    expect(historyPercent(run({ state: 'running', progress: 55 }))).toBe(55);
    expect(historyPercent(run({ state: 'idle', progress: 0 }))).toBe(0);
  });
});
