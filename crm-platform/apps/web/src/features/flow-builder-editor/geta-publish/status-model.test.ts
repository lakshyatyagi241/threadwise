import { describe, expect, it } from 'vitest';
import { NO_GETA_SYNC, type FlowGetaSync } from '@crm/contracts';
import { POLL_EVERY_MS, POLL_MAX_TRIES, viewOf } from './status-model';

const sync = (over: Partial<FlowGetaSync>): FlowGetaSync => ({ ...NO_GETA_SYNC, ...over });
const published = { published: true, justPublished: false };

describe('what the editor shows next to the Published badge', () => {
  it('nothing without a sync state or for a draft', () => {
    expect(viewOf(null, published)).toEqual({ kind: 'hidden' });
    expect(viewOf(sync({ state: 'live' }), { published: false, justPublished: true })).toEqual({
      kind: 'hidden',
    });
  });

  it('pending is "going live", live is live', () => {
    expect(viewOf(sync({ state: 'pending' }), published)).toEqual({ kind: 'pending' });
    expect(viewOf(sync({ state: 'live' }), published)).toEqual({ kind: 'live' });
  });

  it('failed names the step and carries the sanitised reason', () => {
    expect(
      viewOf(
        sync({
          state: 'failed',
          failedStep: 'publish_bot',
          lastError: 'Geta answered 400 (publish)',
        }),
        published,
      ),
    ).toEqual({
      kind: 'failed',
      failedStep: 'publish_bot',
      reason: 'Geta answered 400 (publish)',
    });
  });

  it('no credentials: the setup notice only right after pressing Publish, never a permanent badge', () => {
    const s = sync({ state: 'not_configured' });
    expect(viewOf(s, { published: true, justPublished: true })).toEqual({ kind: 'not_configured' });
    expect(viewOf(s, published)).toEqual({ kind: 'hidden' });
  });

  it('published and configured but never pushed offers to push', () => {
    expect(viewOf(sync({ state: 'none', configured: true }), published)).toEqual({ kind: 'push' });
    expect(viewOf(sync({ state: 'none', configured: false }), published)).toEqual({
      kind: 'hidden',
    });
  });

  it('polls every 1.5 s for about two minutes', () => {
    expect(POLL_EVERY_MS * POLL_MAX_TRIES).toBeGreaterThanOrEqual(120_000);
  });
});
