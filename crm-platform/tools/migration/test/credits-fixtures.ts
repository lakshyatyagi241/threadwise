/**
 * INVENTED credit logs and billing-log rows for the credits tests. Shapes follow the masked pilot profiles (`credit_logs`: a double
 * `credits_deducted`, integer token counters, `new_balance`, `created_time` as a BSON date, `type: openai_api`, `user_id` always null;
 * `whatsapp_broadcasting_data`: mixed int / double amounts, `source` automation / inbox / test). Every value and id is made up.
 */
import { O } from './fixtures';

type J = Record<string, unknown>;
export const D = (iso: string): J => ({ $date: iso });
/** an Extended JSON double, so NaN and Infinity reach the tool the way a dump spells them */
export const DBL = (s: string): J => ({ $numberDouble: s });

let n0 = 3_000_000;
export const WS_ACME = 'ws-acme-00000000000000001';

export interface ClOpts {
  amount?: unknown;
  at?: unknown | null;
  ws?: string;
  tokens?: unknown;
  input?: unknown;
  output?: unknown;
  cached?: unknown;
  user?: string | null;
  type?: string | null;
  model?: string | null;
  balance?: unknown;
  id?: J;
  extra?: J;
  /** keys left out of the document altogether */
  omit?: string[];
}

/** One credit_logs document. By default an AI call that cost 0.5 credits on 2026-05-01 at 10:00 UTC. */
export function cl(o: ClOpts = {}): J {
  const d: J = {
    _id: o.id ?? O(n0++),
    workspace_id: o.ws ?? WS_ACME,
    credits_deducted: o.amount === undefined ? 0.5 : o.amount,
    tokens_used: o.tokens === undefined ? 130 : o.tokens,
    input_tokens: o.input === undefined ? 50 : o.input,
    output_tokens: o.output === undefined ? 80 : o.output,
    cached_input_tokens: o.cached === undefined ? 10 : o.cached,
    new_balance: o.balance === undefined ? 999.5 : o.balance,
    action: 'ai_reply',
    created_time: o.at === undefined ? D('2026-05-01T10:00:00.000Z') : o.at,
    module: 'chatbot',
    description: 'AI reply',
    cost: 0.0012,
    type: o.type === undefined ? 'openai_api' : o.type,
    model: o.model === undefined ? 'openai/gpt-4o-mini' : o.model,
    user_id: o.user === undefined ? null : o.user,
    ...(o.extra ?? {}),
  };
  for (const k of o.omit ?? []) delete d[k];
  return Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined));
}

export interface WbOpts {
  source?: string;
  msg?: string | null;
  at?: unknown | null;
  amount?: unknown;
  category?: string;
  broadcast?: string | null;
  revert?: boolean;
  id?: J;
  extra?: J;
}

/** One whatsapp_broadcasting_data document. By default an automation send. */
export function wb(o: WbOpts = {}): J {
  const source = o.source ?? 'automation';
  const d: J = {
    _id: o.id ?? O(n0++),
    id: `cr-wb-${n0}`,
    contact_id: 'cr-contact-1',
    amount: o.amount === undefined ? 0.35 : o.amount,
    reseller_amount: 0.05,
    reseller_margin: 1,
    meta_template_id: '123456789012345',
    message_id: o.msg === undefined ? `wamid.cr.${n0}` : o.msg,
    phone_no: '+919812345671',
    status: { sent: D('2026-05-02T09:00:00.000Z'), delivered: D('2026-05-02T09:00:05.000Z') },
    error: null,
    revert: o.revert ?? false,
    created_time: o.at === undefined ? D('2026-05-02T09:00:00.000Z') : o.at,
    source,
    template_category: o.category ?? 'utility',
    cost_description: 'utility',
    origin: source === 'automation' ? 'flow' : null,
    conversation_id: null,
    run_id: null,
    broadcast_id: o.broadcast === undefined ? null : o.broadcast,
    ...(o.extra ?? {}),
  };
  return Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined));
}

export const userDoc = (n: number, userId: string, email: string): J => ({
  _id: O(n),
  user_id: userId,
  email,
  username: email,
  first_name: 'Agent',
  last_name: String(n),
  is_staff: false,
  is_active: true,
  is_deleted: false,
  deleted_time: null,
  is_email_verified: true,
  created_time: D('2026-01-02T09:00:00.000Z'),
  modified_time: D('2026-01-02T09:00:00.000Z'),
  role_id: null,
});

export const OPENING_ACME = {
  amount: '100.25',
  currency: 'INR',
  asOf: '2026-07-01T00:00:00Z',
  confirmedBy: 'Test Operator, Waboo billing screen, invented figure',
};
export const OPENING_GLOBEX = {
  amount: '7.00',
  currency: 'USD',
  asOf: '2026-07-01T00:00:00Z',
  confirmedBy: 'Other Operator, invoice 0001 (invented)',
};

export const U1 = 'usr-cr-01';

export interface CreditsDump {
  credit_logs: J[];
  whatsapp_broadcasting_data: J[];
  user: J[];
}

/** acme: every case of spec B sections 3.4 and 3.8 that a document can express, in the order they would be written. */
export function acmeCredits(): CreditsDump {
  const rows: J[] = [];
  const add = (...r: J[]): void => {
    rows.push(...r);
  };
  const t = (h: number, m = 0): J =>
    D(`2026-05-01T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`);
  add(
    cl({ amount: 0.2, at: t(10, 0) }), // exact in two decimals
    cl({ amount: 0.004, at: t(10, 1) }), // below the ledger precision
    cl({ amount: 0.005, at: t(10, 2) }), // rounds UP to 0.01 (residual +0.005)
    cl({ amount: 3.5, at: t(10, 3) }),
    cl({ amount: 0.0049, at: t(10, 4) }), // below
    cl({ amount: 2.675, at: t(10, 5) }), // the text says 2.675, so 2.68
    cl({ amount: 0, at: t(10, 6) }), // an int zero
    cl({ amount: -1.5, at: t(10, 7) }), // negative: quarantined, never a refund
    cl({ amount: '3.5', at: t(10, 8) }), // a numeric string
    cl({ amount: DBL('NaN'), at: t(10, 9) }),
    cl({ amount: DBL('Infinity'), at: t(10, 10) }),
    cl({ amount: 0.5, at: null }), // no date at all: wallet AND tokens are quarantined NO_DATE
    cl({ amount: 0.5, at: t(10, 12), tokens: 120.0, input: 50, output: 80 }), // 120 < 50 + 80: TOKEN_TOTAL_MISMATCH, stored 130
    cl({ amount: 0.5, at: t(10, 13), tokens: '250', input: 100, output: 100 }), // a string counter, bigger than the sum: kept
    cl({ amount: 0.75, at: t(10, 14), user: U1 }), // a migrated user
    cl({ amount: 0.75, at: t(10, 15), user: 'ghost-user' }), // a user nobody has: USER_UNRESOLVED
    cl({ amount: 0.3, at: t(10, 16), id: O(3_100_001) }),
    cl({ amount: 0.3, at: t(10, 16), id: O(3_100_001) }), // the same _id twice: DUPLICATE_KEY
    cl({ amount: 0.11, at: t(10, 17), id: O(3_100_003) }),
    cl({ amount: 0.12, at: t(10, 17), id: O(3_100_002) }), // the same instant: ordered by _id
    cl({ amount: 1.0, at: D('2025-12-31T23:59:59.999Z') }), // older than the rest, still valid
    cl({ amount: 1.0, at: D('1900-01-01T00:00:00.000Z') }), // outside the partition window: BAD_DATE
    cl({ amount: 1_000_000_000_000, at: t(10, 20) }), // a huge number: AMOUNT_OVER_LIMIT
    cl({ amount: 5_000_000.55, at: t(10, 21) }), // a big one that is fine
    cl({ amount: 0.5, at: 1_777_700_000_000 }), // an epoch number (ms)
    cl({ amount: 0.5, at: '2026-05-02T08:00:00Z' }), // an ISO string
    cl({ amount: 0.5, at: t(10, 24), type: 'stripe_refund', model: null }), // an unknown type: UNKNOWN_CREDIT_TYPE, PROVIDER_GUESS
    cl({ amount: 1e-7, at: t(10, 25) }), // exponent form, below the precision
    cl({ amount: 0.1 + 0.2, at: t(10, 26) }), // 0.30000000000000004
    cl({ amount: 0.5, at: t(10, 27), tokens: -5, input: 2_147_483_648, output: 'many' }), // BAD_TOKEN_COUNT x3
    cl({
      amount: 0.5,
      at: t(10, 28),
      omit: ['tokens_used', 'input_tokens', 'output_tokens', 'cached_input_tokens'],
    }), // no counters at all
    cl({ amount: 0.5, omit: ['created_time'] }), // the date key missing altogether
    cl({ omit: ['credits_deducted'], at: t(10, 30) }), // the amount key missing altogether
  );
  // ... and enough rows to cross the batch size (7) many times, in two months
  for (let i = 0; i < 40; i++)
    add(
      cl({
        amount: 0.01 * ((i % 9) + 1) + (i % 4 === 0 ? 0.0004 : 0),
        at: D(
          `2026-0${5 + (i % 2)}-${String(3 + (i % 20)).padStart(2, '0')}T11:${String(i).padStart(2, '0')}:00.000Z`,
        ),
        tokens: 100 + i,
        input: 40 + i,
        output: 60,
      }),
    );

  const billing: J[] = [
    wb({ msg: 'wamid.cr.auto1', source: 'automation', amount: 0.35, category: 'utility' }),
    wb({ msg: 'wamid.cr.auto2', source: 'automation', amount: 1, category: 'marketing' }),
    wb({ msg: 'wamid.cr.inbox1', source: 'inbox', amount: 0, category: 'service' }),
    wb({ msg: 'wamid.cr.test1', source: 'test', category: 'authentication' }),
    wb({ msg: 'wamid.cr.bnobid', source: 'broadcast', broadcast: null }), // a broadcast row with no broadcast_id: not a recipient, a charge
    wb({ msg: 'wamid.cr.auto1', source: 'automation' }), // the same wamid again: DUPLICATE_WAMID
    wb({ msg: null, source: 'automation' }), // no message id: NO_MESSAGE_ID
    wb({ msg: 'wamid.cr.nodate', at: null }), // NO_DATE
    wb({
      msg: 'wamid.cr.reverted',
      revert: true,
      amount: 0.35,
      extra: { reverted_at: D('2026-05-03T00:00:00.000Z'), refund_run_id: 'run-1' },
    }),
    wb({ msg: 'wamid.cr.weird', category: 'weird', amount: DBL('NaN') }), // unknown category, a bad amount
    wb({ msg: 'wamid.cr.old', at: D('1900-01-01T00:00:00.000Z') }), // BAD_DATE
    // a real broadcast recipient: not a charge here (the broadcast step owns it; its campaign is missing, so it is quarantined there)
    wb({ msg: 'wamid.cr.bcast1', source: 'broadcast', broadcast: 'bc-nowhere' }),
  ];

  return {
    credit_logs: rows,
    whatsapp_broadcasting_data: billing,
    user: [userDoc(8201, U1, 'agent.cr@example.test')],
  };
}

/** globex: a second client with its own organization, wallet and currency. */
export function globexCredits(): CreditsDump {
  const WS = 'ws-globex-0000000000000001';
  return {
    credit_logs: [
      cl({ ws: WS, amount: 0.25, at: D('2026-04-01T10:00:00.000Z') }),
      cl({ ws: WS, amount: 1.005, at: D('2026-04-02T10:00:00.000Z') }),
      cl({
        ws: WS,
        amount: 2,
        at: D('2026-04-03T10:00:00.000Z'),
        tokens: 300,
        input: 100,
        output: 200,
      }),
    ],
    whatsapp_broadcasting_data: [
      wb({ msg: 'wamid.cr.auto1', source: 'automation' }), // the same wamid as acme's: another organization, no clash
      wb({ msg: 'wamid.cr.gx2', source: 'inbox' }),
    ],
    user: [],
  };
}

/** initech: credit rows and NO opening file. */
export function initechCredits(): CreditsDump {
  return {
    credit_logs: [cl({ ws: 'ws-initech', amount: 1.5, at: D('2026-03-01T10:00:00.000Z') })],
    whatsapp_broadcasting_data: [wb({ msg: 'wamid.cr.it1' })],
    user: [],
  };
}

/** umbrella: two Waboo workspaces in one dump. */
export function umbrellaCredits(): CreditsDump {
  return {
    credit_logs: [
      cl({ ws: 'ws-umb-A', amount: 1, at: D('2026-03-01T10:00:00.000Z') }),
      cl({ ws: 'ws-umb-A', amount: 2, at: D('2026-03-02T10:00:00.000Z') }),
      cl({ ws: 'ws-umb-B', amount: 4, at: D('2026-03-03T10:00:00.000Z') }),
    ],
    whatsapp_broadcasting_data: [],
    user: [],
  };
}

/** n credit rows over `months` months, roughly 3 in 4 of them money rows, plus `usage` billing rows. For the volume test. */
export function bulkCredits(n: number, usage: number): CreditsDump {
  const rows: J[] = [];
  for (let i = 0; i < n; i++) {
    const day = (i % 27) + 1;
    const month = (i % 6) + 1;
    rows.push(
      cl({
        ws: 'ws-bulk',
        amount:
          i % 4 === 3
            ? 0.003
            : Number(((i % 997) / 100 + 0.01).toFixed(2)) + (i % 5 === 0 ? 0.0004 : 0),
        at: D(
          `2026-0${month}-${String(day).padStart(2, '0')}T${String(i % 24).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:${String((i * 7) % 60).padStart(2, '0')}.000Z`,
        ),
        tokens: 100 + (i % 50),
        input: 40 + (i % 30),
        output: 60,
      }),
    );
  }
  const billing: J[] = [];
  for (let i = 0; i < usage; i++)
    billing.push(
      wb({ msg: `wamid.bulk.${i}`, source: i % 3 === 0 ? 'inbox' : 'automation', amount: 0.35 }),
    );
  return { credit_logs: rows, whatsapp_broadcasting_data: billing, user: [] };
}
