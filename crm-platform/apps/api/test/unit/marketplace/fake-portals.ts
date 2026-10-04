import { createHmac } from 'node:crypto';
import type { FetchLike } from '../../../src/infra/providers/marketplace';

/**
 * Fake portal servers for the pull connector's tests: each is a `FetchLike` that behaves as the portal's own documentation says (what it
 * checks, what it answers, the limits it enforces), so a recipe is exercised against the rules of the real thing without any network. They
 * record every request. Nothing here talks to a real portal.
 */

type Init = Parameters<FetchLike>[1];
export interface Recorded {
  url: URL;
  method: string;
  headers: Record<string, string>;
  at: Date;
}

const IST_MS = 330 * 60_000;
const answer = (status: number, body: unknown, headers: Record<string, string> = {}) => ({
  status,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
});

// --- IndiaMART: https://help.indiamart.com/knowledge-base/lms-crm-integration-v2 ----------------------------------------------------------

export interface IndiaMartLead {
  UNIQUE_QUERY_ID: string;
  QUERY_TYPE: string;
  /** `YYYY-MM-DD HH:mm:ss`, in IST. */
  QUERY_TIME: string;
  SENDER_NAME: string;
  SENDER_MOBILE?: string;
  SENDER_EMAIL?: string;
  SENDER_COUNTRY_ISO: string;
  QUERY_MESSAGE?: string;
  [k: string]: string | undefined;
}

/** `DD-MM-YYYYHH:MM:SS` (IST), the format of the pull API's `start_time` and `end_time`. */
export function parseIndiaMartTime(v: string | null): number | null {
  const m = /^(\d{2})-(\d{2})-(\d{4})(\d{2}):(\d{2}):(\d{2})$/.exec(v ?? '');
  if (!m) return null;
  return Date.UTC(+m[3]!, +m[2]! - 1, +m[1]!, +m[4]!, +m[5]!, +m[6]!) - IST_MS;
}

const istStamp = (d: Date): string => {
  const s = new Date(d.getTime() + IST_MS).toISOString();
  return `${s.slice(0, 10)} ${s.slice(11, 19)}`;
};
export const indiaMartTimeOf = istStamp;

/**
 * The CRM listing API as IndiaMART documents it: `glusr_crm_key`, `start_time`, `end_time` (both required, at most 7 days apart, at most 365
 * days back); a key may be used once in 5 minutes and is blocked for 15 minutes beyond 5 hits in a minute; a key not used for 7 days has
 * expired; every answer is HTTP 200 whose body carries `CODE` (200, 204 for no leads, 400, 401, 429, 500).
 */
export class FakeIndiaMart {
  readonly requests: Recorded[] = [];
  leads: IndiaMartLead[] = [];
  expired = false;
  down = false;
  /** Answer errors with the HTTP status too (a portal that does both). */
  httpErrors = false;
  private hits: number[] = [];
  private blockedUntil = 0;
  private lastAccepted = 0;

  constructor(
    private readonly key: string,
    private readonly clock: () => Date,
  ) {}

  /** The key is blocked for this long from now (what IndiaMART does to a key used more than five times in a minute). */
  blockFor(ms: number): void {
    this.blockedUntil = this.clock().getTime() + ms;
  }

  readonly fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    const now = this.clock();
    this.requests.push({ url: u, method: init.method, headers: init.headers, at: now });
    const fail = (code: number, message: string) =>
      answer(this.httpErrors ? code : 200, { CODE: code, STATUS: 'FAILURE', MESSAGE: message });
    if (this.down) return answer(500, 'Internal Server Error');
    if (u.origin !== 'https://mapi.indiamart.com' || u.pathname !== '/wservce/crm/crmListing/v2/')
      return answer(404, 'not here');

    const t = now.getTime();
    this.hits = [...this.hits.filter((h) => h > t - 60_000), t];
    if (this.hits.length > 5) this.blockedUntil = t + 15 * 60_000;
    if (t < this.blockedUntil) return fail(429, 'Too Many Requests');

    if (u.searchParams.get('glusr_crm_key') !== this.key)
      return fail(
        401,
        'Pull API Key that you are using is incorrect. Kindly use the correct Pull API Key as provided in the email.',
      );
    if (this.expired)
      return fail(
        401,
        'Pull API Key that you are using has expired as it was no longer in use. Kindly generate the new Pull API Key and use the new Pull API Key in API URL',
      );
    const start = parseIndiaMartTime(u.searchParams.get('start_time'));
    const end = parseIndiaMartTime(u.searchParams.get('end_time'));
    if (start === null || end === null)
      return fail(400, 'Please enter both the date parameters start date and end date');
    if (end - start > 7 * 86_400_000) return fail(400, 'The date range can be at most 7 days.');
    if (start < t - 365 * 86_400_000)
      return fail(
        400,
        'You can fetch the data for the last 365 days only. Kindly change the Start Time or End Time accordingly',
      );
    if (t - this.lastAccepted < 5 * 60_000 && this.lastAccepted !== 0)
      return fail(
        429,
        'It is advised to hit this API once in every 5 minutes,but it seems that you have crossed this limit. Please try again after 5 minutes.',
      );
    this.lastAccepted = t;

    const inside = this.leads.filter((l) => {
      const at = Date.parse(`${l.QUERY_TIME.replace(' ', 'T')}Z`) - IST_MS;
      return at >= start && at <= end;
    });
    if (inside.length === 0)
      return answer(this.httpErrors ? 204 : 200, {
        CODE: 204,
        STATUS: 'FAILURE',
        MESSAGE:
          'There are no leads in the given time duration. Please try for a different duration.',
      });
    return answer(200, {
      CODE: 200,
      STATUS: 'SUCCESS',
      TOTAL_RECORDS: inside.length,
      RESPONSE: inside,
    });
  };
}

// --- Housing.com: the Developer's CRM Integration Document ---------------------------------------------------------------------------

export interface HousingLead {
  lead_name: string;
  lead_phone: string;
  lead_email: string | null;
  project_id: number;
  project_name: string;
  locality: string;
  /** Epoch seconds, as a string. */
  lead_date: string;
}

/**
 * `GET /api/v0/get-builder-leads?start_date&end_date&current_time&hash&id`: the hash is HMAC-SHA256 (hex) of `current_time` keyed with the
 * account's secret; a request is refused 401 for a wrong hash or id, or a `current_time` more than 15 minutes from the server's own; 422
 * for a missing parameter. The answer is a list of leads (the document shows the fields, not a wrapper): `wrapper` makes it an object that
 * holds the list, to prove either is read.
 */
export class FakeHousing {
  readonly requests: Recorded[] = [];
  leads: HousingLead[] = [];
  wrapper: 'list' | 'object' = 'list';

  constructor(
    private readonly id: string,
    private readonly secret: string,
    private readonly clock: () => Date,
  ) {}

  readonly fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    const now = this.clock();
    this.requests.push({ url: u, method: init.method, headers: init.headers, at: now });
    if (u.origin !== 'https://leads.housing.com' || u.pathname !== '/api/v0/get-builder-leads')
      return answer(404, 'not here');
    const p = u.searchParams;
    for (const name of ['start_date', 'end_date', 'current_time', 'hash', 'id'])
      if (!p.get(name)) return answer(422, { error: `${name} is missing` });
    if (
      !/^\d+$/.test(p.get('start_date')!) ||
      !/^\d+$/.test(p.get('end_date')!) ||
      !/^\d+$/.test(p.get('current_time')!)
    )
      return answer(422, { error: 'badly formatted' });
    const expected = createHmac('sha256', this.secret).update(p.get('current_time')!).digest('hex');
    const skew = Math.abs(now.getTime() / 1000 - Number(p.get('current_time')));
    if (p.get('hash') !== expected || p.get('id') !== this.id || skew > 15 * 60)
      return answer(401, { error: 'unauthorised' });
    const from = Number(p.get('start_date'));
    const to = Number(p.get('end_date'));
    const inside = this.leads.filter(
      (l) => Number(l.lead_date) >= from && Number(l.lead_date) <= to,
    );
    return answer(200, this.wrapper === 'list' ? inside : { leads: inside });
  };
}

// --- TradeIndia: the "My Inquiry API" as integrators describe it -----------------------------------------------------------------------

export interface TradeIndiaLead {
  rfi_id: string;
  sender_name: string;
  sender_mobile: string;
  sender_email?: string;
  product_name?: string;
  message?: string;
  /** Fake-only: the day (YYYY-MM-DD) the portal would filter on. */
  day: string;
}

export class FakeTradeIndia {
  readonly requests: Recorded[] = [];
  leads: TradeIndiaLead[] = [];

  constructor(
    private readonly userId: string,
    private readonly profileId: string,
    private readonly key: string,
  ) {}

  readonly fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    this.requests.push({ url: u, method: init.method, headers: init.headers, at: new Date() });
    if (u.origin !== 'https://www.tradeindia.com' || u.pathname !== '/utils/my_inquiry.html')
      return answer(404, 'not here');
    const p = u.searchParams;
    if (
      p.get('userid') !== this.userId ||
      p.get('profile_id') !== this.profileId ||
      p.get('key') !== this.key
    )
      return answer(403, 'forbidden');
    const from = p.get('from_date') ?? '';
    const to = p.get('to_date') ?? '';
    return answer(
      200,
      this.leads.filter((l) => l.day >= from && l.day <= to),
    );
  };
}

export type { Init as FetchInit };
