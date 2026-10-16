import { describe, expect, it } from 'vitest';
import { compileGraph } from '../../../src/modules/flow-runtime-engine/graph/compile-graph';
import {
  executeCurrent,
  type StepDeps,
} from '../../../src/modules/flow-runtime-engine/runtime/engine-core';
import {
  HALT_RETRY_MS,
  haltDelayMs,
  haltOf,
} from '../../../src/modules/flow-runtime-engine/runtime/halt';
import type { RunState } from '../../../src/modules/flow-runtime-engine/runtime/types';

/**
 * BL-192: a flow whose marketing message is held for the quiet hours wakes exactly when the hours open, not on the usual five minute
 * retry. The send says when (`retryAt`), the node turns it into a halt, and the engine schedules the step for that instant.
 */
const NOW = new Date('2026-10-15T16:00:00Z');
const OPENS = '2026-10-16T03:30:00.000Z';

describe('haltDelayMs', () => {
  it('waits the usual five minutes when the halt does not know the instant', () => {
    expect(haltDelayMs(undefined, NOW)).toBe(HALT_RETRY_MS);
  });

  it('waits until the opening plus a second when it does', () => {
    expect(haltDelayMs(OPENS, NOW)).toBe(Date.parse(OPENS) - NOW.getTime() + 1_000);
  });

  it('never waits less than a second, even for an instant already past', () => {
    expect(haltDelayMs('2026-10-15T15:00:00Z', NOW)).toBe(1_000);
  });

  it('ignores an instant that is not a date or lies days away', () => {
    expect(haltDelayMs('soon', NOW)).toBe(HALT_RETRY_MS);
    expect(haltDelayMs('2026-12-31T00:00:00Z', NOW)).toBe(HALT_RETRY_MS);
  });
});

describe('haltOf', () => {
  it('carries the instant only when the send had one', () => {
    expect(haltOf({ ok: false, code: 'X', error: 'channel down', halt: true })).toEqual({
      kind: 'halt',
      reason: 'channel down',
    });
    expect(
      haltOf({ ok: false, code: 'SEND_HELD', error: 'held', halt: true, retryAt: OPENS }),
    ).toEqual({ kind: 'halt', reason: 'held', retryAt: OPENS });
  });
});

describe('a held send in a running flow', () => {
  const run = (): RunState => {
    const graph = compileGraph({
      flowNodes: [{ id: 'a', type: 'message', data: { text: 'Big sale' }, isStart: true }],
      flowEdges: [],
    });
    return {
      id: 1,
      uuid: 'r',
      orgId: 1,
      flowId: 1,
      subscriberId: null,
      contactId: null,
      channelId: 1,
      channelUuid: 'c',
      channelKind: 'simulator',
      contactUuid: null,
      peerKey: '1',
      conversationId: null,
      source: 'keyword',
      triggerText: null,
      status: 'running',
      graph,
      graphVersionId: null,
      nodeCount: 0,
      currentNodeId: graph.nodes[0]!.id,
      stepSeq: 0,
      vars: {},
      visits: {},
      wait: null,
      menus: { latest: null, byNode: {} },
      lastOut: null,
      timeoutSeconds: 600,
      cooldownSeconds: 0,
      haltReason: null,
      startedAt: new Date(0),
      expiresAt: null,
      maxExpiresAt: new Date(1e13),
      resumeAt: null,
    };
  };

  it('halts with the opening as the retry instant, and a plain channel failure halts without one', async () => {
    const held: StepDeps = {
      send: async () => ({
        ok: false,
        code: 'SEND_HELD',
        error: `Held for the quiet hours until ${OPENS}`,
        halt: true,
        retryAt: OPENS,
      }),
      paceMs: () => 0,
      now: () => NOW,
    };
    const out = await executeCurrent(run(), held);
    expect(out.transition).toMatchObject({ t: 'halt', retryAt: OPENS });

    const down: StepDeps = {
      ...held,
      send: async () => ({ ok: false, code: 'X', error: 'channel down', halt: true }),
    };
    const plain = await executeCurrent(run(), down);
    expect(plain.transition).toEqual({ t: 'halt', reason: 'channel down' });
  });
});
