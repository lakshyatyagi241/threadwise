import { describe, expect, it } from 'vitest';
import {
  historySocketConfig,
  readHistoryEvent,
  SYNC_TYPE,
  type RawHistoryEvent,
} from '../../../src/infra/providers/node-bridge-runtime/history-sync';

const NOW = new Date('2026-10-05T12:00:00Z');
const ts = (daysAgo: number) => Math.floor(NOW.getTime() / 1000) - daysAgo * 86_400;
const opts = { now: NOW, windowDays: 90, batchSize: 2, selfDigits: '919000000001' };

const raw = (
  id: string,
  remoteJid: string,
  over: Record<string, unknown> = {},
): NonNullable<RawHistoryEvent['messages']>[number] =>
  ({
    message: { conversation: `text ${id}` },
    messageTimestamp: ts(1),
    pushName: 'Asha',
    ...over,
    key: { id, remoteJid, fromMe: false, ...(over.key as object) },
  }) as never;

describe('the socket settings of the history choice', () => {
  it('a number that did not opt in is built exactly as before: no sync, nothing downloaded', () => {
    const c = historySocketConfig('none');
    expect(c.syncFullHistory).toBe(false);
    for (const t of Object.values(SYNC_TYPE))
      expect(c.shouldSyncHistoryMessage({ syncType: t })).toBe(false);
  });

  it('recent takes the first-link chunks and the names, does not ask for the full history and never takes on-demand', () => {
    const c = historySocketConfig('recent');
    expect(c.syncFullHistory).toBe(false);
    expect(c.shouldSyncHistoryMessage({ syncType: SYNC_TYPE.INITIAL_BOOTSTRAP })).toBe(true);
    expect(c.shouldSyncHistoryMessage({ syncType: SYNC_TYPE.RECENT })).toBe(true);
    expect(c.shouldSyncHistoryMessage({ syncType: SYNC_TYPE.PUSH_NAME })).toBe(true);
    expect(c.shouldSyncHistoryMessage({ syncType: SYNC_TYPE.FULL })).toBe(false);
    expect(c.shouldSyncHistoryMessage({ syncType: SYNC_TYPE.ON_DEMAND })).toBe(false);
    expect(c.shouldSyncHistoryMessage({})).toBe(false);
  });

  it('full asks for the full history and also takes its chunks', () => {
    const c = historySocketConfig('full');
    expect(c.syncFullHistory).toBe(true);
    expect(c.shouldSyncHistoryMessage({ syncType: SYNC_TYPE.FULL })).toBe(true);
    expect(c.shouldSyncHistoryMessage({ syncType: SYNC_TYPE.RECENT })).toBe(true);
    expect(c.shouldSyncHistoryMessage({ syncType: SYNC_TYPE.ON_DEMAND })).toBe(false);
  });
});

describe('one history event as bounded batches', () => {
  it('keeps both directions of a person chat, dated as sent', () => {
    const [b] = readHistoryEvent(
      {
        syncType: SYNC_TYPE.RECENT,
        progress: 40,
        messages: [
          raw('A1', '919800000001@s.whatsapp.net'),
          raw('A2', '919800000001@s.whatsapp.net', { key: { fromMe: true } }),
        ],
      },
      opts,
    );
    expect(b!.syncType).toBe('recent');
    expect(b!.progress).toBe(40);
    expect(b!.messages.map((m) => m.kind)).toEqual(['inbound', 'echo']);
    expect(b!.messages[0]!.message.timestamp.toISOString()).toBe(
      new Date(ts(1) * 1000).toISOString(),
    );
  });

  it('drops status, newsletters, broadcast lists, bots, empty protocol messages and reactions, and counts them', () => {
    const batches = readHistoryEvent(
      {
        syncType: SYNC_TYPE.RECENT,
        messages: [
          raw('S', 'status@broadcast'),
          raw('N', '120363@newsletter'),
          raw('L', '1234@broadcast'),
          raw('B', '1313@bot'),
          raw('P', '919800000001@s.whatsapp.net', { message: { protocolMessage: {} } }),
          raw('R', '919800000001@s.whatsapp.net', {
            message: { reactionMessage: { text: '👍', key: { id: 'X' } } },
          }),
          raw('OK', '919800000001@s.whatsapp.net'),
        ],
      },
      { ...opts, batchSize: 50 },
    );
    expect(batches).toHaveLength(1);
    expect(batches[0]!.messages.map((m) => m.message.providerMessageId)).toEqual(['OK']);
    expect(batches[0]!.skipped).toBe(6);
  });

  it('applies the window: a message older than the days is left out, one inside is kept', () => {
    const [b] = readHistoryEvent(
      {
        messages: [
          raw('OLD', '919800000001@s.whatsapp.net', { messageTimestamp: ts(91) }),
          raw('NEW', '919800000001@s.whatsapp.net', { messageTimestamp: ts(89) }),
        ],
      },
      opts,
    );
    expect(b!.messages.map((m) => m.message.providerMessageId)).toEqual(['NEW']);
    expect(b!.skipped).toBe(1);
  });

  it("skips the number's own chat but keeps groups", () => {
    const [b] = readHistoryEvent(
      {
        messages: [
          raw('SELF', '919000000001@s.whatsapp.net', { key: { fromMe: true } }),
          raw('G1', '120363000000000001@g.us', {
            key: { participant: '919800000002@s.whatsapp.net' },
          }),
        ],
      },
      opts,
    );
    expect(b!.messages.map((m) => [m.kind, m.message.providerMessageId])).toEqual([
      ['group', 'G1'],
    ]);
  });

  it('gives an anonymous-id chat its number when WhatsApp names it, and leaves it anonymous otherwise', () => {
    const [b] = readHistoryEvent(
      {
        contacts: [
          { id: '5551@lid', jid: '919800000003@s.whatsapp.net', lid: '5551@lid', name: 'Ravi' },
        ],
        messages: [raw('L1', '5551@lid'), raw('L2', '7777@lid')],
      },
      { ...opts, batchSize: 50 },
    );
    const [a, c] = b!.messages.map((m) => m.message.chat);
    expect(a).toMatchObject({ phone: '919800000003', jid: '919800000003@s.whatsapp.net' });
    expect(c).toMatchObject({ phone: null, lid: '7777' });
  });

  it('cuts a big event into slices of at most batchSize, in order, with `last` only on the final one', () => {
    const messages = Array.from({ length: 5 }, (_, i) =>
      raw(`M${i}`, '919800000001@s.whatsapp.net'),
    );
    const batches = readHistoryEvent({ syncType: SYNC_TYPE.FULL, progress: 100, messages }, opts);
    expect(batches.map((b) => b.messages.length)).toEqual([2, 2, 1]);
    expect(batches.map((b) => b.last)).toEqual([false, false, true]);
    expect(batches.flatMap((b) => b.messages.map((m) => m.message.providerMessageId))).toEqual([
      'M0',
      'M1',
      'M2',
      'M3',
      'M4',
    ]);
  });

  it('a batch carries only the names of its own chats, so it stays small however big the event was', () => {
    const batches = readHistoryEvent(
      {
        chats: [
          { id: '919800000001@s.whatsapp.net', name: 'Asha' },
          { id: '919800000002@s.whatsapp.net', name: 'Ravi' },
        ],
        messages: [
          raw('A', '919800000001@s.whatsapp.net'),
          raw('B', '919800000002@s.whatsapp.net'),
        ],
      },
      { ...opts, batchSize: 1 },
    );
    expect(batches.map((b) => b.chats.map((c) => c.name))).toEqual([['Asha'], ['Ravi']]);
  });

  it('an event with nothing to import still gives one batch, for its progress', () => {
    const batches = readHistoryEvent({ syncType: SYNC_TYPE.PUSH_NAME, progress: 100 }, opts);
    expect(batches).toEqual([
      {
        syncType: 'push_name',
        progress: 100,
        chats: [],
        contacts: [],
        messages: [],
        skipped: 0,
        last: true,
      },
    ]);
  });

  it('a progress figure outside 0 to 100 is clamped and a missing one is null', () => {
    expect(readHistoryEvent({ progress: 250 }, opts)[0]!.progress).toBe(100);
    expect(readHistoryEvent({}, opts)[0]!.progress).toBeNull();
  });
});
