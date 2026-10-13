import { minorText, minorText4, plainDecimal, scaledText } from '../credits/decimal';
import {
  clip,
  isNonBroadcast,
  providerOf,
  tokensVerdict,
  USAGE_CATEGORIES,
  usageVerdict,
  walletVerdict,
  windowOf,
} from '../credits/rules';
import { bool, primaryKey, str, toDate, type Doc } from '../util';
import { c } from './common';
import type { Ctx, FieldMap, HandlerSpec, Outcome, Soft } from './types';

/**
 * credit_logs -> wallet_transactions (credit_wallet) and ai_token_usage (credit_tokens); the NON_BROADCAST rows of
 * whatsapp_broadcasting_data -> usage_charges (+ usage_charge_keys) (usage_charges). Spec B sections 3 and 4.2; the decisions are in the
 * README ("Stage 2: credits").
 *
 * Money: amounts are decimal TEXT end to end. A spend is `-round2(credits_deducted)` (half away from zero on the decimal text, rows that
 * round to less than 0.01 are not ledger rows and are counted), `balance_after` comes from the plan (the confirmed opening balance minus the
 * spends up to this row), and nothing is ever UPDATEd (the ledger is immutable by trigger, and touch_row would stamp updated_at).
 * No event_outbox row, notification, audit row, wallet event or usage-month counter is written; no INSERT trigger exists on any of the tables.
 */

const SOURCE_AI = 'waboo_ai';
const ACTOR = 'waboo-migration';
export const WALLET_SOURCE = SOURCE_AI;
export const OPENING_SOURCE = 'waboo_migration';

const NOT_PRESENT_TOKENS =
  'drop:NOT PRESENT in ai_token_usage (no column); the credit_wallet step carries it in wallet_transactions.meta when a wallet row exists';

export const CREDIT_WALLET_FIELDS: FieldMap = {
  _id: 'id (wallet_transactions.uuid and idempotency_key waboo:<client>:credit_log:<_id> are derived from it; registered in migration.id_map)',
  id: 'id (registered in migration.id_map when present)',
  workspace_id:
    'drop:the organization is per client; more than one distinct value stops the wallet part unless --credit-workspace-id picks the one',
  credits_deducted:
    'col:amount (negative, 2 decimals, half away from zero on the decimal text; below 0.01 is not a ledger row; the exact text is kept in meta.legacy.waboo.credits_deducted)',
  new_balance:
    'drop:NOT PRESENT as a column; kept as an exact text in meta.legacy.waboo.new_balance. balance_after is computed from the confirmed opening balance, NOT from this field (WhatsApp debits and purchases are not in credit_logs)',
  created_time: 'col:created_at, updated_at',
  description: 'col:description (500 characters at most)',
  action: 'col:meta.legacy.waboo.action',
  module: 'col:meta.legacy.waboo.module',
  type: 'col:meta.legacy.waboo.type',
  model: 'col:meta.legacy.waboo.model',
  cost: 'col:meta.legacy.waboo.cost (exact text; the vendor cost of the call)',
  bot_id: 'col:meta.legacy.waboo.bot_id',
  user_id: 'col:user_id (id_map of the migrated user; soft USER_UNRESOLVED when there is none)',
  tokens_used: 'col:meta.legacy.waboo.tokens (the counter itself goes to ai_token_usage)',
  input_tokens: 'col:meta.legacy.waboo.tokens (the counter itself goes to ai_token_usage)',
  output_tokens: 'col:meta.legacy.waboo.tokens (the counter itself goes to ai_token_usage)',
  cached_input_tokens: 'col:meta.legacy.waboo.tokens (the counter itself has no column)',
};

export const CREDIT_TOKEN_FIELDS: FieldMap = {
  _id: 'id (registered in migration.id_map: target ai_token_usage.id, the table has no source-key column)',
  id: 'id (registered in migration.id_map when present)',
  workspace_id: 'drop:the organization is per client (see credit_wallet)',
  type: 'col:provider (openai_api -> openai; else the vendor prefix of the model; else "unknown" with a soft PROVIDER_GUESS)',
  model: 'col:model',
  input_tokens: 'col:prompt_tokens',
  output_tokens: 'col:completion_tokens',
  tokens_used:
    'col:total_tokens (Waboo figure when it is at least input + output, else their sum with a soft TOKEN_TOTAL_MISMATCH)',
  cached_input_tokens: NOT_PRESENT_TOKENS,
  created_time: 'col:created_at',
  credits_deducted: `${NOT_PRESENT_TOKENS} (money is a wallet matter)`,
  new_balance: `${NOT_PRESENT_TOKENS} (money is a wallet matter)`,
  action: NOT_PRESENT_TOKENS,
  module: NOT_PRESENT_TOKENS,
  description: NOT_PRESENT_TOKENS,
  cost: NOT_PRESENT_TOKENS,
  bot_id: NOT_PRESENT_TOKENS,
  user_id: NOT_PRESENT_TOKENS,
};

const NO_BILL =
  'drop:not a billing field (who the message went to, which template, how it was delivered); a campaign recipient row carries those, a non-broadcast send keeps none of them';
const IN_META = (what: string): string =>
  `col:usage_charges.meta text, legacy.waboo.${what} (exact text; NOT in credits / revenue_minor: see the README for why a historical charge is written as "free")`;
export const USAGE_FIELDS: FieldMap = {
  _id: 'id (registered in migration.id_map: target usage_charges.id)',
  id: 'col:usage_charges.meta text, legacy.waboo.id',
  message_id: 'col:wamid (the key; the join with the delivery log and the live webhooks)',
  created_time: 'col:created_at',
  template_category: 'col:category (marketing / utility / authentication / service)',
  source: 'col:source (automation / inbox / test)',
  amount: IN_META('amount'),
  reseller_amount: IN_META('reseller_amount'),
  reseller_margin: IN_META('reseller_margin'),
  cost: IN_META('cost'),
  cost_description: IN_META('cost_description'),
  revert: IN_META('revert'),
  reverted_at: IN_META('reverted_at'),
  refund_run_id: IN_META('refund_run_id'),
  phone_no: NO_BILL,
  mobile: NO_BILL,
  mobile_phone_number: NO_BILL,
  contact_id: NO_BILL,
  first_name: NO_BILL,
  last_name: NO_BILL,
  primary_email: NO_BILL,
  status: NO_BILL,
  'status.sent': NO_BILL,
  error: NO_BILL,
  broadcast_id: NO_BILL,
  retry_count: NO_BILL,
  retry_enabled: NO_BILL,
  max_retries: NO_BILL,
  interakt_reponse_time: NO_BILL,
  template_id: NO_BILL,
  meta_template_id: NO_BILL,
  origin: NO_BILL,
  run_id: NO_BILL,
  automation_id: NO_BILL,
  node_id: NO_BILL,
  events: NO_BILL,
  context: NO_BILL,
  list_id: NO_BILL,
  isSelected: NO_BILL,
  conversation_id: NO_BILL,
  expiry_reason: NO_BILL,
  expiry_run_id: NO_BILL,
};

const NOT_PLANNED: Outcome = {
  kind: 'quarantine',
  code: 'NOT_PLANNED',
  reason: 'the credits plan has no verdict for this document',
};

const readOf =
  (collection: string) =>
  ({ source, client }: { source: import('../extract/source').Source; client: string }) =>
    source.collections(client).includes(collection) ? source.read(client, collection) : [];

// ---------------------------------------------------------------------------------------------------------------- credit_wallet

export const WALLET_CONSTANTS: Record<string, unknown> = {
  subject_type: null,
  subject_id: null,
  note: null,
  operator_id: null,
  request_id: null,
  row_version: 1,
};

const money = (v: unknown): string | null => plainDecimal(v);

export const creditWallet: HandlerSpec = {
  handler: 'credit_wallet',
  collection: 'credit_logs',
  mapCollection: 'credit_logs',
  fields: CREDIT_WALLET_FIELDS,
  tables: {
    wallet_transactions: {
      columns: [
        c('user_id', 'bigint'),
        c('kind', 'text'),
        c('type', 'text'),
        c('amount', 'numeric'),
        c('balance_after', 'numeric'),
        c('source', 'text'),
        c('description', 'text'),
        c('meta', 'jsonb'),
        c('idempotency_key', 'text'),
        c('direction', 'text'),
        c('actor_type', 'text'),
        c('actor_label', 'text'),
        c('unit', 'text'),
        c('created_at', 'timestamptz'),
        c('updated_at', 'timestamptz'),
      ],
      constants: WALLET_CONSTANTS,
    },
  },
  transform(doc: Doc, ctx: Ctx): Outcome {
    const plan = ctx.credits;
    if (!plan) return NOT_PLANNED;
    const s = plan.settings;
    const v = walletVerdict(doc, s, windowOf(plan.referenceAt));
    if (v.kind === 'exclude') return { kind: 'exclude', code: v.code, reason: v.reason };
    if (v.kind === 'quarantine') return { kind: 'quarantine', code: v.code, reason: v.reason };
    const base = primaryKey(doc);
    const entry = plan.wallet.get(base);
    if (!entry || !s.opening) return NOT_PLANNED;
    const soft: Soft[] = [];
    if (v.residual !== 0n)
      soft.push({
        code: 'ROUNDED',
        reason:
          'credits_deducted has more than two fraction digits: the ledger holds hundredths (the residual of every such row is summed in the report)',
        detail: {
          exact: v.plain,
          posted: minorText(v.minor),
          residual: scaledText(v.residual),
        },
      });
    const type = str(doc.type);
    if (type !== null && type.toLowerCase() !== 'openai_api')
      soft.push({
        code: 'UNKNOWN_CREDIT_TYPE',
        reason:
          'type is not openai_api, the only value seen in the pilot data; the direction is NOT inferred from it (every row is a spend)',
        detail: { type: type.slice(0, 40) },
      });
    let userId: number | null = null;
    const rawUser = str(doc.user_id);
    if (rawUser !== null) {
      const ref = ctx.ref('user', rawUser);
      if (ref) userId = ref.id;
      else
        soft.push({
          code: 'USER_UNRESOLVED',
          reason: 'user_id matches no migrated user: stored without a user',
          detail: rawUser.slice(0, 60),
        });
    }
    const at = v.at.toISOString();
    const key = base;
    return {
      kind: 'rows',
      soft,
      rows: [
        {
          table: 'wallet_transactions',
          sub: '',
          row: {
            user_id: userId,
            kind: 'credit',
            type: 'spend',
            amount: minorText4(-v.minor),
            balance_after: minorText4(entry.balanceAfter),
            source: SOURCE_AI,
            description: clip(doc.description, 500),
            meta: {
              legacy: {
                waboo: {
                  id: key,
                  credits_deducted: v.plain,
                  new_balance: money(doc.new_balance),
                  cost: money(doc.cost),
                  action: clip(doc.action, 120),
                  module: clip(doc.module, 120),
                  type: clip(doc.type, 60),
                  model: clip(doc.model, 120),
                  bot_id: clip(doc.bot_id, 80),
                  tokens: {
                    used: tokenText(doc.tokens_used),
                    input: tokenText(doc.input_tokens),
                    output: tokenText(doc.output_tokens),
                    cached: tokenText(doc.cached_input_tokens),
                  },
                },
              },
            },
            idempotency_key: `waboo:${ctx.client}:credit_log:${key}`,
            direction: 'out',
            actor_type: 'system',
            actor_label: ACTOR,
            unit: s.opening.currency,
            created_at: at,
            updated_at: at,
          },
        },
      ],
    };
  },
};

/** A token counter as it stands in the source, as text (null when absent); never copied into a number column. */
function tokenText(v: unknown): string | null {
  const p = plainDecimal(v);
  return p === null ? null : p;
}

// ---------------------------------------------------------------------------------------------------------------- credit_tokens

export const creditTokens: HandlerSpec = {
  handler: 'credit_tokens',
  collection: 'credit_logs',
  mapCollection: 'credit_logs_tokens',
  virtual: true,
  read: readOf('credit_logs'),
  fields: CREDIT_TOKEN_FIELDS,
  tables: {
    ai_token_usage: {
      columns: [
        c('provider', 'text'),
        c('model', 'text'),
        c('prompt_tokens', 'integer'),
        c('completion_tokens', 'integer'),
        c('total_tokens', 'integer'),
        c('billed_against', 'text'),
        c('created_at', 'timestamptz'),
      ],
      noUuid: true,
    },
  },
  transform(doc: Doc, ctx: Ctx): Outcome {
    const plan = ctx.credits;
    if (!plan) return NOT_PLANNED;
    const v = tokensVerdict(doc, plan.settings, windowOf(plan.referenceAt));
    if (v.kind === 'quarantine') return { kind: 'quarantine', code: v.code, reason: v.reason };
    if (v.kind === 'exclude') return { kind: 'exclude', code: v.code, reason: v.reason };
    const p = providerOf(doc.type, doc.model);
    return {
      kind: 'rows',
      soft: [...v.soft, ...p.soft],
      rows: [
        {
          table: 'ai_token_usage',
          sub: '',
          row: {
            provider: p.provider,
            model: clip(doc.model, 200),
            prompt_tokens: v.prompt,
            completion_tokens: v.completion,
            total_tokens: v.total,
            billed_against: 'admin',
            created_at: v.at.toISOString(),
          },
        },
      ],
    };
  },
};

// ---------------------------------------------------------------------------------------------------------------- usage_charges

/**
 * A historical charge is written as `free` with credits and revenue 0, and the amounts Waboo billed stay in `meta` as exact text. The
 * application treats `charged` rows as money it took: the reseller P&L sums their revenue, the wallet screen sums "spent this month",
 * and a late failed-delivery callback REFUNDS a charged row into the wallet (settleFailed). None of that is true for a message Waboo
 * billed before the cut-over, and the unit and scale of Waboo's `amount` are unconfirmed. A `free` row with a claimed key is inert in
 * all three, and a late delivered / failed callback for the same wamid finds the claimed key and does nothing.
 */
export const USAGE_CONSTANTS: Record<string, unknown> = {
  user_id: null,
  to_country: null,
  cost_minor: null,
  wallet_tx_id: null,
  price_credits: 0,
  shortfall_credits: 0,
  free_reason: null,
  cost_micros: null,
  refunded_at: null,
  refund_tx_id: null,
  currency: null,
};

export const usageCharges: HandlerSpec = {
  handler: 'usage_charges',
  collection: 'whatsapp_broadcasting_data',
  mapCollection: 'whatsapp_broadcasting_data_usage',
  virtual: true,
  read: readOf('whatsapp_broadcasting_data'),
  only: isNonBroadcast,
  fields: USAGE_FIELDS,
  tables: {
    usage_charges: {
      columns: [
        c('provider', 'text'),
        c('wamid', 'text'),
        c('category', 'text'),
        c('source', 'text'),
        c('credits', 'integer'),
        c('revenue_minor', 'bigint'),
        c('status', 'text'),
        c('billing_mode', 'text'),
        c('meta', 'text'),
        c('created_at', 'timestamptz'),
      ],
      constants: USAGE_CONSTANTS,
      noUuid: true,
    },
  },
  transform(doc: Doc, ctx: Ctx): Outcome {
    const plan = ctx.credits;
    if (!plan) return NOT_PLANNED;
    const v = usageVerdict(doc, windowOf(plan.referenceAt));
    if (v.kind === 'quarantine') return { kind: 'quarantine', code: v.code, reason: v.reason };
    if (v.kind === 'exclude') return { kind: 'exclude', code: v.code, reason: v.reason };
    if (!plan.usageFirst.has(primaryKey(doc)))
      return {
        kind: 'exclude',
        code: 'DUPLICATE_WAMID',
        reason:
          'an earlier row of the billing log holds the same message_id: a message is charged once (usage_charge_keys is unique per wamid)',
      };
    const soft: Soft[] = [];
    const amounts: Record<string, string | null> = {};
    for (const f of ['amount', 'reseller_amount', 'reseller_margin', 'cost'] as const) {
      const raw = doc[f];
      const t = money(raw);
      amounts[f] = t;
      if (t === null && raw !== null && raw !== undefined && raw !== '')
        soft.push({
          code: 'BAD_AMOUNT',
          reason: `${f} is not a finite number: left out of the preserved billing detail`,
          detail: { field: f },
        });
    }
    const cat = (str(doc.template_category) ?? '').toLowerCase();
    const category = USAGE_CATEGORIES.has(cat) ? cat : null;
    if (cat !== '' && category === null)
      soft.push({
        code: 'UNKNOWN_CATEGORY',
        reason:
          'template_category is not marketing / utility / authentication / service: no category',
        detail: cat.slice(0, 40),
      });
    const reverted = toDate(doc.reverted_at);
    const src = (str(doc.source) ?? '').toLowerCase().slice(0, 40);
    return {
      kind: 'rows',
      soft,
      rows: [
        {
          table: 'usage_charges',
          sub: '',
          row: {
            provider: 'waba',
            wamid: v.wamid,
            category,
            source: src === '' ? null : src,
            credits: 0,
            revenue_minor: 0,
            status: 'free',
            billing_mode: 'plan',
            meta: JSON.stringify({
              legacy: {
                waboo: {
                  id: clip(doc.id, 80),
                  ...amounts,
                  cost_description: clip(doc.cost_description, 120),
                  revert: doc.revert === undefined || doc.revert === null ? null : bool(doc.revert),
                  reverted_at: reverted ? reverted.toISOString() : null,
                  refund_run_id: clip(doc.refund_run_id, 80),
                },
              },
            }),
            created_at: v.at.toISOString(),
          },
        },
      ],
    };
  },
};
