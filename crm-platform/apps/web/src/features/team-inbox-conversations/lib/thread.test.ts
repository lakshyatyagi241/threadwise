import { describe, expect, it } from 'vitest';
import type { MessageResponse } from '@crm/contracts';
import { id, message, note, outbound } from './fixtures';
import {
  EMPTY_THREAD,
  agentReactions,
  buildItems,
  firstSeq,
  hasGap,
  isAgentReaction,
  lastSeq,
  mergeMessages,
  pickMessage,
  threadReducer,
  type PendingSend,
  type ThreadState,
} from './thread';

const pending = (n: number, over: Partial<PendingSend> = {}): PendingSend => ({
  clientMessageId: id(2000 + n),
  kind: 'text',
  body: 'hi',
  media: null,
  status: 'sending',
  error: null,
  createdAt: '2026-10-02T10:30:00.000Z',
  ...over,
});

const loaded = (messages = [message(1), message(2)], hasMoreBefore = false): ThreadState =>
  threadReducer(EMPTY_THREAD, { type: 'loaded', messages, hasMoreBefore });

const status = (messageId: string, to: 'queued' | 'sent' | 'delivered' | 'read' | 'failed') =>
  ({
    type: 'status',
    messageId,
    clientMessageId: null,
    status: to,
    at: '2026-10-02T10:10:00.000Z',
  }) as const;

describe('merging by seq', () => {
  it('orders by seq and keeps one copy of each message', () => {
    const merged = mergeMessages([message(2), message(3)], [message(1), message(3)]);
    expect(merged.map((m) => m.seq)).toEqual([1, 2, 3]);
  });

  it('keeps the template preview a realtime copy of the message does not carry', () => {
    const tpl = (preview?: { header: null; footer: string; buttons: [] }) =>
      outbound(1, {
        kind: 'template',
        template: {
          templateId: null,
          name: 'n',
          language: null,
          variables: {},
          ...(preview ? { preview } : {}),
        },
      });
    const held = tpl({ header: null, footer: 'F', buttons: [] });
    const [merged] = mergeMessages([held], [tpl()]);
    expect(merged!.template!.preview).toEqual({ header: null, footer: 'F', buttons: [] });
  });

  it('never moves a tick backwards', () => {
    const read = outbound(1, { status: 'read', readAt: '2026-10-02T10:05:00.000Z' });
    const stale = outbound(1, { status: 'sent' });
    expect(pickMessage(read, stale).status).toBe('read');
    expect(pickMessage(read, stale).readAt).toBe('2026-10-02T10:05:00.000Z');
    expect(pickMessage(stale, read).status).toBe('read');
  });

  it('never lets a late "failed" replace delivered, and lets a retry out of failed', () => {
    const delivered = outbound(1, { status: 'delivered' });
    expect(pickMessage(delivered, outbound(1, { status: 'failed' })).status).toBe('delivered');
    const failed = outbound(1, {
      status: 'failed',
      failure: { code: 'SIM_REJECTED', reason: 'no' },
    });
    expect(pickMessage(failed, outbound(1, { status: 'queued' })).status).toBe('queued');
  });

  it('takes other changes from the newer copy even when its status is behind', () => {
    const old = outbound(1, { status: 'delivered', body: 'a' });
    const next = outbound(1, { status: 'sent', body: 'b' });
    const out = pickMessage(old, next);
    expect(out.body).toBe('b');
    expect(out.status).toBe('delivered');
  });
});

describe('optimistic sends', () => {
  it('shows a pending bubble and swaps it for the stored message with its clientMessageId', () => {
    let s = loaded();
    s = threadReducer(s, { type: 'send', pending: pending(5) });
    expect(s.pending).toHaveLength(1);
    s = threadReducer(s, {
      type: 'merge',
      messages: [outbound(3, { clientMessageId: id(2005) })],
    });
    expect(s.pending).toHaveLength(0);
    expect(lastSeq(s.messages)).toBe(3);
  });

  it('swaps it whether the socket or the 202 answer arrives first, without a duplicate', () => {
    let s = threadReducer(loaded(), { type: 'send', pending: pending(5) });
    const stored = outbound(3, { clientMessageId: id(2005) });
    s = threadReducer(s, { type: 'merge', messages: [stored] });
    s = threadReducer(s, { type: 'merge', messages: [{ ...stored, status: 'queued' }] });
    expect(s.messages.filter((m) => m.seq === 3)).toHaveLength(1);
    expect(s.pending).toHaveLength(0);
  });

  it('keeps a failed request for retry or dismissal', () => {
    let s = threadReducer(loaded(), { type: 'send', pending: pending(5) });
    s = threadReducer(s, { type: 'sendFailed', clientMessageId: id(2005), error: 'NETWORK' });
    expect(s.pending[0]).toMatchObject({ status: 'failed', error: 'NETWORK' });
    s = threadReducer(s, { type: 'sendRetry', clientMessageId: id(2005) });
    expect(s.pending[0]).toMatchObject({ status: 'sending', error: null });
    s = threadReducer(s, { type: 'dismiss', clientMessageId: id(2005) });
    expect(s.pending).toHaveLength(0);
  });

  it('replaces a pending entry in place when the same send is posted again', () => {
    let s = threadReducer(loaded(), { type: 'send', pending: pending(1) });
    s = threadReducer(s, { type: 'send', pending: pending(2) });
    s = threadReducer(s, { type: 'send', pending: pending(1, { body: 'edited' }) });
    expect(s.pending.map((p) => p.body)).toEqual(['edited', 'hi']);
  });
});

describe('statuses from the socket', () => {
  const base = () => loaded([message(1), outbound(2, { status: 'queued' })]);

  it('moves forward and stamps the time', () => {
    const s = threadReducer(base(), status(id(1002), 'delivered'));
    expect(s.messages[1]).toMatchObject({
      status: 'delivered',
      deliveredAt: '2026-10-02T10:10:00.000Z',
    });
  });

  it('survives out-of-order receipts: read, then delivered, then sent', () => {
    let s = base();
    for (const to of ['read', 'delivered', 'sent'] as const) {
      s = threadReducer(s, status(id(1002), to));
    }
    expect(s.messages[1]!.status).toBe('read');
  });

  it('finds the message by clientMessageId when the id is not known yet', () => {
    const s = threadReducer(base(), {
      ...status(id(9999), 'sent'),
      clientMessageId: id(2002),
    });
    expect(s.messages[1]!.status).toBe('sent');
  });

  it('ignores a status for a message that is not held and a failure over delivered', () => {
    const unknown = threadReducer(base(), status(id(9999), 'sent'));
    expect(unknown).toEqual(base());
    let s = threadReducer(base(), status(id(1002), 'delivered'));
    s = threadReducer(s, status(id(1002), 'failed'));
    expect(s.messages[1]!.status).toBe('delivered');
  });

  it('shows a failure and lets a retry bring it back to queued', () => {
    let s = threadReducer(base(), status(id(1002), 'failed'));
    expect(s.messages[1]!.status).toBe('failed');
    s = threadReducer(s, status(id(1002), 'queued'));
    expect(s.messages[1]!.status).toBe('queued');
  });
});

describe('paging and gaps', () => {
  it('adds older history above and updates the flag', () => {
    const s = threadReducer(loaded([message(5), message(6)], true), {
      type: 'older',
      messages: [message(3), message(4)],
      hasMoreBefore: false,
    });
    expect(s.messages.map((m) => m.seq)).toEqual([3, 4, 5, 6]);
    expect(s.hasMoreBefore).toBe(false);
    expect(firstSeq(s.messages)).toBe(3);
  });

  it('detects a message that skips ahead', () => {
    const held = [message(1), message(2)];
    expect(hasGap(held, 3)).toBe(false);
    expect(hasGap(held, 5)).toBe(true);
    expect(hasGap([], 5)).toBe(false);
  });

  it('resets for another conversation', () => {
    const s = threadReducer(loaded(), { type: 'reset', conversationId: id(5) });
    expect(s).toMatchObject({ conversationId: id(5), loaded: false, messages: [] });
  });
});

describe('buildItems', () => {
  it('puts a day separator before the first item of each local day', () => {
    const items = buildItems(
      [
        message(1, { createdAt: new Date(2026, 9, 1, 10).toISOString() }),
        message(2, { createdAt: new Date(2026, 9, 1, 11).toISOString() }),
        message(3, { createdAt: new Date(2026, 9, 2, 9).toISOString() }),
      ],
      [],
      [],
      false,
    );
    expect(items.map((i) => i.kind)).toEqual(['day', 'message', 'message', 'day', 'message']);
  });

  it('slots internal notes in by time and puts sends in flight last', () => {
    const items = buildItems(
      [message(1), message(2), message(3)],
      [note(1, '2026-10-02T10:02:30.000Z')],
      [pending(1, { createdAt: '2026-10-02T11:00:00.000Z' })],
      false,
    );
    expect(items.filter((i) => i.kind !== 'day').map((i) => i.kind)).toEqual([
      'message',
      'message',
      'note',
      'message',
      'pending',
    ]);
  });

  it('holds back notes older than the oldest message while earlier history is unloaded', () => {
    const early = note(1, '2026-10-02T09:00:00.000Z');
    const withMore = buildItems([message(5)], [early], [], true);
    expect(withMore.some((i) => i.kind === 'note')).toBe(false);
    const complete = buildItems([message(5)], [early], [], false);
    expect(complete.some((i) => i.kind === 'note')).toBe(true);
  });
});

describe('agent reactions', () => {
  const target = message(1);
  const reaction = (seq: number, emoji: string, over: Partial<MessageResponse> = {}) =>
    outbound(seq, {
      kind: 'reaction',
      body: emoji === '' ? null : emoji,
      replyToMessageId: target.id,
      status: 'sent',
      ...over,
    });

  it('is a reaction we sent, not one a customer sent', () => {
    expect(isAgentReaction(reaction(2, '👍'))).toBe(true);
    expect(isAgentReaction(message(3, { kind: 'reaction' }))).toBe(false);
    expect(isAgentReaction(outbound(4))).toBe(false);
  });

  it('draws no bubble for it', () => {
    const items = buildItems([target, reaction(2, '👍')], [], [], false);
    expect(items.filter((i) => i.kind === 'message')).toHaveLength(1);
  });

  it('keeps the newest reaction per message', () => {
    const r = agentReactions([target, reaction(2, '👍'), reaction(3, '❤️')]);
    expect(r.get(target.id)).toMatchObject({ emoji: '❤️', status: 'sent' });
  });

  it('clears the reaction when it is taken back', () => {
    expect(agentReactions([target, reaction(2, '👍'), reaction(3, '')]).has(target.id)).toBe(false);
  });

  it('keeps a reaction whose removal was refused', () => {
    const r = agentReactions([target, reaction(2, '👍'), reaction(3, '', { status: 'failed' })]);
    expect(r.get(target.id)?.emoji).toBe('👍');
  });

  it('reports a refused reaction as failed, never hides it', () => {
    const r = agentReactions([target, reaction(2, '👍', { status: 'failed' })]);
    expect(r.get(target.id)?.status).toBe('failed');
  });
});
