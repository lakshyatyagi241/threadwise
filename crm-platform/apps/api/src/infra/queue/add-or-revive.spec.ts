import { describe, expect, it } from 'vitest';
import { addOrRevive, type ReviveQueue } from './add-or-revive';

/**
 * BullMQ ignores `add` when a job with the same id still exists. A job that FAILED is kept for days, so the provider's redelivery of
 * the same payload was silently absorbed by the dead job and answered 200: the message stayed lost (ASYNC-018/050). A failed job is
 * replaced; a job that is waiting, delayed, active or completed-and-kept is left alone, which is the dedup the id exists for.
 */
function fakeQueue(state: string) {
  const calls: string[] = [];
  const queue: ReviveQueue<{ n: number }> = {
    getJobState: async () => {
      calls.push('state');
      return state;
    },
    getJob: async () => ({
      remove: async () => {
        calls.push('remove');
      },
    }),
    add: async () => {
      calls.push('add');
      return {};
    },
  };
  return { queue, calls };
}

describe('addOrRevive', () => {
  it('asks once and adds when there is no job with that id', async () => {
    const { queue, calls } = fakeQueue('unknown');
    await addOrRevive(queue, 'payload', { n: 1 }, { jobId: 'j1' });
    expect(calls).toEqual(['state', 'add']);
  });

  it('removes a failed job with that id and adds a fresh one', async () => {
    const { queue, calls } = fakeQueue('failed');
    await addOrRevive(queue, 'payload', { n: 1 }, { jobId: 'j1' });
    expect(calls).toEqual(['state', 'remove', 'add']);
  });

  it.each(['waiting', 'active', 'delayed', 'completed'])(
    'leaves a %s job alone (that is the dedup)',
    async (state) => {
      const { queue, calls } = fakeQueue(state);
      await addOrRevive(queue, 'payload', { n: 1 }, { jobId: 'j1' });
      expect(calls).toEqual(['state', 'add']);
    },
  );

  it('does not look anything up when no job id is given', async () => {
    const { queue, calls } = fakeQueue('failed');
    await addOrRevive(queue, 'payload', { n: 1 });
    expect(calls).toEqual(['add']);
  });

  it('can also replace a completed job, for a producer that only re-adds when its own record says nothing is queued', async () => {
    const { queue, calls } = fakeQueue('completed');
    await addOrRevive(
      queue,
      'payload',
      { n: 1 },
      { jobId: 'j1', replaceStates: ['failed', 'completed'] },
    );
    expect(calls).toEqual(['state', 'remove', 'add']);
  });

  it('still leaves a waiting job alone when completed ones may be replaced', async () => {
    const { queue, calls } = fakeQueue('waiting');
    await addOrRevive(
      queue,
      'payload',
      { n: 1 },
      { jobId: 'j1', replaceStates: ['failed', 'completed'] },
    );
    expect(calls).toEqual(['state', 'add']);
  });
});
