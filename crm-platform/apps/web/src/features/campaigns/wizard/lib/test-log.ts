export interface TestSendStatusLike {
  status: string;
  createdAt: string;
}

/**
 * A test stays `sent` until the provider reports delivery or failure, so the log is asked again every few seconds, but only
 * while the newest unresolved test is recent (`windowMs`); an old `sent` row is a message that will never report back.
 */
export function shouldPollTests(
  rows: readonly TestSendStatusLike[],
  sinceMs: number | null,
  now: number,
  windowMs: number,
): boolean {
  const waiting = rows.filter((r) => r.status === 'sent');
  if (waiting.length === 0) return false;
  const newest = Math.max(sinceMs ?? 0, ...waiting.map((r) => Date.parse(r.createdAt) || 0));
  return now - newest < windowMs;
}

export type TestTone = 'neutral' | 'success' | 'warning' | 'danger';

export const testTone = (status: string): TestTone =>
  status === 'failed'
    ? 'danger'
    : status === 'delivered' || status === 'read'
      ? 'success'
      : 'neutral';
