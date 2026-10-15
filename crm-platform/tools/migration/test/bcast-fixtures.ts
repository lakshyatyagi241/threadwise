/**
 * INVENTED broadcast campaigns and recipient logs for the broadcast tests. Shapes follow the masked pilot profiles
 * (`broadcasting`: status string, mixed int / double amounts, `scheduled_date` as an ISO string next to `scheduled_date_dt`;
 * `whatsapp_broadcasting_data`: `status` as an object of step dates, `source` broadcast / automation / inbox / test, the iskm literal
 * key "status.sent", mixed int / double amounts). Every value, phone number, name and id is made up.
 */
import { O } from './fixtures';

type J = Record<string, unknown>;
const D = (iso: string): J => ({ $date: iso });

let n0 = 1_200_000;
const nextId = (): J => O(n0++);

export const CAMP_C1_ID = 'bc-camp-id-00000000001'; // C1: the string id and the broadcast_id differ
export const CAMP_C1_BID = 'bc-camp-bid-0000000001';

export interface CampOpts {
  id?: string;
  name?: string | null;
  status?: string;
  test?: boolean;
  deleted?: boolean;
  scheduledNow?: boolean;
  scheduledDate?: string | null;
  scheduledDt?: string | null;
  sentOn?: string | null;
  recipients?: number;
  counters?: Partial<Record<'sent' | 'delivered' | 'seen' | 'replied' | 'failed', number>>;
  processing?: number;
  refunded?: number;
  billable?: number;
  retryEnabled?: boolean;
  createdBy?: string | null;
  type?: string;
  extra?: J;
}

/** One campaign document. The string id doubles as `broadcast_id` unless `id` says otherwise. */
export function camp(o: CampOpts = {}): J {
  const id = o.id ?? `bc-camp-${n0}`;
  const d: J = {
    _id: nextId(),
    id,
    broadcast_id: o.id === CAMP_C1_ID ? CAMP_C1_BID : id,
    broadcast_name: o.name === undefined ? `Campaign ${n0}` : o.name,
    broadcast_template_id: 'tpl-0000000001',
    broadcast_template_name: 'diwali_greeting_v2',
    broadcast_template_type: 'whatsapp_template_marketing',
    broadcast_template_category: 'MARKETING',
    type: o.type ?? 'whatsapp',
    status: o.status ?? 'completed',
    test: o.test ?? false,
    scheduled_now: o.scheduledNow ?? true,
    created_time: D('2026-05-15T08:00:00.000Z'),
    modified_time: D('2026-05-15T09:30:00.000Z'),
    sent_on: o.sentOn === null ? undefined : D(o.sentOn ?? '2026-05-15T09:00:00.000Z'),
    deleted_time: o.deleted ? D('2026-06-01T00:00:00.000Z') : null,
    created_by:
      o.createdBy === null
        ? null
        : {
            id: o.createdBy ?? 'usr-bc-01',
            first_name: 'Agent',
            last_name: 'One',
            email: 'agent.one@example.test',
            phone: null,
          },
    updated_by: {
      id: 'usr-bc-01',
      first_name: 'Agent',
      last_name: 'One',
      email: 'a@example.test',
      phone: null,
    },
    recipients: o.recipients ?? 10,
    seen: o.counters?.seen ?? 0,
    replied: o.counters?.replied ?? 0,
    delivered: o.counters?.delivered ?? 0,
    failed: o.counters?.failed ?? 0,
    ...(o.counters?.sent === undefined ? {} : { sent: o.counters.sent }),
    processing: o.processing ?? 0,
    queued: 0,
    components: { header: { type: 'image' }, button: { type: 'url' } },
    filter_query: {
      combinator: 'and',
      id: 'g-1',
      rules: [{ field: 'city', operator: '=', value: 'Pune' }],
    },
    mongodb_query: '{"city": "Pune"}',
    search: '',
    billable_amount: o.billable ?? 12.5,
    refunded_amount: o.refunded ?? 0,
    reseller_amount: 3.25,
    retry_enabled: o.retryEnabled ?? false,
    retry_count: 0,
    max_retries: 3,
    sender_number: '+919800011111',
    ...(o.scheduledDate === undefined ? {} : { scheduled_date: o.scheduledDate }),
    ...(o.scheduledDt === undefined
      ? {}
      : { scheduled_date_dt: o.scheduledDt ? D(o.scheduledDt) : null }),
    ...(o.extra ?? {}),
  };
  return Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined));
}

export interface RcpOpts {
  campaign?: string | null;
  source?: string;
  phone?: string | null;
  contact?: string | null;
  msg?: string | null;
  st?: Partial<Record<'sent' | 'delivered' | 'seen' | 'failed' | 'replied', string>>;
  /** write the iskm quirk: a literal top-level key "status.sent" instead of status.sent */
  dotted?: string;
  noStatus?: boolean;
  error?: string | null;
  first?: string | null;
  last?: string | null;
  amount?: number;
  created?: string;
  id?: J;
  retryCount?: number;
  extra?: J;
}

/** One recipient-log document. By default a delivered broadcast row of campaign C1. */
export function rcp(o: RcpOpts = {}): J {
  const st: J = {};
  const src = o.st ?? { sent: '2026-05-15T09:00:00.000Z', delivered: '2026-05-15T09:00:05.000Z' };
  for (const [k, v] of Object.entries(src)) st[k] = D(v);
  const source = o.source ?? 'broadcast';
  const isBroadcast = source === 'broadcast';
  const d: J = {
    _id: o.id ?? nextId(),
    id: `bc-rcp-${n0}`,
    contact_id: o.contact === undefined ? null : o.contact,
    amount: o.amount ?? 0.35,
    reseller_amount: 0.05,
    reseller_margin: 1,
    meta_template_id: '123456789012345',
    message_id: o.msg === undefined ? `wamid.bc.${n0}` : o.msg,
    phone_no: o.phone === undefined ? '+919812345671' : o.phone,
    status: o.noStatus ? {} : st,
    ...(o.dotted ? { 'status.sent': D(o.dotted) } : {}),
    error: o.error === undefined ? null : o.error,
    revert: false,
    created_time: D(o.created ?? '2026-05-15T09:00:00.000Z'),
    source,
    template_category: 'marketing',
    cost_description: 'marketing',
    origin: null,
    conversation_id: null,
    run_id: null,
    broadcast_id: o.campaign === undefined ? CAMP_C1_BID : o.campaign,
    ...(isBroadcast
      ? {
          mobile_phone_number: o.phone ?? '+919812345671',
          mobile: o.phone ?? '+919812345671',
          first_name: o.first === undefined ? 'Asha' : o.first,
          last_name: o.last === undefined ? 'Rao' : o.last,
          primary_email: 'asha@example.test',
          template_id: 'tpl-0000000001',
          cost: 0.35,
          isSelected: true,
          list_id: null,
          interakt_reponse_time: 0.5,
        }
      : {}),
    ...(o.retryCount === undefined
      ? {}
      : { retry_count: o.retryCount, retry_enabled: true, max_retries: 3 }),
    ...(o.extra ?? {}),
  };
  return d;
}

const CC = (n: number): string => `+9198123${String(45600 + n).padStart(5, '0')}`;
const iso = (m: number, s = 0): string =>
  `2026-05-15T09:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.000Z`;

export const ERR_131049 =
  '(#131049) This message was not delivered to maintain healthy ecosystem engagement.';

export interface BcastDump {
  contact_list: J[];
  user: J[];
  broadcasting: J[];
  whatsapp_broadcasting_data: J[];
}

const contact = (n: number, id: string, first: string, phone: string, extra: J = {}): J => ({
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

export const K1 = 'bc-con-000000001';
export const K2_OID = String((O(8002) as { $oid: string }).$oid);
export const KDEL = 'bc-con-000000006';

/** The acme dump: every case of spec A sections 3, 4 and 11 that a document can express. */
export function acmeBcast(): BcastDump {
  const contacts: J[] = [
    contact(8001, K1, 'Asha', '9812345671'),
    contact(8002, 'bc-con-000000002', 'Bhanu', '9812345672'),
    contact(8003, 'bc-con-000000003', 'Chitra', '9812345673'), // found by phone only
    contact(8004, 'bc-con-000000004', 'Dev', '9812345674'), // ambiguous: two contacts hold the number
    contact(8005, 'bc-con-000000005', 'Dev Twin', '9812345674'),
    contact(8006, KDEL, 'Deleted', '9812345676', { is_deleted: true }),
  ];
  const user = [
    {
      _id: O(8101),
      user_id: 'usr-bc-01',
      email: 'agent.one@example.test',
      username: 'agent.one@example.test',
      first_name: 'Agent',
      last_name: 'One',
      is_staff: false,
      is_active: true,
      is_deleted: false,
      deleted_time: null,
      is_email_verified: true,
      created_time: D('2026-01-02T09:00:00.000Z'),
      modified_time: D('2026-01-02T09:00:00.000Z'),
      role_id: null,
    },
  ];

  const broadcasting: J[] = [
    // C1: completed; the string id and the broadcast_id differ; scheduled_date as a zone-less ISO string AND scheduled_date_dt;
    //     refunded_amount an int; retry_enabled TRUE in Waboo (must be imported false); Waboo counters differ from the rows
    camp({
      id: CAMP_C1_ID,
      name: 'Diwali blast',
      recipients: 40,
      counters: { sent: 30, delivered: 20, seen: 10, replied: 2, failed: 9 },
      scheduledNow: false,
      scheduledDate: '2026-05-15T08:30:00',
      scheduledDt: '2026-05-15T08:30:00.000Z',
      refunded: 4,
      retryEnabled: true,
    }),
    // C2: completed, sent now; `sent` absent (7% on iskm); refunded_amount a double; a marketing list
    camp({
      id: 'bc-camp-0000000002',
      name: 'Weekend promo',
      recipients: 5,
      refunded: 1.5,
      extra: { marketing_list_id: 'ml-0000000001' },
    }),
    // C3: a test send -> excluded; C4: soft-deleted -> excluded
    camp({ id: 'bc-camp-0000000003', name: 'Test only', test: true }),
    camp({ id: 'bc-camp-0000000004', name: 'Deleted one', deleted: true }),
    // C5: still "running" in Waboo -> imported cancelled (soft NONTERMINAL_AT_MIGRATION), processing counter
    camp({
      id: 'bc-camp-0000000005',
      name: 'Still running',
      status: 'running',
      processing: 3,
      recipients: 6,
    }),
    // C6: "scheduled" for a time given only as an ISO string; C7: an unknown status
    camp({
      id: 'bc-camp-0000000006',
      name: 'Scheduled one',
      status: 'scheduled',
      scheduledNow: false,
      scheduledDate: '2026-12-24T18:00:00',
      sentOn: null,
    }),
    camp({ id: 'bc-camp-0000000007', name: 'Archived one', status: 'archived' }),
    // C8: no name -> quarantined; C9: failed; C10: paused; C11: cancelled; C12: created_by unknown; C13: an sms campaign
    camp({ id: 'bc-camp-0000000008', name: '   ' }),
    camp({ id: 'bc-camp-0000000009', name: 'Failed run', status: 'failed', recipients: 2 }),
    camp({ id: 'bc-camp-0000000010', name: 'Paused one', status: 'paused', recipients: 3 }),
    camp({ id: 'bc-camp-0000000011', name: 'Cancelled one', status: 'cancelled' }),
    camp({ id: 'bc-camp-0000000012', name: 'Ghost author', createdBy: 'usr-ghost' }),
    camp({ id: 'bc-camp-0000000013', name: 'Text blast', type: 'sms' }),
  ];

  const c1 = CAMP_C1_BID;
  const rows: J[] = [];
  const add = (...r: J[]): void => void rows.push(...r);
  // C1: every status step, in order
  add(
    rcp({
      campaign: c1,
      msg: 'wamid.bc.sent1',
      contact: K1,
      st: { sent: iso(0) },
      phone: '+919812345671',
    }),
    rcp({
      campaign: c1,
      msg: 'wamid.bc.delivered1',
      contact: K2_OID,
      st: { sent: iso(0), delivered: iso(0, 5) },
      phone: '+919812345672',
    }),
    rcp({
      campaign: c1,
      msg: 'wamid.bc.read1',
      contact: 'bc-con-000000002',
      st: { sent: iso(1), delivered: iso(1, 5), seen: iso(2) },
      phone: '+919812345672',
    }),
    rcp({
      campaign: c1,
      msg: 'wamid.bc.replied1',
      contact: null,
      st: { sent: iso(1), delivered: iso(1, 5), seen: iso(2), replied: iso(3) },
      phone: '+91 98123 45673',
    }),
    // failed: it also has `sent` (the attempt); the error carries Meta's frequency-cap code. MUST stay failed, with no timestamp
    rcp({
      campaign: c1,
      msg: null,
      st: { sent: iso(4), failed: iso(4, 1) },
      error: ERR_131049,
      phone: '+919812345675',
      first: 'Farah',
      last: null,
    }),
    rcp({
      campaign: c1,
      msg: 'wamid.bc.failed2',
      st: { sent: iso(4), failed: iso(4, 2) },
      error: 'Phone number is not a WhatsApp user',
      phone: '+919812345677',
      amount: 0,
    }),
    // failed AND delivered: delivered is later -> delivered (STATUS_CONFLICT); failed is later -> failed
    rcp({
      campaign: c1,
      msg: 'wamid.bc.conflict1',
      st: { sent: iso(5), failed: iso(5, 1), delivered: iso(5, 9) },
      error: 'late receipt',
      phone: '+919812345678',
    }),
    rcp({
      campaign: c1,
      msg: 'wamid.bc.conflict2',
      st: { sent: iso(5), delivered: iso(5, 2), failed: iso(5, 9) },
      error: 'bounced after delivery',
      phone: '+919812345679',
    }),
    // the iskm quirk: a literal key "status.sent" and a status object with no sent
    rcp({
      campaign: c1,
      msg: 'wamid.bc.dotted1',
      st: {},
      dotted: iso(6),
      phone: '+919812345680',
      amount: 1,
    }),
    rcp({
      campaign: c1,
      msg: 'wamid.bc.dotted2',
      st: { delivered: iso(6, 3) },
      dotted: iso(6),
      phone: '+919812345681',
    }),
    // contact ids: the contact was deleted at the source (not linked, no phone fallback), a ghost id (phone fallback finds no one),
    // an ambiguous number (never guessed), a number held by one contact (linked by phone), no contact id at all
    rcp({ campaign: c1, msg: 'wamid.bc.cdel', contact: KDEL, phone: '+919812345676' }),
    rcp({ campaign: c1, msg: 'wamid.bc.cghost', contact: 'ghost-contact', phone: '+919812345690' }),
    rcp({ campaign: c1, msg: 'wamid.bc.camb', contact: null, phone: '+919812345674' }),
    rcp({
      campaign: c1,
      msg: 'wamid.bc.cphone',
      contact: null,
      phone: '+919812345673',
      first: null,
      last: null,
    }),
    // a number that cannot be read as E.164 (no country code, acme has no --default-cc): the raw digits are kept
    rcp({ campaign: c1, msg: 'wamid.bc.badphone', phone: '9812345699' }),
    // phone only in `mobile` (phone_no empty)
    rcp({ campaign: c1, msg: 'wamid.bc.mobile', phone: '', extra: { mobile: '+919812345601' } }),
    rcp({
      campaign: c1,
      msg: 'wamid.bc.retry',
      st: { sent: iso(7), failed: iso(7, 1) },
      error: '131026 Message undeliverable',
      retryCount: 2,
      phone: '+919812345602',
    }),
  );
  // C2 (referenced by its string id): three delivered
  for (let i = 0; i < 3; i++)
    add(
      rcp({
        campaign: 'bc-camp-0000000002',
        msg: `wamid.bc.c2.${i}`,
        phone: CC(i),
        st: { sent: iso(10 + i), delivered: iso(10 + i, 5) },
      }),
    );
  // C5 (running in Waboo): its rows load, the campaign is cancelled
  add(rcp({ campaign: 'bc-camp-0000000005', msg: 'wamid.bc.c5', phone: '+919812345610' }));
  // C7, C9, C10, C12: one row each
  for (const [i, c] of ['07', '09', '10', '12'].entries())
    add(rcp({ campaign: `bc-camp-00000000${c}`, msg: `wamid.bc.c${c}`, phone: CC(20 + i) }));
  // not recipients: other sources, a broadcast row without broadcast_id, a test send
  add(
    rcp({
      source: 'automation',
      campaign: null,
      msg: 'wamid.bc.auto1',
      phone: '+919812345611',
      amount: 0.9,
    }),
    rcp({
      source: 'automation',
      campaign: null,
      msg: 'wamid.bc.auto2',
      phone: '+919812345612',
      st: { sent: iso(30), failed: iso(30, 1) },
      error: 'x',
    }),
    rcp({ source: 'inbox', campaign: null, msg: 'wamid.bc.inbox1', phone: '+919812345613' }),
    rcp({ source: 'test', campaign: null, msg: 'wamid.bc.test1', phone: '+919812345614' }),
    rcp({ source: 'broadcast', campaign: null, msg: 'wamid.bc.nobid', phone: '+919812345615' }),
    rcp({
      source: 'automation',
      campaign: 'bc-camp-0000000002',
      msg: 'wamid.bc.autobid',
      phone: '+919812345616',
    }), // source decides, not the id
  );
  // campaign excluded (test / deleted), missing, quarantined; no phone; no status; a repeated primary key; a NUL character
  add(
    rcp({ campaign: 'bc-camp-0000000003', msg: 'wamid.bc.ctest', phone: '+919812345620' }),
    rcp({ campaign: 'bc-camp-0000000004', msg: 'wamid.bc.cdeleted', phone: '+919812345621' }),
    rcp({ campaign: 'bc-camp-ghost-000000', msg: 'wamid.bc.cmissing', phone: '+919812345622' }),
    rcp({ campaign: 'bc-camp-0000000008', msg: 'wamid.bc.cquar', phone: '+919812345623' }),
    rcp({ campaign: 'bc-camp-0000000013', msg: 'wamid.bc.csms', phone: '+919812345624' }),
    rcp({
      campaign: c1,
      msg: 'wamid.bc.nophone',
      phone: null,
      extra: { mobile: null, mobile_phone_number: null },
    }),
    rcp({ campaign: c1, msg: 'wamid.bc.nostatus', noStatus: true, phone: '+919812345625' }),
  );
  const dup = rcp({ campaign: c1, msg: 'wamid.bc.dup', phone: '+919812345626' });
  add(dup, { ...dup, message_id: 'wamid.bc.dup.second' });
  add(rcp({ campaign: c1, msg: 'wamid.bc.nul', phone: '+919812345627', first: 'Bad\u0000Name' }));
  return { contact_list: contacts, user, broadcasting, whatsapp_broadcasting_data: rows };
}

/** A second client: the same phone numbers, its own ids; proves two organizations never mix. */
export function globexBcast(): BcastDump {
  const c = camp({
    id: 'gx-camp-0000000001',
    name: 'Globex launch',
    recipients: 3,
    counters: { sent: 3, delivered: 2 },
  });
  return {
    contact_list: [contact(8801, 'gx-con-000000001', 'Gita', '9812345671')],
    user: [],
    broadcasting: [c],
    whatsapp_broadcasting_data: [
      rcp({
        campaign: 'gx-camp-0000000001',
        msg: 'wamid.gx.1',
        phone: '+919812345671',
        st: { sent: iso(0), delivered: iso(0, 3) },
      }),
      rcp({
        campaign: 'gx-camp-0000000001',
        msg: 'wamid.gx.2',
        phone: '+919812345672',
        st: { sent: iso(0) },
      }),
      rcp({
        campaign: 'gx-camp-0000000001',
        msg: 'wamid.gx.3',
        phone: '+919812345673',
        st: { sent: iso(0), failed: iso(0, 2) },
        error: 'x',
      }),
      rcp({ source: 'automation', campaign: null, msg: 'wamid.gx.4', phone: '+919812345674' }),
    ],
  };
}

/**
 * `campaigns` campaigns with `per` broadcast recipients each, plus `other` delivery-log rows of other sources: the shape of karma
 * (most of the collection is not a recipient). Statuses cycle through every step; every 11th row fails; no contact ids.
 */
export function bulkBcast(
  campaigns: number,
  per: number,
  other: number,
): { broadcasting: J[]; whatsapp_broadcasting_data: J[] } {
  const broadcasting: J[] = [];
  const rows: J[] = [];
  const base = Date.parse('2026-03-01T08:00:00.000Z');
  for (let c = 0; c < campaigns; c++) {
    const id = `bulk-camp-${String(c).padStart(14, '0')}`;
    broadcasting.push(
      camp({ id, name: `Bulk campaign ${c}`, recipients: per, counters: { sent: per } }),
    );
    for (let i = 0; i < per; i++) {
      const t0 = base + (c * per + i) * 1000;
      const at = (s: number): string => new Date(t0 + s * 1000).toISOString();
      const k =
        i % 11 === 10 ? 'failed' : (['sent', 'delivered', 'seen', 'replied'] as const)[i % 4]!;
      const st: Record<string, string> = { sent: at(0) };
      if (k === 'failed') st.failed = at(1);
      if (k === 'delivered' || k === 'seen' || k === 'replied') st.delivered = at(2);
      if (k === 'seen' || k === 'replied') st.seen = at(3);
      if (k === 'replied') st.replied = at(4);
      rows.push(
        rcp({
          campaign: id,
          msg: `wamid.bulk.${c}.${i}`,
          phone: `+9190000${String(c * per + i).padStart(5, '0')}`,
          st,
          error: k === 'failed' ? '131026 Message undeliverable' : null,
          created: at(0),
        }),
      );
    }
  }
  for (let i = 0; i < other; i++)
    rows.push(
      rcp({
        source: i % 3 === 0 ? 'inbox' : 'automation',
        campaign: null,
        msg: `wamid.bulk.other.${i}`,
        phone: `+9180000${String(i).padStart(5, '0')}`,
        st: { sent: new Date(base + i * 1000).toISOString() },
      }),
    );
  return { broadcasting, whatsapp_broadcasting_data: rows };
}
