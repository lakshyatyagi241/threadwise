import { describe, expect, it } from 'vitest';
import { parseTurn } from '../inbox/parse';
import { oracleChat } from '../reconcile/oracle-chat';

/** Pure: the loader's parser and the independent oracle must agree on which turns are messages (only those take a seq). */
const base = { botid: 'b1', channel: 'whatsapp', context: {}, user: { mobile: '919999900001' } };
const at = (i: number): string => `2026-04-19T12:27:${String(10 + i).padStart(2, '0')}.000Z`;
const turn = (i: number, extra: Record<string, unknown>): Record<string, unknown> => ({
  _id: `69e4ca40a756f598c23210${String(10 + i)}`,
  createdAt: new Date(at(i)),
  ...base,
  ...extra,
});
// shapes seen on the real ISKM dump (invented values)
const hello = { user_query_object: { isUser: true, type: 'text', value: 'hi' }, user_query: 'hi' };
const referralOnly = {
  user_query_object: { isUser: true, message_id: 'm', type: 'text', value: { isUser: true, referral: {}, type: 'text' } },
  user_query: { isUser: true, referral: {}, type: 'text' },
};
const urlNull = { user_query_object: { isUser: true, type: 'image', value: { url: null } }, user_query: null };
const noValue = { user_query_object: { isUser: true, messageId: 'm', type: 'image' } };
const reply = { bot_response: { response: [{ type: 'text', value: 'ok' }] } };
const buttons = { bot_response: { response: [{ interactive: { x: 1 }, type: 'interactive' }] } };

describe('seq rule: a turn takes a seq iff it is stored as a message', () => {
  it('oracle and parser agree on empty turns, and later turns of the thread keep seq 1,2,...', async () => {
    const docs = [hello, referralOnly, reply, urlNull, buttons, noValue, reply].map((e, i) => turn(i, e));
    const res = await oracleChat((async function* () { yield* docs; })(), {
      client: 'x',
      botToExt: new Map([['b1', '123']]),
      keepDeletedContactChats: false,
      threadStatus: 'waboo',
      assignAgents: false,
      windowHours: 24,
      referenceAt: '2026-10-09T00:00:00.000Z',
      deletedContacts: new Set(),
      contactId: () => undefined,
      userId: () => undefined,
      hasUsers: false,
      contactsByDigits: new Map(),
      existingThreads: new Map(),
    });
    const seqs: Array<number | undefined> = [];
    docs.forEach((d, i) => {
      const m = res.messages.get(d._id as string)!;
      const empty = parseTurn(d as never).empty;
      expect(m.verdict === 'quarantine' && m.code === 'EMPTY_MESSAGE', `shape ${i}`).toBe(empty);
      seqs.push(m.seq);
    });
    // hello, reply, buttons, reply are messages; referral-only, url:null and value-less turns are not
    expect(seqs).toEqual([1, undefined, 2, undefined, 3, undefined, 4]);
  });
});
