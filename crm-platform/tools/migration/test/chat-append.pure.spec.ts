import { describe, expect, it } from 'vitest';
import { buildChatPlan, threadUuid, type ChatPlan } from '../inbox/plan';
import type { InboxSettings } from '../inbox/config';
import type { Source } from '../extract/source';
import { oracleChat } from '../reconcile/oracle-chat';

/**
 * Pure (no database): appending newer Waboo turns to a thread that is already loaded. The loader's planner (inbox/plan.ts) and the
 * independent oracle (reconcile/oracle-chat.ts) must agree on: which threads are appended, which are left as loaded because a newer
 * dumped turn sorts before a loaded one (APPEND_OUT_OF_ORDER), and the counters of the whole thread. Values are invented.
 */
const EXT = '110000000000001';
const PEER = '919812345671';
const PEER2 = '919812345672';
const CLIENT = 'acme';
const settings: InboxSettings = {
  map: { b1: { kind: 'whatsapp_cloud', externalId: EXT, displayAddress: null, name: 'Main' } },
  mapSha256: 'x',
  keepDeletedContactChats: false,
  threadStatus: 'waboo',
  assignAgents: false,
  windowHours: 24,
};
const REF = '2026-10-09T00:00:00.000Z';
const id = (n: number): string => `69e4ca40a756f598c2${String(n).padStart(6, '0')}`;
const at = (sec: number): string => `2026-04-19T12:00:${String(sec).padStart(2, '0')}.000Z`;

interface T {
  n: number; // id and sort tie-break
  sec: number;
  dir: 'in' | 'out';
  text: string;
  peer?: string;
  provider?: string;
}
const doc = (t: T): Record<string, unknown> => ({
  _id: id(t.n),
  createdAt: new Date(at(t.sec)),
  botid: 'b1',
  channel: 'whatsapp',
  session_id: 's1',
  context: {},
  user: { mobile: t.peer ?? PEER, conversation_status: 'Open' },
  ...(t.provider ? { meta_msg_id: t.provider } : {}),
  ...(t.dir === 'in'
    ? { user_query_object: { isUser: true, type: 'text', value: t.text }, user_query: t.text }
    : { bot_response: { type: 'Flow', response: [{ type: 'text', value: t.text }] } }),
});

const sourceOf = (docs: Array<Record<string, unknown>>): Source =>
  ({
    async *readIndexed() {
      let off = 0;
      for (const d of docs) yield { doc: d as never, offset: off++, length: 1 };
    },
  }) as unknown as Source;

async function plan(
  turns: T[],
  o: { loaded?: number[]; existing?: Record<string, string>; ledgerOwned?: string[] } = {},
): Promise<ChatPlan> {
  const loaded = new Set((o.loaded ?? []).map(id));
  return buildChatPlan({
    source: sourceOf(turns.map(doc)),
    client: CLIENT,
    settings,
    referenceAt: REF,
    ref: () => undefined,
    contactDeleted: new Set(),
    hasUsers: false,
    contactsByDigits: new Map(),
    existingThreads: new Map(Object.entries(o.existing ?? {})),
    migrated: (k) => loaded.has(k),
    ledgerOwned: o.ledgerOwned ? new Set(o.ledgerOwned) : undefined,
  });
}

const TK = `${EXT}|${PEER}`;
const mine = { [TK]: threadUuid(CLIENT, EXT, PEER) };
const three: T[] = [
  { n: 1, sec: 1, dir: 'in', text: 'hello' },
  { n: 2, sec: 2, dir: 'out', text: 'hi there' },
  { n: 3, sec: 3, dir: 'in', text: 'thanks, bye' },
];

describe('planner: a loaded thread with newer turns', () => {
  it('appends: loaded prefix keeps its seq, new turns continue it, counters are those of the whole thread', async () => {
    const p = await plan(three, { loaded: [1, 2], existing: mine });
    expect(p.partial).toEqual([]);
    expect(p.outOfOrder).toEqual([]);
    const t = p.threads.get(TK)!;
    expect([t.loaded, t.msgSeq]).toEqual([2, 3]);
    expect(t.docs.map((k) => p.docs.get(k)!.seq)).toEqual([1, 2, 3]);
    expect(t.preview).toBe('thanks, bye');
    expect(t.lastMessageAt).toBe(new Date(at(3)).toISOString());
    expect(t.lastInboundAt).toBe(new Date(at(3)).toISOString());
    expect(t.lastOutboundAt).toBe(new Date(at(2)).toISOString());
    expect(t.windowExpiresAt).toBe(new Date(Date.parse(at(3)) + 24 * 3_600_000).toISOString());
    expect(t.createdAt).toBe(new Date(at(1)).toISOString());
  });

  it('nothing new: done (loaded = msgSeq); nothing loaded and no conversation: new (loaded 0)', async () => {
    const done = await plan(three, { loaded: [1, 2, 3], existing: mine });
    expect(done.partial).toEqual([]);
    expect([done.threads.get(TK)!.loaded, done.threads.get(TK)!.msgSeq]).toEqual([3, 3]);
    const fresh = await plan(three);
    expect(fresh.threads.get(TK)!.loaded).toBe(0);
  });

  it('a newer turn sorting BEFORE a loaded one: the thread stays as loaded, the turn is quarantined APPEND_OUT_OF_ORDER', async () => {
    const turns: T[] = [
      { n: 1, sec: 1, dir: 'in', text: 'hello' },
      { n: 3, sec: 3, dir: 'in', text: 'last loaded' },
      { n: 2, sec: 2, dir: 'out', text: 'late arrival in the middle' },
      { n: 4, sec: 4, dir: 'in', text: 'also new, after' },
    ];
    const p = await plan(turns, { loaded: [1, 3], existing: mine });
    expect(p.outOfOrder).toEqual([TK]);
    expect(p.partial).toEqual([]);
    const t = p.threads.get(TK)!;
    expect([t.loaded, t.msgSeq]).toEqual([2, 2]); // as loaded: the newer turn after it is NOT added either (never guess)
    expect(t.preview).toBe('last loaded');
    for (const n of [2, 4]) {
      const d = p.docs.get(id(n))!;
      expect([d.state, d.code]).toEqual(['quarantine', 'APPEND_OUT_OF_ORDER']);
    }
    expect(p.docs.get(id(1))!.seq).toBe(1);
    expect(p.docs.get(id(3))!.seq).toBe(2);
    expect(p.tally['quarantine:APPEND_OUT_OF_ORDER']).toBe(2);
  });

  it('same millisecond: the document key breaks the tie, so a smaller key than a loaded one is out of order', async () => {
    const p = await plan(
      [
        { n: 5, sec: 1, dir: 'in', text: 'loaded, larger key' },
        { n: 4, sec: 1, dir: 'out', text: 'new, smaller key, same time' },
      ],
      { loaded: [5], existing: mine },
    );
    expect(p.outOfOrder).toEqual([TK]);
  });

  it('half loaded for another reason stays PARTIAL: mapped turns but no conversation; conversation but nothing mapped', async () => {
    expect((await plan(three, { loaded: [1, 2] })).partial).toEqual([TK]);
    expect((await plan(three, { existing: mine })).partial).toEqual([TK]);
  });

  it('a conversation that this migration did not make is still a live thread (nothing merged)', async () => {
    const p = await plan(three, { loaded: [1], existing: { [TK]: '00000000-0000-4000-8000-000000000000' } });
    expect(p.docs.get(id(2))!.code).toBe('THREAD_HAS_LIVE_MESSAGES');
    expect(p.threads.size).toBe(0);
  });

  it('brand-new threads next to appended ones are loaded whole; each thread decides on its own', async () => {
    const other: T[] = [
      { n: 11, sec: 1, dir: 'in', text: 'x', peer: PEER2 },
      { n: 12, sec: 2, dir: 'out', text: 'y', peer: PEER2 },
    ];
    const p = await plan([...three, ...other], { loaded: [1, 2], existing: mine });
    expect(p.threads.get(`${EXT}|${PEER2}`)!.loaded).toBe(0);
    expect(p.threads.get(TK)!.loaded).toBe(2);
    expect(p.partial).toEqual([]);
  });

  it('provider ids: a new turn whose id the ledger already owns gets no ledger row; a fresh id does; the loaded owner keeps it', async () => {
    const turns: T[] = [
      { n: 1, sec: 1, dir: 'in', text: 'a', provider: 'wamid.A' },
      { n: 2, sec: 2, dir: 'in', text: 'b', provider: 'wamid.A' },
      { n: 3, sec: 3, dir: 'in', text: 'c', provider: 'wamid.C' },
    ];
    const p = await plan(turns, { loaded: [1], existing: mine, ledgerOwned: [`${EXT}\u0000wamid.A`] });
    expect(p.docs.get(id(1))!.ledgerKey).toBe('wamid.A');
    expect(p.docs.get(id(2))!.ledgerKey).toBeNull();
    expect(p.docs.get(id(2))!.softs.map((s) => s.code)).toContain('DUP_PROVIDER_ID');
    expect(p.docs.get(id(3))!.ledgerKey).toBe('wamid.C');
  });
});

describe('oracle: the state after an append is what a fresh load makes', () => {
  const run = async (turns: T[], loaded: number[], existing: Record<string, string>) => {
    const keys = new Set(loaded.map(id));
    return oracleChat(
      (async function* () {
        yield* turns.map(doc);
      })(),
      {
        client: CLIENT,
        botToExt: new Map([['b1', EXT]]),
        keepDeletedContactChats: false,
        threadStatus: 'waboo',
        assignAgents: false,
        windowHours: 24,
        referenceAt: REF,
        deletedContacts: new Set(),
        contactId: () => undefined,
        userId: () => undefined,
        hasUsers: false,
        contactsByDigits: new Map(),
        existingThreads: new Map(Object.entries(existing)),
        loaded: (k) => keys.has(k),
      },
    );
  };

  it('append case: all turns expected, seq 1..3, counters of the whole thread, loadedCount 2', async () => {
    const o = await run(three, [1, 2], mine);
    const th = o.threads.get(TK)!;
    expect([th.count, th.loadedCount]).toEqual([3, 2]);
    expect(th.lastAt).toBe(new Date(at(3)).toISOString());
    expect(th.preview).toBe('thanks, bye');
    expect(o.outOfOrder).toEqual([]);
    expect([...o.messages.values()].map((m) => m.seq)).toEqual([1, 2, 3]);
  });

  it('planner and oracle agree on the out-of-order thread and on every document', async () => {
    const turns: T[] = [
      { n: 1, sec: 1, dir: 'in', text: 'hello' },
      { n: 3, sec: 3, dir: 'in', text: 'last loaded' },
      { n: 2, sec: 2, dir: 'out', text: 'late arrival' },
    ];
    const p = await plan(turns, { loaded: [1, 3], existing: mine });
    const o = await run(turns, [1, 3], mine);
    expect(o.outOfOrder).toEqual(p.outOfOrder);
    for (const m of o.messages.values()) {
      const d = p.docs.get(m.key)!;
      expect(m.verdict === 'load' ? 'thread' : m.verdict).toBe(d.state);
      expect(m.code).toBe(d.code);
      if (m.verdict === 'load') expect(m.seq).toBe(d.seq);
    }
    expect(o.threads.get(TK)!.count).toBe(p.threads.get(TK)!.msgSeq);
  });

  it('planner and oracle agree on a pure append, document by document', async () => {
    const p = await plan(three, { loaded: [1], existing: mine });
    const o = await run(three, [1], mine);
    for (const m of o.messages.values()) {
      const d = p.docs.get(m.key)!;
      expect([d.state, d.seq, d.at]).toEqual(['thread', m.seq, m.at]);
    }
    const t = p.threads.get(TK)!;
    const th = o.threads.get(TK)!;
    expect([t.msgSeq, t.lastMessageAt, t.lastInboundAt, t.lastOutboundAt, t.preview]).toEqual([
      th.count,
      th.lastAt,
      th.lastInboundAt,
      th.lastOutboundAt,
      th.preview,
    ]);
  });
});
