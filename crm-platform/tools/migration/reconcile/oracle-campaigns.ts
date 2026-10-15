/**
 * INDEPENDENT oracle for the broadcast step (broadcasting -> wpcampaigns, whatsapp_broadcasting_data -> wp_campaign_contacts), written
 * for the verifier. It imports nothing from transform/, broadcast/ or load/ (no rules, no plan, no phone code of the loader): the rules
 * of spec A section 3 and 4 are written down a second time here, as plain tables and loops, so a bug or a "fix" in the loader's version
 * makes the target disagree with this one and reconcile fails. Shared on purpose: the pure hash `uuidv5` of util.ts and this folder's
 * text / date / phone helpers (reconcile/oracle.ts, itself independent of the loader).
 *
 * Memory: only the recipients that load (and the quarantined ones) are kept; the delivery / billing rows of other sources (the bulk
 * of the collection) are counted by reason and dropped.
 */
import { uuidv5 } from '../util';
import { hexKey, oracleDeleted, oraclePhone, oidDate, text, truthy } from './oracle';

type Doc = Record<string, unknown>;
const isObj = (v: unknown): v is Doc =>
  v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);
const filled = (v: unknown): boolean => v !== null && v !== undefined && text(v) !== '';

export interface BOptions {
  client: string;
  keepTest: boolean;
  nonTerminal: 'cancelled' | 'failed';
  failedAttempts: number;
  defaultCc: string | null;
  fallbackAt: string;
  /** keys (ObjectId hex and string id) of the contacts soft-deleted at the source */
  deletedContacts: Set<string>;
  /** source key of a migrated contact / user -> its id (from migration.id_map) */
  contactId(key: string): number | undefined;
  userId(key: string): number | undefined;
  hasUsers: boolean;
  /** digits of normalized_phone -> contacts holding it */
  contactsByDigits: Map<string, { n: number; id: number }>;
  /** the migrated templates: wa_templates row, its Meta id and the Waboo keys (id_map) that point at it */
  templates: ReadonlyArray<{
    id: number;
    name: string;
    language: string;
    meta: string | null;
    keys: string[];
  }>;
}

export interface OAgg {
  rows: number;
  sent: number;
  delivered: number;
  read: number;
  responded: number;
  failed: number;
}

export interface OCampaign {
  key: string;
  verdict: 'load' | 'exclude' | 'quarantine' | 'engine';
  code?: string;
  uuid: string;
  /** expected column values (timestamps as ISO strings); only for a campaign that loads */
  row?: Record<string, unknown>;
  /** quarantine codes the loader must have written for this campaign (`key#CODE`) */
  softs: string[];
  userKey: string | null;
  agg: OAgg;
}

export interface ORecipient {
  key: string;
  verdict: 'load' | 'quarantine' | 'engine';
  code?: string;
  uuid: string;
  campaign?: string;
  row?: Record<string, unknown>;
  contactKey: string | null;
  contactVia: 'id' | 'phone' | 'none' | 'deleted';
}

export interface BResult {
  campaigns: Map<string, OCampaign>;
  /** loaded and quarantined recipients only */
  recipients: Map<string, ORecipient>;
  /** how many documents of each collection ended in each state: `campaign load`, `recipient exclude NON_BROADCAST_SOURCE` ... */
  tally: Record<string, number>;
  /** Waboo fields with no column, counted over the rows that DO load (and the billing rows of the excluded sources) */
  noHome: Array<{ what: string; n: number; of: number }>;
}

const LONE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
function unstorable(v: unknown): boolean {
  if (typeof v === 'string') return v.includes(String.fromCharCode(0)) || LONE.test(v);
  if (Array.isArray(v)) return v.some(unstorable);
  if (isObj(v)) return Object.entries(v).some(([k, x]) => unstorable(k) || unstorable(x));
  return false;
}

/** A date as an instant. A string with no zone is read as UTC (the machine's zone must not matter). */
function instant(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === 'number') return Number.isFinite(v) ? new Date(v < 1e11 ? v * 1000 : v) : null;
  if (typeof v === 'string' && text(v) !== '') {
    let t = text(v);
    if (/^\d{9,13}$/.test(t)) return instant(Number(t));
    if (/^\d{4}-\d\d-\d\d[T ]\d\d:\d\d(:\d\d(\.\d+)?)?$/.test(t)) t = `${t.replace(' ', 'T')}Z`;
    const d = new Date(t);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}
const isoOf = (d: Date | null): string | null => (d ? d.toISOString() : null);
const wholeNumber = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.trunc(v) : null;
  if (typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v)) return Math.trunc(Number(v));
  return null;
};
const key = (d: Doc): string => hexKey(d._id) || text(d.id);
/** The date in the first of `keys` that holds anything (an unreadable first value is not replaced by the second key). */
const firstDate = (d: Doc, keys: string[]): Date | null => {
  for (const k of keys) if (filled(d[k])) return instant(d[k]);
  return null;
};

const FINISHED: Record<string, string> = {
  completed: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  stopped: 'cancelled',
};
const UNFINISHED = [
  'scheduled',
  'running',
  'draft',
  'queued',
  'processing',
  'pending',
  'paused',
  'in_progress',
  'in progress',
  'sending',
  'active',
  'started',
];

function campaignDecision(
  d: Doc,
  o: BOptions,
): { verdict: 'load' | 'exclude' | 'quarantine'; code?: string } {
  if (oracleDeleted(d)) return { verdict: 'exclude', code: 'SOFT_DELETED' };
  if (truthy(d.test) && !o.keepTest) return { verdict: 'exclude', code: 'TEST_BROADCAST' };
  if (text(d.broadcast_name) === '') return { verdict: 'quarantine', code: 'EMPTY_NAME' };
  if (text(d.type) !== '' && text(d.type).toLowerCase() !== 'whatsapp')
    return { verdict: 'quarantine', code: 'UNSUPPORTED_TYPE' };
  return { verdict: 'load' };
}

/** The step dates of a recipient, then the status by rank. */
function recipientStatus(d: Doc): null | {
  status: 'sent' | 'delivered' | 'read' | 'responded' | 'failed';
  at: Record<'sent' | 'delivered' | 'read' | 'responded', string | null>;
  latest: string;
  conflict: boolean;
} {
  const T = isObj(d.status) ? d.status : {};
  const when = (v: unknown): Date | null => (filled(v) ? instant(v) : null);
  const sent = when(T.sent) ?? when(d['status.sent']);
  const delivered = when(T.delivered);
  const seen = when(T.seen);
  const replied = when(T.replied);
  const failed = when(T.failed);
  const all = [sent, delivered, seen, replied, failed].filter((x): x is Date => x !== null);
  if (all.length === 0) return null;
  const latest = new Date(Math.max(...all.map((x) => x.getTime()))).toISOString();
  const later = [delivered, seen, replied].filter((x): x is Date => x !== null);
  const bestMs = later.length > 0 ? Math.max(...later.map((x) => x.getTime())) : -Infinity;
  const conflict = failed !== null && later.length > 0;
  if (failed && !(bestMs >= failed.getTime()))
    return {
      status: 'failed',
      at: { sent: null, delivered: null, read: null, responded: null },
      latest,
      conflict,
    };
  const rank: Array<['responded' | 'read' | 'delivered' | 'sent', Date | null]> = [
    ['responded', replied],
    ['read', seen],
    ['delivered', delivered],
    ['sent', sent],
  ];
  const status = rank.find(([, x]) => x !== null)![0];
  return {
    status,
    at: {
      sent: isoOf(sent),
      delivered: isoOf(delivered),
      read: isoOf(seen),
      responded: isoOf(replied),
    },
    latest,
    conflict,
  };
}

const digitsOf = (s: string): string => s.replace(/[^0-9]/g, '');

/**
 * The template a campaign sent, written a second time (the loader's is broadcast/template-link.ts): the id the campaign carries must be
 * a migrated template's key (and the name, when both give one, equal); the Meta id (the campaign's own, else the one value all its loaded
 * recipients agree on) must find the same row; only when neither finds anything and no Meta id is known may the name (+ language)
 * find ONE row. A disagreement or several rows = NULL.
 */
function oracleTemplate(
  d: Doc,
  seenMeta: Set<string> | undefined,
  tpls: BOptions['templates'],
): { id: number | null; via: 'reference' | 'meta' | 'name' | null } {
  const none = { id: null, via: null };
  const ref = text(d.broadcast_template_id);
  const nm = text(d.broadcast_template_name);
  const lang = text(d.language) || text(d.broadcast_template_language);
  const meta = text(d.meta_template_id) || (seenMeta && seenMeta.size === 1 ? [...seenMeta][0]! : '');
  const r = ref === '' ? undefined : tpls.find((t) => t.keys.includes(ref));
  const ms = meta === '' ? [] : tpls.filter((t) => t.meta === meta);
  if (r && nm !== '' && r.name !== nm) return none;
  if (r && ms.length === 1 && ms[0]!.id !== r.id) return none;
  if (r && ms.length > 1 && !ms.some((t) => t.id === r.id)) return none;
  if (r) return { id: r.id, via: 'reference' };
  if (ms.length === 1) return { id: ms[0]!.id, via: 'meta' };
  if (ms.length > 1 || meta !== '' || nm === '') return none;
  const byName = tpls.filter((t) => t.name === nm && (lang === '' || t.language === lang));
  return byName.length === 1 ? { id: byName[0]!.id, via: 'name' } : none;
}

export async function oracleBroadcast(
  campaignDocs: AsyncIterable<Doc>,
  recipientDocs: AsyncIterable<Doc>,
  o: BOptions,
): Promise<BResult> {
  const tally: Record<string, number> = {};
  const bump = (k: string): void => {
    tally[k] = (tally[k] ?? 0) + 1;
  };
  const campaigns = new Map<string, OCampaign>();
  const byAnyKey = new Map<string, OCampaign>();
  const docsOf = new Map<string, Doc>();
  const aliasPending: Array<{ keys: string[]; c: OCampaign }> = [];

  // ---- campaigns: verdicts (the first document of a key owns it; primary keys before aliases)
  for await (const d of campaignDocs) {
    const k = key(d);
    if (k === '' || campaigns.has(k)) continue; // NO_KEY / DUPLICATE_KEY belong to the generic accounting
    let dec: { verdict: 'load' | 'exclude' | 'quarantine' | 'engine'; code?: string };
    if (unstorable(d)) dec = { verdict: 'engine' };
    else dec = campaignDecision(d, o);
    const c: OCampaign = {
      key: k,
      verdict: dec.verdict,
      code: dec.code,
      uuid: uuidv5(`${o.client}|broadcasting|${k}`),
      softs: [],
      userKey: null,
      agg: { rows: 0, sent: 0, delivered: 0, read: 0, responded: 0, failed: 0 },
    };
    campaigns.set(k, c);
    docsOf.set(k, d);
    bump(`campaign ${dec.verdict}${dec.code ? ` ${dec.code}` : ''}`);
    aliasPending.push({
      keys: [text(d.id), text(d.broadcast_id)].filter((x) => x !== '' && x !== k),
      c,
    });
  }
  for (const [k, c] of campaigns) byAnyKey.set(k, c);
  for (const { keys, c } of aliasPending)
    for (const k of keys) if (!byAnyKey.has(k)) byAnyKey.set(k, c);

  // ---- recipients
  const recipients = new Map<string, ORecipient>();
  const seen = new Set<string>();
  const noHomeR: Record<string, number> = {};
  const nh = (w: string): void => {
    noHomeR[w] = (noHomeR[w] ?? 0) + 1;
  };
  let loadedRows = 0;
  let billingRowsExcluded = 0;
  const metaOf = new Map<string, Set<string>>(); // campaign key -> the Meta template ids its loaded recipients carry
  for await (const d of recipientDocs) {
    const k = key(d);
    if (k === '' || seen.has(k)) continue;
    seen.add(k);
    const uuid = uuidv5(`${o.client}|whatsapp_broadcasting_data|${k}`);
    if (unstorable(d)) {
      recipients.set(k, { key: k, verdict: 'engine', uuid, contactKey: null, contactVia: 'none' });
      bump('recipient engine');
      continue;
    }
    const bid = text(d.broadcast_id);
    if (text(d.source).toLowerCase() !== 'broadcast' || bid === '') {
      bump('recipient exclude NON_BROADCAST_SOURCE');
      if (d.amount !== undefined && d.amount !== null) billingRowsExcluded++;
      continue;
    }
    const camp = byAnyKey.get(bid);
    const quarantine = (code: string): void => {
      recipients.set(k, {
        key: k,
        verdict: 'quarantine',
        code,
        uuid,
        contactKey: null,
        contactVia: 'none',
      });
      bump(`recipient quarantine ${code}`);
    };
    if (!camp) {
      quarantine('CAMPAIGN_MISSING');
      continue;
    }
    if (camp.verdict === 'exclude') {
      bump('recipient exclude CAMPAIGN_EXCLUDED');
      continue;
    }
    if (camp.verdict !== 'load') {
      quarantine('CAMPAIGN_MISSING');
      continue;
    }
    const phoneText = [d.phone_no, d.mobile, d.mobile_phone_number].map(text).find((x) => x !== '');
    if (!phoneText) {
      quarantine('NO_PHONE');
      continue;
    }
    const st = recipientStatus(d);
    if (!st) {
      quarantine('NO_STATUS');
      continue;
    }
    bump('recipient load');
    loadedRows++;
    if (text(d.meta_template_id) !== '')
      metaOf.set(camp.key, (metaOf.get(camp.key) ?? new Set()).add(text(d.meta_template_id)));
    const failed = st.status === 'failed';
    const g = camp.agg;
    g.rows++;
    if (failed) g.failed++;
    else g.sent++;
    if (['delivered', 'read', 'responded'].includes(st.status)) g.delivered++;
    if (['read', 'responded'].includes(st.status)) g.read++;
    if (st.status === 'responded') g.responded++;

    const e164 = oraclePhone(phoneText, null, o.defaultCc);
    const rawDigits = digitsOf(phoneText);
    const phone =
      e164 ?? (rawDigits === '' ? null : `${phoneText.startsWith('+') ? '+' : ''}${rawDigits}`);
    // contact: the id in id_map, else (unless the contact was deleted at the source) the single contact holding the number
    const cid = text(d.contact_id);
    let contactKey: string | null = null;
    let via: ORecipient['contactVia'] = 'none';
    let contact: number | null = null;
    if (cid !== '' && o.contactId(cid) !== undefined) {
      contact = o.contactId(cid)!;
      contactKey = cid;
      via = 'id';
    } else if (cid !== '' && o.deletedContacts.has(cid)) via = 'deleted';
    else {
      const hit = o.contactsByDigits.get(digitsOf(e164 ?? rawDigits));
      if (hit && hit.n === 1) {
        contact = hit.id;
        via = 'phone';
      }
    }
    const created =
      firstDate(d, ['created_time', 'created_at']) ?? oidDate(d._id) ?? new Date(o.fallbackAt);
    const createdIso = created.toISOString();
    const err = failed ? text(d.error) : '';
    const names = [text(d.first_name), text(d.last_name)].filter((x) => x !== '');
    const retries = wholeNumber(d.retry_count);
    recipients.set(k, {
      key: k,
      verdict: 'load',
      uuid,
      campaign: camp.key,
      contactKey,
      contactVia: via,
      row: {
        status: st.status,
        send_attempts: failed ? o.failedAttempts : 1,
        phone_number: phone,
        recipient_name: names.length > 0 ? names.join(' ') : null,
        whatsapp_message_id: text(d.message_id) === '' ? null : text(d.message_id),
        sent_at: st.at.sent,
        delivered_at: st.at.delivered,
        read_at: st.at.read,
        responded_at: st.at.responded,
        error_message: err === '' ? null : err,
        error_code: err === '' ? null : (/^\W{0,3}(\d{3,6})(?!\d)/.exec(err)?.[1] ?? null),
        retry_count: retries === null ? 0 : Math.min(32767, Math.max(0, retries)),
        created_at: createdIso,
        updated_at: st.latest > createdIso ? st.latest : createdIso,
        contact_id: contact,
      },
    });
    for (const f of ['amount', 'cost', 'reseller_amount', 'reseller_margin'])
      if (filled(d[f])) nh(`wp_campaign_contacts: ${f} (money, credits step)`);
    for (const f of ['template_id', 'meta_template_id', 'template_category'])
      if (filled(d[f])) nh(`wp_campaign_contacts: ${f} (template link / category)`);
    for (const f of ['revert', 'reverted_at', 'refund_run_id'])
      if (filled(d[f]) && d[f] !== false)
        nh(`wp_campaign_contacts: ${f} (refund bookkeeping, credits step)`);
    if (filled(d.primary_email)) nh('wp_campaign_contacts: primary_email (the contact carries it)');
    if (filled(d.conversation_id)) nh('wp_campaign_contacts: conversation_id (inbox thread)');
    if (d.retry_enabled === true)
      nh('wp_campaign_contacts: retry_enabled (a recipient has no retry switch)');
    if (filled(d.max_retries)) nh('wp_campaign_contacts: max_retries');
  }

  // ---- expected campaign rows (the counters need the recipients, so they are made last)
  const noHomeC: Record<string, number> = {};
  const nc = (w: string): void => {
    noHomeC[w] = (noHomeC[w] ?? 0) + 1;
  };
  let loadedCampaigns = 0;
  for (const [k, c] of campaigns) {
    if (c.verdict !== 'load') continue;
    loadedCampaigns++;
    const d = docsOf.get(k)!;
    const w = text(d.status).toLowerCase();
    const finished = FINISHED[w];
    const status = finished ?? o.nonTerminal;
    if (!finished)
      c.softs.push(UNFINISHED.includes(w) ? 'NONTERMINAL_AT_MIGRATION' : 'UNKNOWN_STATUS');
    // schedule
    const schedAt = instant(d.scheduled_date_dt) ?? instant(d.scheduled_date);
    const hadSched = filled(d.scheduled_date_dt) || filled(d.scheduled_date);
    if (hadSched && !schedAt) c.softs.push('BAD_DATE');
    const scheduled = !truthy(d.scheduled_now) && schedAt !== null;
    const sentOn = filled(d.sent_on) ? instant(d.sent_on) : null;
    const created = firstDate(d, ['created_time', 'created_at']);
    const createdD = created ?? oidDate(d._id) ?? new Date(o.fallbackAt);
    if (!created && !oidDate(d._id)) c.softs.push('NO_DATE');
    const modified = firstDate(d, ['modified_time', 'updated_at']);
    const updatedD = modified ?? createdD;
    const waboo = Math.max(0, wholeNumber(d.recipients) ?? 0);
    const g = c.agg;
    if (waboo !== g.rows) c.softs.push('RECIPIENT_COUNT_MISMATCH');
    const pairs: Array<[string, number]> = [
      ['sent', g.sent],
      ['delivered', g.delivered],
      ['seen', g.read],
      ['replied', g.responded],
      ['failed', g.failed],
    ];
    if (pairs.some(([f, mine]) => wholeNumber(d[f]) !== null && wholeNumber(d[f]) !== mine))
      c.softs.push('COUNTER_MISMATCH');
    if ((wholeNumber(d.processing) ?? 0) > 0 || (wholeNumber(d.queued) ?? 0) > 0)
      c.softs.push('PENDING_AT_MIGRATION');
    const tpl = oracleTemplate(d, metaOf.get(k), o.templates);
    if (tpl.id === null) c.softs.push('TEMPLATE_UNLINKED');
    else if (tpl.via !== 'reference') c.softs.push('TEMPLATE_LINKED_VIA');
    if (text(d.sender_number) !== '') c.softs.push('SENDER_NUMBER');
    if (
      ['billable_amount', 'refunded_amount', 'reseller_amount'].some(
        (f) => typeof d[f] === 'number',
      )
    )
      c.softs.push('COST_FIELDS');
    const cb = isObj(d.created_by) ? text(d.created_by.id) : text(d.created_by);
    c.userKey = o.hasUsers && cb !== '' ? cb : null;
    if (c.userKey !== null && o.userId(c.userKey) === undefined) c.softs.push('UNRESOLVED_USER');
    c.row = {
      campaign_name: text(d.broadcast_name),
      campaign_type: 'template',
      status,
      provider: 'waba',
      template_id: tpl.id,
      created_by: c.userKey !== null ? (o.userId(c.userKey) ?? null) : null,
      schedule_type: scheduled ? 'scheduled' : 'now',
      send_date: scheduled ? schedAt!.toISOString().slice(0, 10) : null,
      send_time: scheduled ? schedAt!.toISOString().slice(11, 19) : null,
      timezone: scheduled ? 'UTC' : null,
      last_run_at: isoOf(sentOn),
      run_at: isoOf(sentOn ?? schedAt),
      completed_at: finished
        ? status === 'completed' && sentOn
          ? sentOn.toISOString()
          : updatedD.toISOString()
        : null,
      total_recipients: Math.max(waboo, g.rows),
      sent_count: g.sent,
      failed_count: g.failed,
      delivered_count: g.delivered,
      read_count: g.read,
      responded_count: g.responded,
      retry_enabled: false,
      created_at: createdD.toISOString(),
      updated_at: updatedD.toISOString(),
    };
    for (const f of [
      'broadcast_template_name',
      'broadcast_template_type',
      'broadcast_template_category',
    ])
      if (filled(d[f]))
        nc(`wpcampaigns: ${f} (no column; only the template link is stored, the name is a cross-check)`);
    for (const f of [
      'sender_number',
      'filter_query',
      'mongodb_query',
      'search',
      'marketing_list_id',
      'components',
      'billable_amount',
      'refunded_amount',
      'reseller_amount',
      'updated_by',
    ])
      if (filled(d[f])) nc(`wpcampaigns: ${f}`);
    if (d.retry_enabled === true)
      nc('wpcampaigns: retry_enabled = true (written FALSE: a true value would arm the retry job)');
    if (filled(d.max_retries)) nc('wpcampaigns: max_retries / retry_count / last_retry');
  }

  const noHome: BResult['noHome'] = [
    ...Object.entries(noHomeC).map(([what, n]) => ({ what, n, of: loadedCampaigns })),
    ...Object.entries(noHomeR).map(([what, n]) => ({ what, n, of: loadedRows })),
  ];
  if (billingRowsExcluded > 0)
    noHome.push({
      what: 'whatsapp_broadcasting_data rows of other sources with an amount (excluded NON_BROADCAST_SOURCE: billing log for the credits step)',
      n: billingRowsExcluded,
      of: tally['recipient exclude NON_BROADCAST_SOURCE'] ?? 0,
    });
  return { campaigns, recipients, tally, noHome };
}
