import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';
import { AwayService } from '../../../src/modules/team-inbox-routing-sla/away.service';

/**
 * Chat idle rules (legacy #15590, #15593): an agent-held chat with no message for the chosen minutes is resolved, and a message that lands
 * between the list and the lock keeps the chat open. No database: the transaction is a fake that answers by the SQL text it receives.
 */
const dialect = new PgDialect();
const text = (q: unknown): string => dialect.sqlToQuery(q as never).sql;

function build(opts: { entitled?: boolean; stillIdle?: boolean; status?: string } = {}) {
  const { entitled = true, stillIdle = true, status = 'open' } = opts;
  const tx = {
    execute: vi.fn(async (q: unknown) => {
      const s = text(q);
      if (s.includes('ORDER BY c.last_message_at')) return { rows: [{ uuid: 'conv-1' }] };
      if (s.includes('ORDER BY c.waiting_since')) return { rows: [] };
      if (s.includes('SELECT 1 FROM conversations')) return { rows: stillIdle ? [{}] : [] };
      return { rows: [] };
    }),
  };
  const db = {
    privileged: async (fn: (t: unknown) => unknown) =>
      fn({
        execute: async () => ({ rows: [{ org_id: 7, r: null, c: 30 }] }),
      }),
    txAs: async (_ctx: unknown, fn: (t: unknown) => unknown) => fn(tx),
  };
  const conversations = {
    lockByUuid: vi.fn(async () => ({ id: 1, status, assigneeUserId: 5 })),
    setStatus: vi.fn(async () => undefined),
    byUuid: vi.fn(async () => ({
      rowVersion: 3,
      assigneeUserId: 5,
      assigneeTeamId: null,
      channelOwnerUserId: null,
    })),
  };
  const events = { append: vi.fn(async () => undefined) };
  const outbox = { emit: vi.fn(async () => undefined) };
  const publisher = { conversationChanged: vi.fn(async () => undefined) };
  const entitlements = { featureEnabled: vi.fn(async () => entitled) };
  const svc = new AwayService(
    db as never,
    {} as never,
    {} as never,
    conversations as never,
    outbox as never,
    entitlements as never,
    {} as never,
    events as never,
    publisher as never,
  );
  return { svc, conversations, events, outbox, publisher };
}

describe('chat idle rules', () => {
  it('resolves an idle agent-held chat, records why, and tells the inbox', async () => {
    const { svc, conversations, events, outbox, publisher } = build();
    const r = await svc.sweepIdle(new Date('2026-10-30T10:00:00Z'));
    expect(r).toEqual({ returned: 0, closed: 1 });
    expect(conversations.setStatus).toHaveBeenCalledWith(expect.anything(), 7, 1, {
      status: 'resolved',
      resolvedAt: 'now',
      resolvedBy: null,
      clearSnooze: false,
    });
    expect(events.append).toHaveBeenCalledWith(
      expect.anything(),
      7,
      expect.objectContaining({ type: 'resolved', actorKind: 'system' }),
    );
    expect(outbox.emit).toHaveBeenCalledTimes(1);
    expect(publisher.conversationChanged).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ uuid: 'conv-1', rowVersion: 3 }),
      ['status'],
    );
  });

  it('leaves the chat open when a message arrived after the list was read', async () => {
    const { svc, conversations, publisher } = build({ stillIdle: false });
    expect((await svc.sweepIdle()).closed).toBe(0);
    expect(conversations.setStatus).not.toHaveBeenCalled();
    expect(publisher.conversationChanged).not.toHaveBeenCalled();
  });

  it('does not touch a chat that is no longer open', async () => {
    const { svc, conversations } = build({ status: 'resolved' });
    expect((await svc.sweepIdle()).closed).toBe(0);
    expect(conversations.setStatus).not.toHaveBeenCalled();
  });

  it('does nothing for a workspace whose plan lacks automatic assignment', async () => {
    const { svc, conversations } = build({ entitled: false });
    expect(await svc.sweepIdle()).toEqual({ returned: 0, closed: 0 });
    expect(conversations.setStatus).not.toHaveBeenCalled();
  });
});
