import { describe, expect, it } from 'vitest';
import {
  PLAN_FEATURE_KEYS,
  REALTIME_EVENT,
  realtimeEventSchemas,
  historyImportModeSchema,
  historyImportStatusSchema,
  isHistoryImportActive,
  NOT_REQUESTED_STATUS,
  startPairingInputSchema,
} from '@crm/contracts';
import type { Normalized } from '../../../src/modules/node-bridge-runtime';
import type { InboundMessage } from '../../../src/infra/providers/node-bridge-runtime/inbound.port';
import {
  isFinalBatch,
  isIdle,
  isStale,
  nameForChat,
  peerKeyOf,
  planBatch,
  toIngest,
  type RunUsage,
} from '../../../src/modules/whatsapp-devices-baileys/history-import-rules';
import { toHistoryStatus } from '../../../src/modules/whatsapp-devices-baileys/history-import.mapper';

const person = (
  phone: string,
  id: string,
  at: number,
  over: Partial<InboundMessage> = {},
): Normalized => ({
  kind: over.fromMe ? 'echo' : 'inbound',
  message: {
    providerMessageId: id,
    chat: { jid: `${phone}@s.whatsapp.net`, phone, lid: null, isGroup: false },
    fromMe: false,
    participant: null,
    pushName: 'Push',
    timestamp: new Date(at),
    text: `t${id}`,
    media: null,
    location: null,
    contact: null,
    reaction: null,
    forwarded: null,
    ...over,
  },
});
const group = (
  gid: string,
  id: string,
  at: number,
  over: Partial<InboundMessage> = {},
): Normalized => ({
  kind: 'group',
  message: {
    providerMessageId: id,
    chat: { jid: `${gid}@g.us`, phone: null, lid: null, isGroup: true },
    fromMe: false,
    participant: { phone: '919800000002', lid: null, name: 'Ravi' },
    pushName: 'Ravi',
    timestamp: new Date(at),
    text: `g${id}`,
    media: null,
    location: null,
    contact: null,
    reaction: null,
    forwarded: null,
    ...over,
  },
});

const caps = { maxMessages: 10, maxMessagesPerChat: 3, maxChats: 2 };
const none: RunUsage = { messages: 0, perChat: new Map(), chats: new Set() };
const empty = { chats: [], contacts: [] };

describe('thread keys', () => {
  it('a person is keyed by number, else by their anonymous id; a group by its bare id', () => {
    expect(peerKeyOf(person('919800000001', 'a', 1).message)).toBe('919800000001');
    expect(
      peerKeyOf({
        ...person('x', 'a', 1).message,
        chat: { jid: '77@lid', phone: null, lid: '77', isGroup: false },
      }),
    ).toBe('77');
    expect(peerKeyOf(group('120363000000000001', 'a', 1).message)).toBe('120363000000000001');
  });
});

describe('the caps', () => {
  it('per chat the newest messages win the room, and the thread is returned oldest first', () => {
    const plan = planBatch(
      { ...empty, messages: [1, 2, 3, 4, 5].map((i) => person('919800000001', `m${i}`, i * 1000)) },
      caps,
      none,
    );
    expect(plan.chats[0]!.messages.map((m) => m.providerMessageId)).toEqual(['m3', 'm4', 'm5']);
    expect(plan.skippedByCap).toBe(2);
  });

  it('what a chat already stored in earlier batches counts against its quota', () => {
    const plan = planBatch(
      { ...empty, messages: [person('919800000001', 'n1', 1), person('919800000001', 'n2', 2)] },
      caps,
      { messages: 2, perChat: new Map([['919800000001', 2]]), chats: new Set(['919800000001']) },
    );
    expect(plan.chats[0]!.messages).toHaveLength(1);
    expect(plan.chats[0]!.firstSeen).toBe(false);
  });

  it('the number cap trims what is left and stops the run', () => {
    const plan = planBatch(
      {
        ...empty,
        messages: [
          person('919800000001', 'a', 1),
          person('919800000001', 'b', 2),
          person('919800000001', 'c', 3),
        ],
      },
      { ...caps, maxMessages: 4 },
      { ...none, messages: 2 },
    );
    expect(plan.chats[0]!.messages).toHaveLength(2);
    expect(plan.stop).toBe('message_cap_reached');
  });

  it('a chat over the chat cap is skipped and stops the run, groups count as chats', () => {
    const plan = planBatch(
      {
        ...empty,
        messages: [
          person('919800000001', 'a', 1),
          group('120363000000000001', 'b', 2),
          person('919800000003', 'c', 3),
        ],
      },
      caps,
      none,
    );
    expect(plan.chats.map((c) => c.peerKey)).toEqual(['919800000001', '120363000000000001']);
    expect(plan.skippedByCap).toBe(1);
    expect(plan.stop).toBe('chat_cap_reached');
  });

  it('a chat the run already knows is never refused by the chat cap', () => {
    const plan = planBatch({ ...empty, messages: [person('919800000003', 'c', 3)] }, caps, {
      ...none,
      chats: new Set(['919800000001', '919800000003']),
    });
    expect(plan.chats).toHaveLength(1);
    expect(plan.stop).toBeNull();
  });
});

describe('a message as the inbox takes it', () => {
  const plan = (n: Normalized, names: { chats?: never[]; contacts?: never[] } = {}) =>
    planBatch({ ...empty, ...names, messages: [n] }, caps, none).chats[0]!;

  it('a person chat is quiet history that links a contact, named by the phone book first', () => {
    const n = person('919800000001', 'a', 1000);
    const p = planBatch(
      {
        messages: [n],
        chats: [{ jid: '919800000001@s.whatsapp.net', name: 'Chat name' }],
        contacts: [
          {
            jid: '919800000001@s.whatsapp.net',
            phoneJid: null,
            name: 'Saved name',
            notify: 'Their name',
          },
        ],
      },
      caps,
      none,
    ).chats[0]!;
    const i = toIngest(p.messages[0]!, p);
    expect(i).toMatchObject({
      peerKey: '919800000001',
      peerName: 'Saved name',
      kind: 'text',
      body: 'ta',
      history: { direction: 'in', contact: true },
    });
  });

  it("without a saved or chat name the person's own name is used, then the push name of an inbound message", () => {
    const m = person('919800000001', 'a', 1).message;
    expect(
      nameForChat(
        m,
        [],
        [{ jid: '919800000001@s.whatsapp.net', phoneJid: null, name: null, notify: 'Their name' }],
      ),
    ).toBe('Their name');
    const p = plan(person('919800000001', 'a', 1));
    expect(toIngest(p.messages[0]!, p).peerName).toBe('Push');
  });

  it('what the business typed on the phone is outbound history', () => {
    const p = plan(person('919800000001', 'a', 1, { fromMe: true }));
    expect(toIngest(p.messages[0]!, p).history).toMatchObject({ direction: 'out' });
    expect(toIngest(p.messages[0]!, p).peerName).toBeUndefined();
  });

  it('media is not brought in: a placeholder with its caption, flagged as omitted', () => {
    const p = plan(
      person('919800000001', 'a', 1, {
        text: 'look',
        media: { kind: 'image', mimeType: 'image/jpeg', fileName: null, sizeBytes: 10 },
      }),
    );
    const i = toIngest(p.messages[0]!, p);
    expect(i.kind).toBe('text');
    expect(i.body).toBe('[Photo] look');
    expect(i.media).toBeUndefined();
    expect(i.meta).toMatchObject({ mediaOmitted: 'image' });
  });

  it('a group message goes to the group thread, names the speaker and never links a contact', () => {
    const p = planBatch(
      {
        messages: [group('120363000000000001', 'g1', 5)],
        chats: [{ jid: '120363000000000001@g.us', name: 'Team' }],
        contacts: [],
      },
      caps,
      none,
    ).chats[0]!;
    const i = toIngest(p.messages[0]!, p);
    expect(i.peerKey).toBe('120363000000000001');
    expect(i.peerName).toBeUndefined();
    expect(i.group).toMatchObject({
      title: 'Team',
      participant: '919800000002',
      participantName: 'Ravi',
    });
    expect(i.history).toEqual({ direction: 'in' });
  });

  it('a person known only by an anonymous id gets a thread but no contact', () => {
    const lidOnly = person('x', 'a', 1, {
      chat: { jid: '77@lid', phone: null, lid: '77', isGroup: false },
    });
    const p = plan(lidOnly);
    expect(p.phone).toBeNull();
    expect(toIngest(p.messages[0]!, p).history).toEqual({ direction: 'in' });
  });

  it('a location, a contact card and an unsupported type keep their kind', () => {
    const loc = plan(
      person('919800000001', 'a', 1, {
        text: null,
        location: { latitude: 1, longitude: 2, name: 'Shop', address: null },
      }),
    );
    expect(toIngest(loc.messages[0]!, loc)).toMatchObject({
      kind: 'location',
      location: { latitude: 1, longitude: 2, name: 'Shop' },
    });
    const un = plan(
      person('919800000001', 'a', 1, {
        text: null,
        unsupported: { rawType: 'pollCreationMessage', label: 'Poll' },
      }),
    );
    expect(toIngest(un.messages[0]!, un)).toMatchObject({
      kind: 'unsupported',
      body: '[Poll message]',
    });
  });
});

describe('when a run ends', () => {
  it('the last slice of the final sync type at 100 finishes it; anything else waits for silence', () => {
    expect(isFinalBatch('recent', { syncType: 'recent', progress: 100, last: true })).toBe(true);
    expect(isFinalBatch('recent', { syncType: 'recent', progress: 100, last: false })).toBe(false);
    expect(isFinalBatch('recent', { syncType: 'recent', progress: 60, last: true })).toBe(false);
    expect(
      isFinalBatch('recent', { syncType: 'initial_bootstrap', progress: 100, last: true }),
    ).toBe(false);
    expect(isFinalBatch('full', { syncType: 'recent', progress: 100, last: true })).toBe(false);
    expect(isFinalBatch('full', { syncType: 'full', progress: 100, last: true })).toBe(true);
  });

  it('idle and stale are measured from the last batch and from the request', () => {
    const now = new Date('2026-10-05T12:00:00Z');
    expect(isIdle(new Date(now.getTime() - 181_000), now, 180)).toBe(true);
    expect(isIdle(new Date(now.getTime() - 100_000), now, 180)).toBe(false);
    expect(isIdle(null, now, 180)).toBe(false);
    expect(isStale(new Date(now.getTime() - 31 * 60_000), now, 30)).toBe(true);
    expect(isStale(new Date(now.getTime() - 5 * 60_000), now, 30)).toBe(false);
  });
});

describe('the contract', () => {
  it('a pairing start defaults to no import, so an old client changes nothing', () => {
    expect(startPairingInputSchema.parse({}).importHistory).toBe('none');
    expect(startPairingInputSchema.parse({ importHistory: 'recent' }).importHistory).toBe('recent');
    expect(historyImportModeSchema.safeParse('everything').success).toBe(false);
  });

  it('a device that never opted in reads not_requested and is a valid status', () => {
    expect(toHistoryStatus(null)).toEqual(NOT_REQUESTED_STATUS);
    expect(historyImportStatusSchema.safeParse(NOT_REQUESTED_STATUS).success).toBe(true);
    expect(isHistoryImportActive('idle')).toBe(true);
    expect(isHistoryImportActive('running')).toBe(true);
    expect(isHistoryImportActive('done')).toBe(false);
  });

  it('a run row becomes a status without any internal id, and an unknown error code is not exposed', () => {
    const s = toHistoryStatus({
      state: 'limit_reached',
      mode: 'recent',
      chats_count: 3,
      contacts_count: 2,
      messages_count: 40,
      progress: 55,
      window_days: 90,
      started_at: new Date('2026-10-05T12:00:00Z'),
      finished_at: new Date('2026-10-05T12:05:00Z'),
      error_code: 'contact_limit_reached',
    });
    expect(s).toMatchObject({
      state: 'limit_reached',
      chats: 3,
      contacts: 2,
      messages: 40,
      lastError: { code: 'contact_limit_reached' },
    });
    expect(
      toHistoryStatus({
        state: 'done',
        mode: 'full',
        error_code: 'weird',
      } as never).lastError,
    ).toBeNull();
  });
});

describe('the plan feature and the realtime hint of the follow-ups', () => {
  it('the full history is a registered plan feature', () => {
    expect(PLAN_FEATURE_KEYS).toContain('personal_history_full');
  });

  it('the hint carries a number uuid and a final state, and nothing else', () => {
    const schema = realtimeEventSchemas[REALTIME_EVENT.historyImported];
    const deviceId = '11111111-1111-4111-8111-111111111111';
    expect(schema.safeParse({ deviceId, state: 'done' }).success).toBe(true);
    expect(schema.safeParse({ deviceId, state: 'cancelled' }).success).toBe(true);
    expect(schema.safeParse({ deviceId, state: 'running' }).success).toBe(false);
    expect(schema.safeParse({ deviceId: 'nope', state: 'done' }).success).toBe(false);
    expect(REALTIME_EVENT.historyImported).toBe('inbox.history.imported');
  });
});
