import { describe, expect, it } from 'vitest';
import { ERROR_CODES, WA_DEVICE_GROUP_EVENTS } from '@crm/contracts';
import {
  digitsOf,
  e164Of,
  eventsFor,
  groupFailure,
  groupRefusal,
  inviteUrlOf,
  peopleOf,
  personRefs,
  pictureKind,
  previewOf,
  resultsFor,
  rosterAfter,
  type GroupFacts,
} from '../../../src/modules/whatsapp-devices-baileys/device-groups-rules';

const facts = (over: Partial<GroupFacts> = {}): GroupFacts => ({
  subject: 'Team',
  description: null,
  size: 2,
  isAdmin: true,
  announce: false,
  restrict: false,
  joinApproval: false,
  memberAddMode: 'all_member_add',
  left: false,
  roster: [
    { jid: '911@s.whatsapp.net', admin: 'superadmin' },
    { jid: '912@s.whatsapp.net', admin: null },
  ],
  pending: 0,
  ...over,
});

describe('numbers', () => {
  it('turns E.164 into digits and back, and refuses what is not a number', () => {
    expect(digitsOf('+91 98765-43210')).toBe('919876543210');
    expect(e164Of('919876543210')).toBe('+919876543210');
    expect(e164Of('12')).toBeNull();
    expect(e164Of(null)).toBeNull();
  });

  it('collapses duplicates and refuses the connected number itself', () => {
    const r = peopleOf(
      ['+919800000001', '+919800000001', '+919800000002', '+919000000001'],
      '919000000001',
    );
    expect(r.people.map((p) => p.number)).toEqual(['+919800000001', '+919800000002']);
    expect(r.invalid).toEqual(['+919000000001']);
  });

  it('builds the invite url from a code (the only place a code becomes a link)', () => {
    expect(inviteUrlOf('AbCdEf1234567890abcdef')).toBe(
      'https://chat.whatsapp.com/AbCdEf1234567890abcdef',
    );
  });
});

describe('what became of each person', () => {
  const asked = [
    { number: '+919800000001', digits: '919800000001' },
    { number: '+919800000002', digits: '919800000002' },
    { number: '+919800000003', digits: '919800000003' },
  ];

  it('reads WhatsApp status codes per person, in the order asked, and counts', () => {
    const r = resultsFor('add', asked, [
      { jid: '919800000001@s.whatsapp.net', status: '200' },
      { jid: '919800000002@s.whatsapp.net', status: '403' },
      { jid: '919800000003@s.whatsapp.net', status: '409' },
    ]);
    expect(r.results).toEqual([
      { number: '+919800000001', outcome: 'ok', code: '200' },
      { number: '+919800000002', outcome: 'privacy_blocked', code: '403' },
      { number: '+919800000003', outcome: 'already_member', code: '409' },
    ]);
    expect(r.okCount).toBe(1);
    expect(r.failCount).toBe(2);
  });

  it('a person WhatsApp said nothing about is failed, never silently ok', () => {
    const r = resultsFor('remove', asked, [{ jid: '919800000001@s.whatsapp.net', status: '200' }]);
    expect(r.results.map((x) => x.outcome)).toEqual(['ok', 'failed', 'failed']);
    expect(r.results[1]!.code).toBeNull();
  });

  it('pairs by position when the answer names members by anonymous ids and the count matches', () => {
    const r = resultsFor('promote', asked.slice(0, 2), [
      { jid: '1111@lid', status: '200' },
      { jid: '2222@lid', status: '404' },
    ]);
    expect(r.results.map((x) => x.outcome)).toEqual(['ok', 'not_member']);
  });

  it('matches a member that is known by an anonymous id by the id the request used', () => {
    const roster = [
      { jid: '777@lid', phone: '919800000001', lid: '777', name: null, admin: null as null },
    ];
    const refs = personRefs([asked[0]!, asked[1]!], roster);
    expect(refs[0]!.jid).toBe('777@lid');
    expect(refs[1]!.jid).toBeUndefined();
    const r = resultsFor('remove', refs, [
      { jid: '777@lid', status: '200' },
      { jid: '919800000002@s.whatsapp.net', status: '404' },
    ]);
    expect(r.results.map((x) => x.outcome)).toEqual(['ok', 'not_member']);
  });
});

describe('the roster after a change we made', () => {
  const roster = [
    {
      jid: '911@s.whatsapp.net',
      phone: '911',
      lid: null,
      name: 'Me',
      admin: 'superadmin' as const,
    },
    { jid: '912@s.whatsapp.net', phone: '912', lid: null, name: 'Asha', admin: null },
  ];
  const p = (digits: string) => ({ number: `+${digits}`, digits });

  it('adds and removes people and says how the size moved', () => {
    const added = rosterAfter(roster, 'add', [p('913'), p('912')]);
    expect(added.roster.map((m) => m.phone)).toEqual(['911', '912', '913']);
    expect(added.sizeDelta).toBe(1);
    const removed = rosterAfter(roster, 'remove', [p('912'), p('999')]);
    expect(removed.roster.map((m) => m.phone)).toEqual(['911']);
    expect(removed.sizeDelta).toBe(-1);
  });

  it('promotes and demotes, never demoting the owner, and leaves the input alone', () => {
    const up = rosterAfter(roster, 'promote', [p('912')]);
    expect(up.roster[1]!.admin).toBe('admin');
    const down = rosterAfter(up.roster, 'demote', [p('912'), p('911')]);
    expect(down.roster.map((m) => m.admin)).toEqual(['superadmin', null]);
    expect(roster[1]!.admin).toBeNull();
  });
});

describe('a failed command becomes a stable problem+json error', () => {
  const status = (e: ReturnType<typeof groupFailure>) => e.getStatus();

  it('the limiter refusal is 429 with retryAfterS and scope', () => {
    const e = groupFailure({
      ok: false,
      status: 'rate_limited',
      message: 'x',
      retryAfterSeconds: 41.2,
      scope: 'ops_minute',
    });
    expect(e.code).toBe(ERROR_CODES.WA_GROUP_RATE_LIMITED);
    expect(status(e)).toBe(429);
    expect(e.details).toEqual([
      { path: 'retryAfterS', message: '42' },
      { path: 'scope', message: 'ops_minute' },
    ]);
  });

  it('the cooldown has its own wording', () => {
    const e = groupFailure({
      ok: false,
      status: 'rate_limited',
      message: 'x',
      retryAfterSeconds: 300,
      scope: 'cooldown',
    });
    expect(e.message).toMatch(/resting/);
  });

  it.each([
    [{ ok: false, status: 'not_ready', message: 'm' }, ERROR_CODES.WA_GROUP_DEVICE_NOT_READY, 409],
    [
      { ok: false, status: 'disabled', message: 'm' },
      ERROR_CODES.WA_GROUP_JOIN_BY_LINK_DISABLED,
      422,
    ],
    [{ ok: false, status: 'timeout', message: 'm' }, ERROR_CODES.WA_WORKER_UNAVAILABLE, 503],
    [
      { ok: false, status: 'error', message: 'The WhatsApp worker is not running.' },
      ERROR_CODES.WA_WORKER_UNAVAILABLE,
      503,
    ],
    [
      { ok: false, status: 'error', message: 'At most 20 people per call.' },
      ERROR_CODES.VALIDATION_FAILED,
      422,
    ],
    [
      { ok: false, status: 'group_failed', reason: 'not_admin', message: 'm' },
      ERROR_CODES.WA_GROUP_NOT_ADMIN,
      403,
    ],
    [
      { ok: false, status: 'group_failed', reason: 'not_found', message: 'm' },
      ERROR_CODES.WA_GROUP_NOT_FOUND,
      404,
    ],
    [
      { ok: false, status: 'group_failed', reason: 'limit_reached', message: 'm' },
      ERROR_CODES.WA_GROUP_LIMIT_REACHED,
      422,
    ],
    [
      { ok: false, status: 'group_failed', reason: 'bad_invite', message: 'm' },
      ERROR_CODES.WA_GROUP_JOIN_LINK_INVALID,
      422,
    ],
    [
      { ok: false, status: 'group_failed', reason: 'whatsapp_rate_limited', message: 'm' },
      ERROR_CODES.WA_GROUP_RATE_LIMITED,
      429,
    ],
    [
      { ok: false, status: 'group_failed', reason: 'forbidden', message: 'm' },
      ERROR_CODES.WA_GROUP_UNAVAILABLE,
      502,
    ],
    [
      { ok: false, status: 'group_failed', reason: 'unknown', message: 'm' },
      ERROR_CODES.WA_GROUP_UNAVAILABLE,
      502,
    ],
  ] as const)('%j', (res, code, http) => {
    const e = groupFailure(res as never);
    expect(e.code).toBe(code);
    expect(status(e)).toBe(http);
  });

  it("never repeats the library's own text (it can carry ids)", () => {
    const e = groupRefusal('unknown');
    expect(e.message).not.toMatch(/@/);
  });
});

describe('what a change to a group announces', () => {
  const types = (d: ReturnType<typeof eventsFor>) => d.map((e) => e.type);

  it('a new row is created; the number coming back is created too', () => {
    expect(types(eventsFor(null, facts()))).toEqual([WA_DEVICE_GROUP_EVENTS.created]);
    const back = eventsFor(facts({ left: true }), facts());
    expect(back).toEqual([
      { type: WA_DEVICE_GROUP_EVENTS.created, extra: { changed: ['rejoined'] } },
    ]);
  });

  it('nothing changed announces nothing', () => {
    expect(eventsFor(facts(), facts())).toEqual([]);
  });

  it('names what moved: subject, settings and admin rights', () => {
    const d = eventsFor(facts(), facts({ subject: 'Renamed', announce: true, isAdmin: false }));
    expect(d).toEqual([
      {
        type: WA_DEVICE_GROUP_EVENTS.updated,
        extra: { changed: ['subject', 'settings', 'admin'] },
      },
    ]);
  });

  it('counts people who came, went or changed role, and never names them', () => {
    const d = eventsFor(
      facts(),
      facts({
        size: 2,
        roster: [
          { jid: '911@s.whatsapp.net', admin: 'superadmin' },
          { jid: '913@s.whatsapp.net', admin: null },
        ],
      }),
    );
    expect(d).toEqual([
      {
        type: WA_DEVICE_GROUP_EVENTS.participantsChanged,
        extra: { added: 1, removed: 1, roles: 0, size: 2 },
      },
    ]);
    const roles = eventsFor(
      facts(),
      facts({
        roster: [
          { jid: '911@s.whatsapp.net', admin: 'superadmin' },
          { jid: '912@s.whatsapp.net', admin: 'admin' },
        ],
      }),
    );
    expect(roles[0]!.extra).toMatchObject({ added: 0, removed: 0, roles: 1 });
  });

  it('a queue that grew is a join request with the pending count; one that shrank on its own is settled', () => {
    expect(eventsFor(facts(), facts({ pending: 2 }))).toEqual([
      { type: WA_DEVICE_GROUP_EVENTS.joinRequest, extra: { handled: null, added: 2, pending: 2 } },
    ]);
    expect(eventsFor(facts({ pending: 2 }), facts({ pending: 0 }))).toEqual([
      { type: WA_DEVICE_GROUP_EVENTS.joinRequest, extra: { handled: 'settled', pending: 0 } },
    ]);
  });

  it('leaving says whether someone else removed the number', () => {
    expect(eventsFor(facts(), facts({ left: true }), { removed: true })).toEqual([
      { type: WA_DEVICE_GROUP_EVENTS.left, extra: { removed: true } },
    ]);
    expect(eventsFor(facts(), facts({ left: true }))[0]!.extra).toEqual({ removed: false });
  });

  it('no payload carries a subject, a number or a code', () => {
    const all = [
      ...eventsFor(null, facts()),
      ...eventsFor(facts(), facts({ subject: 'Secret club', pending: 3, size: 9 })),
      ...eventsFor(facts(), facts({ left: true }), { removed: true }),
    ];
    const text = JSON.stringify(all);
    expect(text).not.toMatch(/Secret club|@s\.whatsapp\.net|chat\.whatsapp\.com/);
  });
});

describe('list rows and pictures', () => {
  it('previews at most five members, admins first, names and roles only', () => {
    const roster = Array.from({ length: 8 }, (_, i) => ({
      name: `M${i}`,
      admin: i === 6 ? ('admin' as const) : i === 7 ? ('superadmin' as const) : null,
    }));
    const p = previewOf(roster);
    expect(p).toHaveLength(5);
    expect(p[0]).toEqual({ name: 'M7', admin: 'superadmin' });
    expect(p[1]).toEqual({ name: 'M6', admin: 'admin' });
    expect(Object.keys(p[2]!).sort()).toEqual(['admin', 'name']);
  });

  it('recognises JPEG and PNG by their bytes, not by the declared type', () => {
    expect(pictureKind(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0]))).toBe('image/jpeg');
    expect(pictureKind(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe(
      'image/png',
    );
    expect(pictureKind(Buffer.from('GIF89a'))).toBeNull();
    expect(pictureKind(Buffer.from('<svg></svg>'))).toBeNull();
    expect(pictureKind(Buffer.alloc(0))).toBeNull();
  });
});
