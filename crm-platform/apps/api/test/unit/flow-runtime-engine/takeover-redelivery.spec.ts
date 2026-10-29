import { describe, expect, it, vi } from 'vitest';
import { FlowEngine } from '../../../src/modules/flow-runtime-engine/runtime/engine.service';

/**
 * #1299: the takeover event is delivered at least once. A late redelivery of an old takeover must not end a flow the customer started
 * after the person took the conversation over. Only the runs that were live at the takeover are ended.
 */
describe('a redelivered takeover ends only the runs live at the takeover (#1299)', () => {
  const build = (startedAt: Date) => {
    const state = { id: 'run-1', stepSeq: 0, currentNodeId: null, graph: null, startedAt };
    const runs = {
      liveByPeer: vi.fn(async () => state),
      endLive: vi.fn(async () => true),
      appendStep: vi.fn(async () => undefined),
    };
    const engine = Object.assign(Object.create(FlowEngine.prototype), {
      db: { txAs: async (_c: unknown, fn: (tx: unknown) => unknown) => fn({}) },
      runs,
    }) as unknown as {
      endForPeer: (orgId: number, channelId: number, peerKey: string, at: Date) => Promise<boolean>;
    };
    return { engine, runs };
  };
  const takenOverAt = new Date('2026-10-28T10:05:00.000Z');

  it('ends a run that started before the person took the conversation over', async () => {
    const h = build(new Date('2026-10-28T10:00:00.000Z'));
    expect(await h.engine.endForPeer(7, 3, '919876543210', takenOverAt)).toBe(true);
    expect(h.runs.endLive).toHaveBeenCalledWith(
      expect.anything(),
      7,
      'run-1',
      'cancelled',
      'takeover',
    );
  });

  it('leaves a run that the customer started after the takeover, when the old event is redelivered', async () => {
    const h = build(new Date('2026-10-28T10:10:00.000Z'));
    expect(await h.engine.endForPeer(7, 3, '919876543210', takenOverAt)).toBe(false);
    expect(h.runs.endLive).not.toHaveBeenCalled();
    expect(h.runs.appendStep).not.toHaveBeenCalled();
  });
});
