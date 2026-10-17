import { describe, expect, it } from 'vitest';
import { addOrRevive, type ReviveQueue } from './add-or-revive';

/**
 * BullMQ ignores `add` when a job with the same id still exists. A job that FAILED is kept for days, so the provider's redelivery of
 * the same payload was silently absorbed by the dead job and answered 200: the message stayed lost (ASYNC-018/050). A failed job is
 * replaced; a job that is waiting, delayed, active or completed-and-kept is left alone, which is the dedup the id exists for.
 */
function fakeQueue(state: string | null) {
  const calls: string[] = [];
  const queue: ReviveQueue = {
    getJob: async () =>
      state === null
        ? undefined
        : {
            getState: async () => state,
            remove: async () => {
              calls.push('remove');
            },
          },
    add: async () => {
      calls.push('add');
      return {};
    },
  };
  return { queue, calls };
}

describe('addOrRevive', () => {
  it('just adds when there is no job with that id', async () => {
    const { queue, calls } = fakeQueue(null);
    await addOrRevive(queue, 'payload', {}, { jobId: 'j1' });
    expect(calls).toEqual(['add']);
  });

  it('removes a failed job with that id and adds a fresh one', async () => {
    const { queue, calls } = fakeQueue('failed');
    await addOrRevive(queue, 'payload', {}, { jobId: 'j1' });
    expect(calls).toEqual(['remove', 'add']);
  });

  it.each(['waiting', 'active', 'delayed', 'completed'])(
    'leaves a %s job alone (that is the dedup)',
    async (state) => {
      const { queue, calls } = fakeQueue(state);
      await addOrRevive(queue, 'payload', {}, { jobId: 'j1' });
      expect(calls).toEqual(['add']);
    },
  );

  it('does not look anything up when no job id is given', async () => {
    const { queue, calls } = fakeQueue('failed');
    await addOrRevive(queue, 'payload', {}, {});
    expect(calls).toEqual(['add']);
  });
});
