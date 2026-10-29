import { describe, expect, it } from 'vitest';
import { buildChatPlan, threadUuid } from '../inbox/plan';
import type { InboxSettings } from '../inbox/config';
import type { Source } from '../extract/source';

/**
 * Pure (no database): a chat Waboo's inbox never listed. Waboo's inbox lists visitor_logs sessions only, so a chat with no session and no
 * status on any turn is not in its Open or Unassigned lists. It loads closed (and stays in All), but only when the dump has sessions
 * at all: a dump without visitor_logs keeps the old rule (open). Values are invented.
 */
const EXT = '110000000000001';
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
const PEER_LISTED = '919812345671';
const PEER_NEVER = '919812345672';
const PEER_TURN = '919812345673';
const oid = (n: number): string => `69e4ca40a756f598c2${String(n).padStart(6, '0')}`;

const turn = (n: number, peer: string, session: string, status?: string) => ({
  _id: oid(n),
  createdAt: new Date(`2026-04-19T12:00:${String(n).padStart(2, '0')}.000Z`),
  botid: 'b1',
  channel: 'whatsapp',
  session_id: session,
  context: {},
  user: { mobile: peer, ...(status ? { conversation_status: status } : {}) },
  user_query_object: { isUser: true, type: 'text', value: `hello ${n}` },
  user_query: `hello ${n}`,
});

const sourceOf = (
  chats: Array<Record<string, unknown>>,
  sessions: Array<Record<string, unknown>>,
): Source =>
  ({
    collections: () => (sessions.length > 0 ? ['chathistory', 'visitor_logs'] : ['chathistory']),
    async *readIndexed() {
      let off = 0;
      for (const d of chats) yield { doc: d as never, offset: off++, length: 1 };
    },
    async *read(_client: string, collection: string) {
      if (collection === 'visitor_logs') for (const d of sessions) yield d;
    },
  }) as unknown as Source;

const plan = (sessions: Array<Record<string, unknown>>) =>
  buildChatPlan({
    source: sourceOf(
      [turn(1, PEER_LISTED, 's1'), turn(2, PEER_NEVER, 's2'), turn(3, PEER_TURN, 's3', 'Open')],
      sessions,
    ),
    client: CLIENT,
    settings,
    referenceAt: REF,
    ref: () => undefined,
    contactDeleted: new Set(),
    hasUsers: false,
    contactsByDigits: new Map(),
    existingThreads: new Map(),
    migrated: () => false,
  });
const statusOf = (p: Awaited<ReturnType<typeof plan>>, peer: string) =>
  p.threads.get(`${EXT}|${peer}`)!.status;

describe('planner: a chat Waboo never listed', () => {
  it('loads closed when the dump has sessions and neither a session nor a turn names its status', async () => {
    const p = await plan([
      { session_id: 's1', conversation_status: 'Open', last_message_time: '2026-04-19T12:00:01Z' },
    ]);
    expect(statusOf(p, PEER_NEVER)).toBe('closed');
    expect(p.threads.get(`${EXT}|${PEER_NEVER}`)!.key).toBe(`${EXT}|${PEER_NEVER}`);
    expect(threadUuid(CLIENT, EXT, PEER_NEVER)).toBe(p.threads.get(`${EXT}|${PEER_NEVER}`)!.uuid);
  });

  it('keeps open the chat its session says is open, and the chat whose turn says Open', async () => {
    const p = await plan([
      { session_id: 's1', conversation_status: 'Open', last_message_time: '2026-04-19T12:00:01Z' },
    ]);
    expect(statusOf(p, PEER_LISTED)).toBe('open');
    expect(statusOf(p, PEER_TURN)).toBe('open');
  });

  it('keeps the old rule (open) when the dump has no sessions at all', async () => {
    const p = await plan([]);
    expect(statusOf(p, PEER_NEVER)).toBe('open');
  });
});
