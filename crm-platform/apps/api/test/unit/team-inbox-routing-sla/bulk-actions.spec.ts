import { describe, expect, it, vi } from 'vitest';
import type { BulkConversationAction } from '@crm/contracts';
import {
  RequestContextStore,
  type RequestContext,
} from '../../../src/common/context/request-context';
import { INBOX_PERMISSION } from '../../../src/modules/team-inbox-conversations';
import { BulkActionsService } from '../../../src/modules/team-inbox-routing-sla/bulk-actions.service';

const ID = '11111111-1111-4111-8111-111111111111';
const ctx: RequestContext = {
  requestId: 'r',
  orgId: 1,
  actorType: 'user',
  actorId: 1,
  userId: 1,
};
const markUnread: BulkConversationAction = { type: 'mark_unread' };

/** A bulk service whose collaborators answer from the test: the caller holds `granted`, and the thread has `unreadCount` unread. */
function serviceFor(opts: { granted: string[]; unreadCount: number; unreadAfter?: number }) {
  const conversations = {
    markUnread: vi.fn(async () => ({ unreadCount: opts.unreadAfter ?? 1 })),
  };
  const repo = {
    bulkProbe: vi.fn(
      async () => new Map([[ID, { rowVersion: 1, msgSeq: 3, unreadCount: opts.unreadCount }]]),
    ),
  };
  const access = {
    scopeOf: (_ctx: RequestContext, key: string) => (opts.granted.includes(key) ? 'all' : null),
  };
  const db = { tx: async (fn: (tx: unknown) => unknown) => fn({}) };
  const audit = { record: vi.fn(async () => undefined) };
  const service = new BulkActionsService(
    db as never,
    repo as never,
    access as never,
    audit as never,
    conversations as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, conversations };
}

const run = (service: BulkActionsService, action: BulkConversationAction) =>
  RequestContextStore.run(ctx, () => service.run({ ids: [ID], action }));

describe('BulkActionsService mark_unread', () => {
  it('marks a read thread unread and counts it done', async () => {
    const { service, conversations } = serviceFor({
      granted: [INBOX_PERMISSION.read],
      unreadCount: 0,
      unreadAfter: 1,
    });
    const res = await run(service, markUnread);
    expect(conversations.markUnread).toHaveBeenCalledWith(ID);
    expect(res).toMatchObject({
      done: 1,
      unchanged: 0,
      failed: 0,
      results: [{ id: ID, outcome: 'done' }],
    });
  });

  it('reports unchanged when the thread is already unread', async () => {
    const { service } = serviceFor({
      granted: [INBOX_PERMISSION.read],
      unreadCount: 2,
      unreadAfter: 2,
    });
    const res = await run(service, markUnread);
    expect(res).toMatchObject({
      done: 0,
      unchanged: 1,
      results: [{ id: ID, outcome: 'unchanged' }],
    });
  });

  it('is refused without the read permission, even when the caller can resolve', async () => {
    const { service, conversations } = serviceFor({
      granted: [INBOX_PERMISSION.resolve],
      unreadCount: 0,
    });
    await expect(run(service, markUnread)).rejects.toThrow(
      `Missing permission: ${INBOX_PERMISSION.read}`,
    );
    expect(conversations.markUnread).not.toHaveBeenCalled();
  });
});
