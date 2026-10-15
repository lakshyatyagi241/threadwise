import { describe, expect, it } from 'vitest';
import { buildChatPlan } from '../inbox/plan';
import type { InboxSettings } from '../inbox/config';
import type { Source } from '../extract/source';
import { classifyRelink } from '../load/chatrelink';
import { oracleChat } from '../reconcile/oracle-chat';

/** Pure: chat-relink picks, for a conversation with no contact, exactly what the planner and the independent oracle resolve now. Invented values. */
const EXT = '110000000000001';
const settings: InboxSettings = {
  map: { b1: { kind: 'whatsapp_cloud', externalId: EXT, displayAddress: null, name: 'Main' } },
  mapSha256: 'x',
  keepDeletedContactChats: false,
  threadStatus: 'waboo',
  assignAgents: false,
  windowHours: 24,
};
const doc = (n: number, phone: string, contact?: string): Record<string, unknown> => ({
  _id: `69e4ca40a756f598c2${String(n).padStart(6, '0')}`,
  createdAt: new Date('2026-04-19T12:00:00.000Z'),
  botid: 'b1',
  channel: 'whatsapp',
  session_id: 's',
  context: contact ? { contact_id: contact } : {},
  user: { mobile: phone },
  user_query_object: { isUser: true, type: 'text', value: 'hi' },
  user_query: 'hi',
});
const docs = [
  doc(1, '919800000001'), // one contact has this number
  doc(2, '919800000002'), // two contacts share it
  doc(3, '919800000003'), // nobody has it
  doc(4, '919800000004', 'C-4'), // a contact reference that resolves wins over the number
];
const byDigits = new Map([
  ['919800000001', { n: 1, id: 11 }],
  ['919800000002', { n: 2, id: 12 }],
  ['919800000004', { n: 1, id: 14 }],
]);
const source = {
  async *readIndexed() {
    let o = 0;
    for (const d of docs) yield { doc: d as never, offset: o++, length: 1 };
  },
} as unknown as Source;

describe('chat-relink: the contact the planner resolves now', () => {
  it('planner, oracle and relink agree: one match links, two or none stay NULL, a reference wins', async () => {
    const plan = await buildChatPlan({
      source,
      client: 'acme',
      settings,
      referenceAt: '2026-10-09T00:00:00.000Z',
      ref: (c, k) => (c === 'contact_list' && k === 'C-4' ? { table: 'contacts', id: 99, uuid: '' } : undefined),
      contactDeleted: new Set(),
      hasUsers: false,
      contactsByDigits: byDigits,
      existingThreads: new Map(),
      migrated: () => false,
    });
    const want = new Map([...plan.threads.values()].map((t) => [t.uuid, t.contactId]));
    expect([...plan.threads.values()].map((t) => t.contactId)).toEqual([11, null, null, 99]);

    const o = await oracleChat((async function* () { yield* docs; })(), {
      client: 'acme',
      botToExt: new Map([['b1', EXT]]),
      keepDeletedContactChats: false,
      threadStatus: 'waboo',
      assignAgents: false,
      windowHours: 24,
      referenceAt: '2026-10-09T00:00:00.000Z',
      deletedContacts: new Set(),
      contactId: (k) => (k === 'C-4' ? 99 : undefined),
      userId: () => undefined,
      hasUsers: false,
      contactsByDigits: byDigits,
      existingThreads: new Map(),
    });
    for (const t of plan.threads.values()) expect(o.threads.get(t.key)!.contactId).toBe(t.contactId);

    const uuids = [...want.keys()];
    const rows = [
      { id: 1, uuid: uuids[0]!, contact_id: null },
      { id: 2, uuid: uuids[1]!, contact_id: null },
      { id: 3, uuid: uuids[2]!, contact_id: null },
      { id: 4, uuid: uuids[3]!, contact_id: 5 }, // linked to another contact: never overwritten
      { id: 5, uuid: 'not-in-plan', contact_id: null },
    ];
    const c = classifyRelink(rows, want);
    expect(c.todo).toEqual([{ id: 1, uuid: uuids[0], contact: 11 }]);
    expect([c.linked, c.differs, c.stillNull, c.notPlanned]).toEqual([0, 1, 2, 1]);
    // idempotent: once linked, nothing is left to do
    rows[0]!.contact_id = 11 as never;
    expect(classifyRelink(rows, want).todo).toEqual([]);
  });
});

describe('the digits query of the planner', () => {
  it('keeps its backslash escaped in the template literal: a bare \D would read as the letter D and match no phone', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../load/inbox.ts', import.meta.url), 'utf8');
    expect(src).toContain("regexp_replace(normalized_phone, '\\\\D', '', 'g')");
  });
});
