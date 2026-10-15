/**
 * INVENTED chat history for the inbox tests. Shapes follow the masked pilot profiles (one document = one turn, `bot_response` for the
 * bot or agent, `user_query_object` / `user_query` for the customer, `user` / `context` snapshots, `whatsapp_window` and `agent` on the
 * ISKM shape); every value, phone number, name and id is made up.
 */
import { O } from './fixtures';

type J = Record<string, unknown>;
const D = (iso: string): J => ({ $date: iso });
export const hex = (n: number): string => String((O(n) as { $oid: string }).$oid);

export const EXT_A1 = '110000000000001';
export const EXT_A2 = '110000000000002';
export const EXT_G1 = '220000000000001';

export const MAP_ACME = {
  'bot-a1': {
    kind: 'whatsapp_cloud',
    externalId: EXT_A1,
    displayAddress: '+91 98000 11111',
    name: 'Acme main',
  },
  'bot-a2': {
    kind: 'whatsapp_cloud',
    externalId: EXT_A2,
    displayAddress: '+91 98000 22222',
    name: 'Acme second',
  },
};
export const MAP_GLOBEX = {
  'bot-g1': {
    kind: 'whatsapp_cloud',
    externalId: EXT_G1,
    displayAddress: '+44 7700 900123',
    name: 'Globex',
  },
};

let n0 = 900_000;
const nextId = (): J => O(n0++);

export interface TurnOpts {
  bot?: string;
  phone?: string | number | null;
  at?: unknown;
  dir?: 'in' | 'out';
  text?: string;
  session?: string;
  msgId?: string | null;
  contact?: string | null;
  contactCtx?: string | null;
  ctype?: 'bot' | 'livechat';
  name?: string | null;
  status?: string | null;
  agent?: { id: string; name: string } | null;
  provider?: string | null;
  id?: J;
  channel?: string;
  extra?: J;
  /** replaces the generated payload (bot_response / user_query_object) */
  payload?: J;
}

/** One turn. `at` is written as given: a {$date} object, an ISO string, an epoch number ... */
export function turn(o: TurnOpts): J {
  const session = o.session ?? 'sess-0001';
  const msgId = o.msgId === undefined ? `msg-${n0}` : o.msgId;
  const phone = o.phone === undefined ? '919812345671' : o.phone;
  const dir = o.dir ?? 'in';
  const doc: J = {
    _id: o.id ?? nextId(),
    botid: o.bot ?? 'bot-a1',
    session_id: session,
    ...(msgId === null ? {} : { message_id: msgId }),
    conversation_id: 'conv-' + session,
    ctype: o.ctype ?? 'bot',
    channel: o.channel ?? 'whatsapp',
    user: {
      user: `visitor-${session}`,
      email: null,
      mobile: phone,
      channel: o.channel ?? 'whatsapp',
      ...(o.status === null
        ? {}
        : { conversation_status: o.status ?? 'Open', conversation_state: 'active' }),
      ...(o.contact ? { contact_id: o.contact } : {}),
    },
    context: {
      visitor_phone: phone,
      ...(o.name === null ? {} : { visitor_name: o.name ?? 'Visitor' }),
      ...(o.contactCtx ? { contact_id: o.contactCtx } : {}),
      campaignName: 'invented campaign',
      redeem_now: 'x',
    },
    createdAt: o.at ?? D('2026-02-01T10:00:00.000Z'),
    ...(o.agent === undefined
      ? {}
      : { agent: o.agent ? { ...o.agent, chat_limit: 5, status: 'online', devices: [] } : null }),
    ...(o.provider ? { meta_msg_id: o.provider } : {}),
    ...(o.extra ?? {}),
  };
  if (o.payload) Object.assign(doc, o.payload);
  else if (dir === 'out') {
    doc.bot_response = {
      type: 'text',
      response: [{ text: o.text ?? 'Hello from the bot' }],
      live_chat_connected: o.ctype === 'livechat',
      qid: 'q-1',
    };
  } else {
    doc.user_query_object = {
      type: 'text',
      isUser: true,
      value: o.text ?? 'hi',
      session_id: session,
      message_id: msgId,
    };
    doc.user_query = o.text ?? 'hi';
  }
  return doc;
}

const T = (iso: string): J => D(iso);
const contact = (n: number, id: string, first: string, phone: string | null, extra: J = {}): J => ({
  _id: O(n),
  id,
  first_name: first,
  last_name: 'Tester',
  mobile_phone_number: phone,
  country_code: '91',
  created_time: D('2026-01-05T09:00:00.000Z'),
  modified_time: D('2026-01-05T09:00:00.000Z'),
  ...extra,
});

const user = (n: number, userId: string, email: string): J => ({
  _id: O(n),
  user_id: userId,
  email,
  username: email,
  first_name: 'Agent',
  last_name: userId,
  is_staff: false,
  is_active: true,
  is_deleted: false,
  deleted_time: null,
  is_email_verified: true,
  created_time: D('2026-01-02T09:00:00.000Z'),
  modified_time: D('2026-01-02T09:00:00.000Z'),
  role_id: null,
});

export const CONTACT_C1 = 'chat-con-000000001';
export const CONTACT_C2_OID = hex(7002);
export const LONG_TEXT = 'abcdefghij'.repeat(6000); // 60,000 characters

/** The invented acme dump: every case of spec A section 11 that a document can express. */
export function acmeChat(): { contact_list: J[]; user: J[]; chathistory: J[] } {
  const contacts: J[] = [
    contact(7001, CONTACT_C1, 'Asha', '9812345671'),
    contact(7002, 'chat-con-000000002', 'Bhanu', '9812345672'),
    contact(7003, 'chat-con-000000003', 'Chitra', '9812345673'), // found only by phone
    contact(7004, 'chat-con-000000004', 'Dev', '9812345674'), // ambiguous: two contacts, one number
    contact(7005, 'chat-con-000000005', 'Dev Twin', '9812345674'),
    contact(7006, 'chat-con-000000006', 'Deleted', '9812345676', { is_deleted: true }),
    { _id: O(7007), id: 'chat-con-000000007', created_time: D('2026-01-05T09:00:00.000Z') }, // no identity: quarantined in phase 1
  ];
  const users = [
    user(7101, 'usr-chat-01', 'agent.one@example.test'),
    user(7102, 'usr-chat-02', 'agent.two@example.test'),
  ];
  const ag1 = { id: 'usr-chat-01', name: 'Agent One' };
  const ag9 = { id: 'usr-ghost', name: 'Gone Agent' };
  const chat: J[] = [];
  const add = (...t: J[]): void => void chat.push(...t);

  // T1: one person, three Waboo sessions, a year boundary (Dec -> Jan -> Feb), a livechat agent, statuses; thread larger than the batch
  const t1 = (
    at: string,
    dir: 'in' | 'out',
    text: string,
    session: string,
    extra: Partial<TurnOpts> = {},
  ): J => turn({ at: T(at), dir, text, session, contact: CONTACT_C1, name: 'Asha R', ...extra });
  add(
    t1('2025-12-28T09:00:00.000Z', 'in', 'Hello, is the retreat open?', 'sess-t1-a', {
      provider: 'wamid.T1.0001',
      status: 'Open',
    }),
    t1('2025-12-28T09:00:05.000Z', 'out', 'Yes, registration is open.', 'sess-t1-a', {
      ctype: 'bot',
    }),
    t1('2025-12-28T09:01:00.000Z', 'in', 'How much does it cost?', 'sess-t1-a'),
    t1('2025-12-28T09:01:03.000Z', 'out', 'It is free.', 'sess-t1-a'),
    t1('2026-01-10T12:00:00.000Z', 'in', 'Back again 🙏', 'sess-t1-b', {
      provider: 'wamid.T1.0002',
    }),
    t1('2026-01-10T12:00:09.000Z', 'out', 'Welcome back! Connecting you to a person.', 'sess-t1-b'),
    t1('2026-01-10T12:02:00.000Z', 'out', 'Hi, this is Agent One.', 'sess-t1-b', {
      ctype: 'livechat',
      agent: ag1,
    }),
    t1('2026-01-10T12:03:00.000Z', 'in', 'नमस्ते, मुझे मदद चाहिए', 'sess-t1-b'),
    t1('2026-01-10T12:04:00.000Z', 'out', 'Of course.', 'sess-t1-b', {
      ctype: 'livechat',
      agent: ag1,
    }),
    t1(
      '2026-02-03T08:00:00.000Z',
      'in',
      'One more question "quoted" and \'single\' \\ backslash',
      'sess-t1-c',
      { status: 'Closed' },
    ),
    t1('2026-02-03T08:00:30.000Z', 'out', 'Answered.', 'sess-t1-c', {
      ctype: 'livechat',
      agent: ag1,
      status: 'Closed',
    }),
    t1('2026-02-03T08:01:00.000Z', 'in', 'Thanks', 'sess-t1-c', { status: 'Closed' }),
  );

  // T2: contact found by ObjectId hex, ties on createdAt (tie-break by id), a hand-over line, dates written as string / epoch
  const t2 = (o: TurnOpts): J =>
    turn({
      phone: '919812345672',
      contact: CONTACT_C2_OID,
      name: 'Bhanu T',
      session: 'sess-t2',
      ...o,
    });
  add(
    t2({ at: '2026-02-10T10:00:00.000Z', dir: 'in', text: 'tie one', id: O(7501) }),
    t2({ at: '2026-02-10T10:00:00.000Z', dir: 'out', text: 'tie two', id: O(7500) }),
    t2({
      at: Date.parse('2026-02-10T10:05:00.000Z'),
      dir: 'in',
      text: 'epoch milliseconds',
      session: 'sess-t2b',
    }),
    t2({
      at: Math.floor(Date.parse('2026-02-10T10:06:00.000Z') / 1000),
      dir: 'out',
      text: 'epoch seconds',
    }),
    t2({
      at: D('2026-02-10T10:07:00.000Z'),
      payload: {
        user_query_object: {
          fromAgent: 'usr-chat-01',
          toAgent: 'usr-chat-02',
          username: 'Agent Two',
          session_id: 'sess-t2',
        },
      },
    }),
    t2({
      at: { $date: { $numberLong: String(Date.parse('2026-02-10T10:08:00.000Z')) } },
      dir: 'in',
      text: 'long date form',
    }),
    t2({ at: '2026-02-10T10:09:00Z', dir: 'out', text: 'ISO string no millis', status: 'Open' }),
  );

  // T3: one person, four ways of writing the number -> ONE thread; found by phone only (no contact id anywhere)
  const t3 = (phone: string | number, at: string, text: string): J =>
    turn({ phone, at: T(at), text, session: 'sess-t3', contact: null, name: null });
  add(
    t3('+91 98123 45673', '2026-02-11T10:00:00.000Z', 'plus form'),
    t3('919812345673', '2026-02-11T10:01:00.000Z', 'bare digits'),
    t3('0091 98123 45673', '2026-02-11T10:02:00.000Z', 'double zero'),
    t3('919812345673@s.whatsapp.net', '2026-02-11T10:03:00.000Z', 'jid form'),
    t3(919812345673, '2026-02-11T10:04:00.000Z', 'a number, not a string'),
  );

  // T4: two contacts share the number -> never guessed; T6: the contact exists in the dump but phase 1 quarantined it; T7: absent entirely
  add(
    turn({
      phone: '919812345674',
      at: T('2026-02-12T10:00:00.000Z'),
      text: 'ambiguous',
      contact: null,
    }),
    turn({
      phone: '919812345677',
      at: T('2026-02-12T11:00:00.000Z'),
      text: 'quarantined contact',
      contact: 'chat-con-000000007',
    }),
    turn({
      phone: '919812345678',
      at: T('2026-02-12T12:00:00.000Z'),
      text: 'absent contact',
      contact: 'ghost-contact-id',
      contactCtx: 'also-ghost',
    }),
  );

  // T5: the contact was deleted at the source -> the whole thread is excluded
  add(
    turn({
      phone: '919812345676',
      at: T('2026-02-13T10:00:00.000Z'),
      text: 'deleted contact in',
      contact: 'chat-con-000000006',
    }),
    turn({
      phone: '919812345676',
      at: T('2026-02-13T10:01:00.000Z'),
      dir: 'out',
      text: 'deleted contact out',
      contact: 'chat-con-000000006',
    }),
  );

  // not loadable: website chat, an unmapped bot, no phone, bad dates, empty turns
  add(
    turn({
      channel: 'website',
      phone: 'visitor-web-1',
      at: T('2026-02-14T10:00:00.000Z'),
      text: 'from the website',
    }),
    turn({ bot: 'bot-unknown', at: T('2026-02-14T10:01:00.000Z'), text: 'unmapped bot' }),
    turn({
      phone: null,
      at: T('2026-02-14T10:02:00.000Z'),
      text: 'no number',
      extra: { context: { visitor_name: 'Nobody' } },
    }),
    turn({ at: 'not a date', text: 'unreadable date' }),
    turn({ text: 'null date', extra: { createdAt: null } }),
    turn({ text: 'missing date', extra: { createdAt: undefined } }),
    turn({ at: T('1999-05-05T05:05:05.000Z'), text: 'outside the partition window' }),
    turn({
      phone: '919812345680',
      at: T('2026-02-14T10:03:00.000Z'),
      dir: 'out',
      payload: { bot_response: { type: 'text', response: [] } },
    }),
    turn({
      phone: '919812345680',
      at: T('2026-02-14T10:04:00.000Z'),
      payload: { user_query_object: { type: 'text', value: '', isUser: true }, user_query: '' },
    }),
  );

  // duplicates: identical -> the later one is excluded; same ids but different content -> both kept (soft)
  add(
    turn({
      phone: '919812345681',
      at: T('2026-02-15T10:00:00.000Z'),
      text: 'same twice',
      session: 'sess-d',
      msgId: 'dup-1',
    }),
    turn({
      phone: '919812345681',
      at: T('2026-02-15T10:00:00.000Z'),
      text: 'same twice',
      session: 'sess-d',
      msgId: 'dup-1',
    }),
    turn({
      phone: '919812345681',
      at: T('2026-02-15T10:01:00.000Z'),
      text: 'first body',
      session: 'sess-d',
      msgId: 'dup-2',
    }),
    turn({
      phone: '919812345681',
      at: T('2026-02-15T10:02:00.000Z'),
      text: 'other body',
      session: 'sess-d',
      msgId: 'dup-2',
    }),
  );

  // the same person on the second bot = a second thread; shapes of the payloads (some are guesses -> soft issues, never a crash)
  const t8 = (o: TurnOpts): J =>
    turn({ bot: 'bot-a2', phone: '919812345671', session: 'sess-t8', contact: CONTACT_C1, ...o });
  add(
    t8({ at: T('2026-02-16T10:00:00.000Z'), text: 'second number' }),
    t8({
      at: T('2026-02-16T10:01:00.000Z'),
      dir: 'out',
      payload: {
        bot_response: {
          type: 'image',
          response: [{ url: 'https://files.example.test/a.jpg', text: 'caption' }],
        },
      },
    }),
    t8({
      at: T('2026-02-16T10:02:00.000Z'),
      dir: 'out',
      payload: {
        bot_response: {
          type: 'buttons',
          subType: 'quick',
          response: [{ buttons: [{ title: 'Yes' }, { title: 'No' }] }],
          quickActions: ['Yes', 'No'],
        },
      },
    }),
    t8({
      at: T('2026-02-16T10:03:00.000Z'),
      dir: 'out',
      payload: {
        bot_response: { type: 'carousel9', response: ['Plain string part', '', 'second part'] },
      },
    }),
    t8({
      at: T('2026-02-16T10:04:00.000Z'),
      dir: 'out',
      payload: { bot_response: { response: 'a bare string response' } },
    }),
    t8({
      at: T('2026-02-16T10:05:00.000Z'),
      dir: 'out',
      payload: { bot_response: { response: { text: 'an object response' } } },
    }),
    t8({
      at: T('2026-02-16T10:06:00.000Z'),
      payload: { user_query: { url: 'https://files.example.test/doc.pdf', text: 'see attached' } },
    }),
    t8({
      at: T('2026-02-16T10:07:00.000Z'),
      payload: {
        user_query: {
          type: 'image',
          isUser: true,
          messageID: 'm-9',
          value: 'photo caption',
          session_id: 'sess-t8',
          journey: 'j',
        },
      },
    }),
    t8({
      at: T('2026-02-16T10:08:00.000Z'),
      payload: { user_query_object: { type: 'weird_type', value: 'odd type', isUser: true } },
    }),
    t8({
      at: T('2026-02-16T10:09:00.000Z'),
      payload: {
        user_query_object: {
          type: 'button_reply',
          value: { title: 'Yes please', id: 'b1' },
          isUser: true,
        },
      },
    }),
    t8({ at: T('2026-02-16T10:10:00.000Z'), text: LONG_TEXT }),
    t8({ at: T('2026-02-16T10:11:00.000Z'), text: '   padded   ' }),
    t8({
      at: T('2026-02-16T10:12:00.000Z'),
      dir: 'out',
      text: '🙏🏽 emoji and 日本語 text',
      provider: 'wamid.T8.0001',
      extra: {
        whatsapp_window: true,
        whatapp_start_time: D('2026-02-16T09:00:00.000Z'),
        session_created_time: D('2026-02-16T09:00:00.000Z'),
        some_new_key: 'kept in extra',
        api_token: 'sk-abcdefghijklmnopqrstuvwx',
      },
    }),
    t8({
      at: T('2026-02-16T10:13:00.000Z'),
      provider: 'wamid.T8.0001',
      text: 'reuses a provider id',
    }),
  );

  // text PostgreSQL cannot store: quarantined by the engine, never reaches the plan
  add(
    turn({
      phone: '919812345682',
      at: T('2026-02-17T10:00:00.000Z'),
      text: 'has a NUL \u0000 inside',
    }),
    turn({
      phone: '919812345682',
      at: T('2026-02-17T10:01:00.000Z'),
      text: 'lone surrogate \ud800 inside',
    }),
    turn({ phone: '919812345682', at: T('2026-02-17T10:02:00.000Z'), text: 'fine' }),
  );

  // an unresolved agent on a livechat turn (Waboo user that was never migrated)
  add(
    turn({
      phone: '919812345683',
      at: T('2026-02-18T10:00:00.000Z'),
      text: 'q',
      session: 'sess-ag',
    }),
    turn({
      phone: '919812345683',
      at: T('2026-02-18T10:01:00.000Z'),
      dir: 'out',
      text: 'a',
      ctype: 'livechat',
      agent: ag9,
      session: 'sess-ag',
    }),
  );

  return { contact_list: contacts, user: users, chathistory: chat };
}

/** A second client that shares phone numbers with acme (different organization, different number ids, so nothing is shared). */
export function globexChat(): { contact_list: J[]; chathistory: J[] } {
  return {
    contact_list: [contact(8001, 'glx-con-000000001', 'Globex Asha', '9812345671')],
    chathistory: [
      turn({
        bot: 'bot-g1',
        phone: '919812345671',
        at: T('2026-02-01T10:00:00.000Z'),
        text: 'hello globex',
        contact: 'glx-con-000000001',
      }),
      turn({
        bot: 'bot-g1',
        phone: '919812345671',
        at: T('2026-02-01T10:00:05.000Z'),
        dir: 'out',
        text: 'hi from globex',
      }),
      turn({
        bot: 'bot-g1',
        phone: '447700900124',
        at: T('2026-03-01T10:00:00.000Z'),
        text: 'uk caller',
      }),
    ],
  };
}

/** `threads` people with `perThread` turns each, over several months (volume test). */
export function bulkChat(threads: number, perThread: number): J[] {
  const out: J[] = [];
  const base = Date.parse('2025-09-01T08:00:00.000Z');
  for (let t = 0; t < threads; t++) {
    const phone = String(919100000000 + t);
    for (let i = 0; i < perThread; i++) {
      const at = new Date(
        base + ((t * 7919 + i * 3_600_000 * 7) % (400 * 86_400_000)),
      ).toISOString();
      out.push(
        turn({
          phone,
          at: T(at),
          dir: i % 2 === 0 ? 'in' : 'out',
          text: `message ${t}-${i} body text for the volume run`,
          session: `bulk-${t}-${Math.floor(i / 5)}`,
          msgId: `bulk-${t}-${i}`,
          contact: null,
          name: `Person ${t}`,
          provider: i % 20 === 0 ? `wamid.bulk.${t}.${i}` : null,
          status: t % 3 === 0 ? 'Closed' : 'Open',
        }),
      );
    }
  }
  return out;
}
