import { describe, expect, it } from 'vitest';
import { shouldPollTests, testTone } from './test-log';

const NOW = Date.parse('2026-10-06T08:00:30Z');
const row = (status: string, at: string) => ({ status, createdAt: at });

describe('shouldPollTests', () => {
  it('polls while a recent test is still "sent"', () => {
    expect(shouldPollTests([row('sent', '2026-10-06T08:00:20Z')], null, NOW, 30_000)).toBe(true);
  });
  it('stops when everything has an answer', () => {
    expect(shouldPollTests([row('delivered', '2026-10-06T08:00:20Z')], null, NOW, 30_000)).toBe(
      false,
    );
    expect(shouldPollTests([], null, NOW, 30_000)).toBe(false);
  });
  it('gives up on an old "sent" row after the window', () => {
    expect(shouldPollTests([row('sent', '2026-10-06T07:00:00Z')], null, NOW, 30_000)).toBe(false);
  });
  it('a fresh send in this session restarts the window', () => {
    expect(shouldPollTests([row('sent', '2026-10-06T07:00:00Z')], NOW - 5_000, NOW, 30_000)).toBe(
      true,
    );
  });
  it('colours statuses', () => {
    expect(testTone('failed')).toBe('danger');
    expect(testTone('read')).toBe('success');
    expect(testTone('delivered')).toBe('success');
    expect(testTone('sent')).toBe('neutral');
    // Held for the workspace's quiet hours (BL-191): waiting, not failed.
    expect(testTone('held')).toBe('warning');
  });
});
