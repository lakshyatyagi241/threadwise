import { describe, expect, it, vi } from 'vitest';
import {
  exportRangeProblem,
  hotCutoff,
  retentionCutoff,
} from '../../../src/modules/chat-conversations/message-log-rules';
import {
  DEFAULT_MESSAGE_LOG_WINDOWS,
  MESSAGE_LOG_MIN_HOT_DAYS,
  messageLogWindows,
} from '../../../src/modules/chat-conversations/message-log-windows';

const loadPolicy = vi.hoisted(() => vi.fn());
vi.mock('../../../src/modules/data-retention', () => ({ loadPolicy }));

const NOW = new Date('2027-03-15T12:00:00Z');
const saved = (liveDays: number, archiveDays: number | null) => ({
  item: 'message_log',
  liveDays,
  archiveDays,
  rowVersion: 1,
  updatedAt: NOW,
  updatedBy: 1,
});

describe('the message log windows', () => {
  it('are today’s 90 live days and 365 in total while nothing is saved', async () => {
    loadPolicy.mockResolvedValue(null);
    expect(await messageLogWindows({} as never)).toEqual(DEFAULT_MESSAGE_LOG_WINDOWS);
    expect(DEFAULT_MESSAGE_LOG_WINDOWS).toEqual({ hotDays: 90, retentionDays: 365 });
  });

  it('count the archive days from the end of the live window', async () => {
    loadPolicy.mockResolvedValue(saved(30, 60));
    expect(await messageLogWindows({} as never)).toEqual({ hotDays: 30, retentionDays: 90 });
  });

  it('keep the archive for ever when the archive days are null', async () => {
    loadPolicy.mockResolvedValue(saved(30, null));
    expect(await messageLogWindows({} as never)).toEqual({ hotDays: 30, retentionDays: null });
  });

  it('ignore a stored row outside the limits instead of deleting by it', async () => {
    loadPolicy.mockResolvedValue(saved(1, 5));
    expect(await messageLogWindows({} as never)).toEqual(DEFAULT_MESSAGE_LOG_WINDOWS);
  });

  it('never search the archive later than the shortest live window the settings allow', () => {
    expect(MESSAGE_LOG_MIN_HOT_DAYS).toBe(7);
  });
});

describe('the cut-offs follow the windows', () => {
  it('moves the live cut with the live days', () => {
    expect(hotCutoff(NOW, 30).toISOString()).toBe('2027-02-13T00:00:00.000Z');
    expect(hotCutoff(NOW).toISOString()).toBe('2026-12-15T00:00:00.000Z');
  });

  it('has no retention cut when the archive is kept for ever, so no export is too old', () => {
    expect(retentionCutoff(NOW, null).getTime()).toBe(0);
    expect(exportRangeProblem('2020-01-01', '2020-01-02', NOW, null)).toBeNull();
  });

  it('refuses an export older than the saved retention, and accepts one inside it', () => {
    expect(exportRangeProblem('2027-01-01', '2027-01-05', NOW, 30)).toBe('too_old');
    expect(exportRangeProblem('2027-02-20', '2027-02-25', NOW, 30)).toBeNull();
    expect(exportRangeProblem('2026-03-01', '2026-03-02', NOW)).toBe('too_old');
  });
});
