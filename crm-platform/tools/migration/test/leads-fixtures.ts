/**
 * INVENTED lead data for the lead tests. Shapes follow the real ISKM / Rhythm contact_attribution dump (first_touch next to a top-level
 * copy, ObjectId contact_id, BSON dates) and the masked profiles of leadrepo / leads (visitor_* identity, dynamic per-client form answers,
 * null device keys, session_id, botid + module_id on the WhatsApp rows, createdAt missing on some rows). Every value is made up.
 */
import { D, O } from './fixtures';

type J = Record<string, unknown>;

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

export const C1 = 'ld-con-0000000001'; // reached by its string id
export const C2 = 'ld-con-0000000002'; // reached by its ObjectId hex
export const C3 = 'ld-con-0000000003';
export const CDEL = 'ld-con-0000000009'; // soft-deleted at the source
export const C2_HEX = String((O(9002) as { $oid: string }).$oid);
export const SESSION_WA = 'a0000000-0000-4000-8000-000000000001';

export interface LeadDump {
  contact_list: J[];
  leadrepo: J[];
  leads: J[];
  contact_attribution: J[];
}

const repo = (n: number, extra: J): J => ({
  _id: O(n),
  visitor_name: 'Visitor Tester',
  visitor_phone: '9812345601',
  channel: 'api',
  module: 'abc',
  updatedAt: D('2026-05-02T10:00:00.000Z'),
  session_id: `b0000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  contact_synced: true,
  contact_id: C1,
  campaignMedium: null,
  campaignName: null,
  campaignSource: null,
  ...extra,
});

export function acmeLeads(bulk = 0): LeadDump {
  const contacts = [
    contact(9001, C1, 'Asha', '9812345601'),
    contact(9002, C2, 'Bhanu', '9812345602'),
    contact(9003, C3, 'Chitra', '9812345603'),
    contact(9009, CDEL, 'Deleted', '9812345609', { is_deleted: true }),
  ];
  const leadrepo: J[] = [
    // L1: an API form lead: BSON dates, dynamic form answers, a credential-named answer that must never be copied
    repo(9101, {
      createdAt: D('2026-05-02T09:59:00.000Z'),
      source: 'hitpay_patron_webhook',
      visitor_email: 'asha@example.test',
      ratha_yatra_2026: 'yes',
      attendees: '4',
      patron_code: 'PAT12345',
      api_token: 'sk-live-0123456789abcdefghijklmnop',
      browser: null,
      city: null,
    }),
    // L2: a WhatsApp lead: no createdAt (ObjectId time is used), botid + module_id, the contact by its ObjectId hex, a date-like answer
    repo(9102, {
      channel: 'whatsapp',
      contact_id: C2_HEX,
      session_id: SESSION_WA,
      botid: 'c0000000-0000-4000-8000-000000000001',
      module_id: 'd0000000-0000-4000-8000-000000000001',
      wlf_attendance_date: '17-05-2026',
      chatbot_language: 'english',
      entry_point: 'qr',
      matomo: true,
    }),
    // L3: the contact is not in the dump -> quarantined, nothing created
    repo(9103, { contact_id: 'ld-con-unknown-000', createdAt: D('2026-05-03T09:00:00.000Z') }),
    // L4: the contact was deleted at the source -> excluded
    repo(9104, { contact_id: CDEL }),
    // L5: no contact_id at all -> quarantined
    repo(9105, { contact_id: undefined }),
    // L6: updatedAt before createdAt (soft DATES_SWAPPED); createdAt as an ISO string
    repo(9106, {
      contact_id: C3,
      createdAt: '2026-05-06T12:00:00Z',
      updatedAt: D('2026-05-06T11:00:00.000Z'),
    }),
    // L7: createdAt that is not a date (falls back to the ObjectId time), epoch seconds in updatedAt
    repo(9107, { contact_id: C3, createdAt: 'not a date', updatedAt: 1778000000 }),
    // L8: campaign keys that are filled
    repo(9108, {
      contact_id: C1,
      createdAt: D('2026-05-08T09:00:00.000Z'),
      campaignMedium: 'cpc',
      campaignName: 'summer',
      campaignSource: 'google',
    }),
  ];
  for (let i = 0; i < bulk; i++)
    leadrepo.push(
      repo(9200 + i, {
        contact_id: i % 2 === 0 ? C1 : C3,
        createdAt: D(`2026-06-${String((i % 27) + 1).padStart(2, '0')}T08:00:00.000Z`),
        attendees: String(i % 5),
      }),
    );
  // a repeated primary key: the engine keeps the first and quarantines the second
  leadrepo.push({ ...leadrepo[0]!, visitor_name: 'Repeat Tester' });

  const leads: J[] = [
    // S1: the same session as L2 -> excluded, it is the same lead
    {
      _id: O(9301),
      session_id: SESSION_WA,
      botid: 'c0000000-0000-4000-8000-000000000001',
      channel: 'whatsapp',
      module: 'chatbot',
      module_id: 'd0000000-0000-4000-8000-000000000001',
      updatedAt: D('2026-05-02T10:00:00.000Z'),
      visitor_name: 'Bhanu',
      visitor_phone: '9812345602',
      contact_id: C2,
    },
    // S2: a session leadrepo does not have -> loads under the leads source
    {
      _id: O(9302),
      session_id: 'e0000000-0000-4000-8000-000000000002',
      botid: 'c0000000-0000-4000-8000-000000000001',
      channel: 'whatsapp',
      module: 'chatbot',
      module_id: 'd0000000-0000-4000-8000-000000000001',
      updatedAt: D('2026-05-09T10:00:00.000Z'),
      visitor_name: 'Asha',
      visitor_phone: '9812345601',
      contact_id: C1,
      identity_id: null,
      faq: 'pricing_faq',
    },
    // S3: no contact_id (35% of the profile) -> quarantined
    {
      _id: O(9303),
      session_id: 'e0000000-0000-4000-8000-000000000003',
      botid: 'c0000000-0000-4000-8000-000000000001',
      channel: 'whatsapp',
      module: 'chatbot',
      module_id: 'd0000000-0000-4000-8000-000000000001',
      updatedAt: D('2026-05-10T10:00:00.000Z'),
      visitor_name: 'Nobody',
      visitor_phone: '9812345699',
    },
  ];

  const ft = (extra: J = {}): J => ({
    source: 'Import',
    channel: 'Import',
    platform: 'Geta',
    module_name: 'Contacts import',
    module_type: 'Contacts',
    medium_registry_id: null,
    source_registry_id: null,
    raw_utm_source: null,
    raw_utm_medium: null,
    raw_utm_campaign: null,
    raw_utm_content: null,
    raw_utm_term: null,
    captured_at: D('2026-03-01T10:00:00.000Z'),
    ...extra,
  });
  const attr = (n: number, contactHex: unknown, top: J, first: J | undefined): J => ({
    _id: O(n),
    contact_id: contactHex,
    source: 'Import',
    channel: 'Import',
    platform: 'Geta',
    module_name: 'Contacts import',
    module_type: 'Contacts',
    created_at: D('2026-03-01T10:00:00.000Z'),
    updated_at: D('2026-03-02T10:00:00.000Z'),
    ...(first ? { first_touch: first } : {}),
    ...top,
  });
  const contact_attribution: J[] = [
    attr(9401, O(9001), {}, ft()),
    // current touch differs from the first touch: only the first is imported (soft LATEST_TOUCH_DIFFERS); campaign from utm
    attr(
      9402,
      O(9002),
      { source: 'Landing Page', platform: 'Landing Page', channel: 'API' },
      ft({ raw_utm_campaign: 'spring', captured_at: D('2026-02-01T08:00:00.000Z') }),
    ),
    // no first_touch object: the top-level copy is used
    attr(
      9403,
      O(9003),
      { source: 'WhatsApp Direct', platform: 'WhatsApp', channel: 'WhatsApp' },
      undefined,
    ),
    // no source, platform or channel anywhere -> quarantined
    attr(
      9404,
      O(9001),
      { source: '', platform: '', channel: '' },
      ft({ source: '', platform: '', channel: '' }),
    ),
    // the contact is not in the dump -> quarantined
    attr(9405, O(9999), {}, ft()),
    // the contact was deleted at the source -> excluded
    attr(9406, O(9009), {}, ft()),
    // captured_at unreadable -> the document's created_at
    attr(9407, O(9003), {}, ft({ captured_at: 'later' })),
  ];
  return { contact_list: contacts, leadrepo, leads, contact_attribution };
}

export function globexLeads(): LeadDump {
  return {
    contact_list: [contact(9501, 'gx-con-0000000001', 'Gita', '9812345671')],
    leadrepo: [
      repo(9601, { contact_id: 'gx-con-0000000001', createdAt: D('2026-04-01T09:00:00.000Z') }),
    ],
    leads: [],
    contact_attribution: [attr0(9701, O(9501))],
  };
}

function attr0(n: number, contactId: unknown): J {
  return {
    _id: O(n),
    contact_id: contactId,
    source: 'Google Sheets',
    channel: 'Integration',
    platform: 'Google Sheets',
    module_name: 'Sheet A',
    module_type: 'Integration',
    created_at: D('2026-04-02T09:00:00.000Z'),
    updated_at: D('2026-04-02T09:00:00.000Z'),
    first_touch: {
      source: 'Google Sheets',
      channel: 'Integration',
      platform: 'Google Sheets',
      module_name: 'Sheet A',
      module_type: 'Integration',
      raw_utm_campaign: null,
      captured_at: D('2026-04-02T09:00:00.000Z'),
    },
  };
}
