import { describe, expect, it, vi } from 'vitest';
import { BroadcastDueService } from '../../../src/modules/broadcasts/broadcast-due.service';

/**
 * ASYNC-018/067: the due service re-queues a broadcast under its uuid whenever the row says no job is queued (a resume, a retry). A
 * job of that id left from the earlier run (completed for an hour, failed for days) made BullMQ ignore the add, so the row was marked
 * queued with no job behind it and the broadcast never ran. A leftover finished job is replaced; a live one is left alone.
 */
function build(state: string) {
  const calls: string[] = [];
  const queue = {
    getJobState: vi.fn(async () => {
      calls.push('state');
      return state;
    }),
    getJob: vi.fn(async () => ({
      remove: async () => {
        calls.push('remove');
      },
    })),
    add: vi.fn(async () => {
      calls.push('add');
      return {};
    }),
  };
  const tx = {
    execute: vi.fn(async (q: { queryChunks?: unknown[] }) => {
      const text = JSON.stringify(q.queryChunks ?? []);
      if (text.includes('FROM broadcasts')) return { rows: [{ id: 5, uuid: 'b-uuid', org_id: 1 }] };
      calls.push('mark');
      return { rows: [] };
    }),
  };
  const db = { privileged: async (fn: (t: unknown) => unknown) => fn(tx) };
  const gate = { enabledOrgIds: async () => [1] };
  const svc = new BroadcastDueService(db as never, queue as never, gate as never);
  return { svc, queue, calls };
}

describe('BroadcastDueService.enqueueDue', () => {
  it('queues a due broadcast and marks it queued', async () => {
    const { svc, calls } = build('unknown');
    expect(await svc.enqueueDue()).toBe(1);
    expect(calls).toEqual(['state', 'add', 'mark']);
  });

  it.each(['completed', 'failed'])(
    'replaces a leftover %s job of the same id, so a resumed broadcast really runs',
    async (state) => {
      const { svc, calls } = build(state);
      await svc.enqueueDue();
      expect(calls).toEqual(['state', 'remove', 'add', 'mark']);
    },
  );

  it('leaves a job that is still waiting or running alone (the crash-between-queue-and-commit case)', async () => {
    for (const state of ['waiting', 'active', 'delayed']) {
      const { svc, calls } = build(state);
      await svc.enqueueDue();
      expect(calls).toEqual(['state', 'add', 'mark']);
    }
  });
});
