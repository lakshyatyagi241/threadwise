import { describe, expect, it } from 'vitest';
import { LeadChatDigestService } from '../../../src/modules/lead-scoring/lead-chat-digest.service';
import { LeadScoringService } from '../../../src/modules/lead-scoring/lead-scoring.service';

/**
 * BullMQ ignores an `add` whose job id still exists. Lead scoring keeps a failed job for 24h under the per-contact id, so one failed
 * score used to make every later enqueue for that contact a silent no-op (#1263). A failed job is removed first; the add then goes
 * through as usual.
 */
function fakeQueue(state: string) {
  const calls: string[] = [];
  const queue = {
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

// The services are built without their constructors: enqueue only touches the queue, and the other dependencies are not needed.
function withQueue<T>(proto: object, queue: unknown): T {
  return Object.assign(Object.create(proto), { queue }) as T;
}

describe('lead scoring enqueue after a failed attempt', () => {
  it('a failed score job is removed before the new one is added', async () => {
    const { queue, calls } = fakeQueue('failed');
    const svc = withQueue<LeadScoringService>(LeadScoringService.prototype, queue);
    await svc.enqueue({ orgId: 1, contactId: 7 } as never);
    expect(calls).toEqual(['state', 'remove', 'add']);
  });

  it('a waiting score job is left alone (the per-contact dedup)', async () => {
    const { queue, calls } = fakeQueue('waiting');
    const svc = withQueue<LeadScoringService>(LeadScoringService.prototype, queue);
    await svc.enqueue({ orgId: 1, contactId: 7 } as never);
    expect(calls).toEqual(['state', 'add']);
  });

  it('a failed chat-digest job is removed before the new one is added', async () => {
    const { queue, calls } = fakeQueue('failed');
    const svc = withQueue<LeadChatDigestService>(LeadChatDigestService.prototype, queue);
    await svc.enqueue({ orgId: 1, contactId: 7 } as never);
    expect(calls).toEqual(['state', 'remove', 'add']);
  });
});
