import { sql } from 'drizzle-orm';
import {
  canonicalizePhone,
  composeDisplayName,
} from '../../../packages/contracts/src/contacts-attributes-tags/phone';
import {
  iso,
  isDeleted,
  plain,
  primaryKey,
  scrub,
  isSecretEntry,
  setOwn,
  slug,
  str,
  toDate,
  type Doc,
  cutText,
} from '../util';
import { c, times, TS_COLS } from './common';
import type { SourceIndex } from './source-index';
import type { Ctx, FieldMap, HandlerSpec, Outcome, Soft } from './types';

/** `__first_name__error_reason`, `__mobile_phone_number__unverified_value`: import-validation rejects that keep the raw bad value. */
/**
 * The contact's phone: the first candidate (mobile, then WhatsApp) that reads as an E.164 number. A candidate that does not read is
 * skipped, so a valid WhatsApp number is kept when the mobile field holds something unreadable. `rejected` is the first raw value that
 * failed to read, or null when nothing failed (a missing or empty value is not a failure).
 */
export function chooseContactPhone(
  candidates: Array<string | null | undefined>,
  parse: (raw: string) => string | null,
): { phone: string | null; rejected: string | null } {
  let rejected: string | null = null;
  for (const raw of candidates) {
    if (typeof raw !== 'string' || raw === '') continue;
    const phone = parse(raw);
    if (phone) return { phone, rejected: null };
    rejected ??= raw;
  }
  return { phone: null, rejected };
}

/** Creation order: the Waboo _id (24 hex characters, so string order is creation order). Display ids are numbered in this order. */
export function sortForDisplayId<T extends { legacy_id?: unknown }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const x = String(a.legacy_id ?? '');
    const y = String(b.legacy_id ?? '');
    return x < y ? -1 : x > y ? 1 : 0;
  });
}

// also the literal key `undefined` (a front-end bug of the old product writes it on some contacts: it is not a property anyone defined)
export const REJECT_MARKER = /^(__.+__(error_reason|unverified_value)|undefined)$/;

/** Source keys that have a column (or a derived table) of their own. Every other key becomes a custom property in contacts.data. */
export const CONTACT_FIELDS: FieldMap = {
  _id: 'col:legacy_id',
  id: 'id (registered in migration.id_map so references by either id resolve)',
  first_name: 'col:first_name',
  last_name: 'col:last_name',
  email: 'col:email',
  mobile_phone_number: 'col:phone (E.164)',
  country_code: 'col:country_code (and the phone parse)',
  lifecycle_stage: 'col:lifecycle_stage (resolved to the status_options value)',
  lifecycle_stage_date: 'col:lifecycle_stage_date',
  previous_lifecycle_stage: 'col:previous_lifecycle_stage',
  previous_lifecycle_stage_date: 'col:previous_lifecycle_stage_date',
  lifecycle_stage_status: 'col:status',
  lost_reason: 'col:lost_reason',
  whatsapp_subscription_status: 'col:whatsapp_subscription_status',
  sms_subscription_status: 'col:sms_subscription_status',
  email_subscription_status: 'col:email_subscription_status',
  source: 'col:source',
  created_time: 'col:created_at',
  modified_time: 'col:updated_at',
  marketing_list: 'derived:contact_group_members',
  is_deleted: 'drop:soft-delete flag; deleted contacts are excluded and counted',
  deleted_time: 'drop:soft-delete timestamp; a contact with it set is excluded and counted',
};

const NATIVE = new Set(Object.keys(CONTACT_FIELDS));

/**
 * Waboo properties the app has under another name as a BUILT-IN property (Title, Language, Address): the value is stored in contacts.data
 * under the built-in key, which the built-in property reads, and no property is created for the Waboo name. `contact_owner` is the
 * built-in Owner (the owner_id column).
 */
export const BUILT_IN_ALIAS: Readonly<Record<string, string>> = {
  salutation: 'title',
  preferred_language: 'language',
  street_address: 'address',
};

/** Test seam: the verifier's independent oracle must catch a bug injected here. */
export const transformHooks = {
  phoneOf: (raw: string, cc: string | null, def: string | null) => phoneOf(raw, cc, def),
};

/**
 * A subscription value (option id or label) as the app's lowercase status word. "subscribed" only when the source says yes (an
 * affirmative label); a "no" is "unsubscribed"; nothing recorded stays null, which the app shows as "No". `field` is the property the value
 * belongs to, so an option id is read in its own property first.
 */
export function subscriptionStatus(raw: unknown, idx: SourceIndex, field?: string): string | null {
  const v = str(raw);
  if (!v) return null;
  const label = (idx.optionLabelByField?.get(field ?? '')?.get(v) ?? idx.optionLabel.get(v) ?? v)
    .trim()
    .toLowerCase();
  if (['yes', 'subscribed', 'opt-in', 'opted in', 'opt in'].includes(label)) return 'subscribed';
  if (['no', 'unsubscribed', 'opt-out', 'opted out', 'opt out'].includes(label))
    return 'unsubscribed';
  return slug(label) || null;
}

/**
 * A dropdown / radio / multiselect / checkbox property holds the option ID in the Waboo contact; the app holds the option VALUE (the label
 * when the option has none), a checkbox a boolean. An id that is not one of the property's options (already a value or a label, free text)
 * is kept as it is.
 */
export function optionValueOf(field: string, raw: unknown, idx: SourceIndex): unknown {
  // Created By / Updated By hold a Waboo user id: Desk shows the person's name; Original Lifecycle Stage holds a stage id: Desk shows its label
  if ((field === 'created_by' || field === 'updated_by') && typeof raw === 'string') return idx.userNames?.get(raw) ?? raw;
  if (field === 'original_lifecycle_stage' && typeof raw === 'string') return idx.stageByKey.get(raw)?.label ?? raw;
  const opts = idx.optionsByField?.get(field);
  if (!opts || raw === null || raw === undefined) return raw;
  const one = (v: unknown): unknown => {
    const o = typeof v === 'string' ? opts.get(v) : undefined;
    return o ? o.value : v;
  };
  if (Array.isArray(raw)) return raw.map(one);
  const type = str(idx.fieldsByName.get(field)?.type)?.toLowerCase();
  const o = typeof raw === 'string' ? opts.get(raw) : undefined;
  if (type === 'checkbox' && o) {
    const t = `${o.value} ${o.label}`.toLowerCase();
    if (/\b(yes|true|1|checked)\b/.test(t)) return true;
    if (/\b(no|false|0|unchecked)\b/.test(t)) return false;
  }
  return one(raw);
}

/** The status_options value for a stage/status given as a legacy id, a label or an already-converted value. */
function lifecycleValue(
  raw: unknown,
  kind: 'stage' | 'status',
  idx: SourceIndex,
): string | null | undefined {
  const v = str(raw);
  if (!v) return null;
  const hit =
    idx.stageByKey.get(v) ??
    idx.stageByLabel.get(`${kind}:${(idx.optionLabel.get(v) ?? v).toLowerCase()}`);
  return hit && hit.kind === kind ? hit.value : undefined;
}

/** National (significant) number lengths by calling code, for the codes seen in real data and the common ones. Unknown codes: 8..15 in total. */
const NATIONAL: Record<string, number[]> = {
  '1': [10],
  '7': [10],
  '20': [10],
  '27': [9],
  '30': [10],
  '31': [9],
  '33': [9],
  '34': [9],
  '39': [9, 10],
  '44': [9, 10],
  '49': [10, 11],
  '52': [10],
  '55': [10, 11],
  '60': [9, 10],
  '61': [9],
  '62': [9, 10, 11],
  '63': [10],
  '64': [8, 9, 10],
  '65': [8],
  '66': [9],
  '81': [10],
  '82': [9, 10],
  '84': [9, 10],
  '86': [11],
  '90': [10],
  '91': [10],
  '92': [10],
  '94': [9],
  '880': [10],
  '966': [9],
  '971': [9],
  '977': [10],
};
const ccOf = (digits: string): string | null =>
  [3, 2, 1].map((n) => digits.slice(0, n)).find((p) => NATIONAL[p]) ?? null;

/** Full international digits -> E.164, only when the national part has a length that country uses. */
function e164(full: string): string | null {
  if (!/^[1-9]\d{7,14}$/.test(full)) return null;
  const cc = ccOf(full);
  if (cc && !NATIONAL[cc]!.includes(full.length - cc.length)) return null;
  return canonicalizePhone({ number: `+${full}` })?.e164 ?? null;
}

/**
 * Local number plus its own country code -> E.164, the way the importer reads a "9812345678" + "91" row.
 * Anything that is not plainly a number (letters, "ext 12", "x4", "#") is NOT guessed at, and neither is a number whose digit count
 * the country does not use ("9812345680 12" is 12 digits, not an Indian mobile): null, and the caller quarantines the raw text.
 */
export function phoneOf(
  raw: string,
  countryCode: string | null,
  defaultCc: string | null,
): string | null {
  const text = raw.trim();
  if (!/^[+\d\s().\-/]+$/.test(text)) return null;
  const all = text.replace(/\D/g, '');
  if (/^\+/.test(text)) return e164(all);
  if (/^00/.test(text)) return e164(all.replace(/^0+/, ''));
  const digits = all.replace(/^0+/, '');
  const cc = (countryCode ?? defaultCc ?? '').replace(/\D/g, '').replace(/^0+/, '');
  if (!digits) return null;
  if (!cc) return digits.length > 10 ? e164(digits) : null;
  const lens = NATIONAL[cc];
  if (lens) {
    if (lens.includes(digits.length)) return e164(cc + digits);
    if (digits.startsWith(cc) && lens.includes(digits.length - cc.length)) return e164(digits);
    // Waboo stores numbers as full international digits without a plus ("5521...", "4478..."): a number that does not fit the default
    // country but reads as another country's full number is that number
    if (!countryCode) return e164(digits);
    return null;
  }
  return e164(digits.startsWith(cc) && digits.length >= cc.length + 6 ? digits : cc + digits);
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const contacts: HandlerSpec = {
  handler: 'contacts',
  collection: 'contact_list',
  mapCollection: 'contact_list',
  dynamic: true,
  update: {},
  fields: CONTACT_FIELDS,
  tables: {
    contacts: {
      columns: [
        c('name', 'text'),
        c('email', 'citext'),
        c('phone', 'text'),
        c('lifecycle_stage', 'text'),
        c('data', 'jsonb'),
        c('display_id', 'text'),
        c('legacy_id', 'text'),
        c('first_name', 'text'),
        c('last_name', 'text'),
        c('lifecycle_stage_date', 'timestamptz'),
        c('previous_lifecycle_stage', 'text'),
        c('previous_lifecycle_stage_date', 'timestamptz'),
        c('lost_reason', 'text'),
        c('whatsapp_subscription_status', 'text'),
        c('sms_subscription_status', 'text'),
        c('email_subscription_status', 'text'),
        c('country_code', 'text'),
        c('is_unsubscribed', 'boolean'),
        c('owner_id', 'bigint'),
        c('source', 'text'),
        c('status', 'text'),
        c('email_confirmed', 'boolean'),
        c('fax_number', 'text'),
        ...TS_COLS,
      ],
      fp: [],
      skipCompare: ['display_id'],
      // columns the loader never writes must still hold their defaults: a changed one means someone edited the row
      constants: {
        is_archived: false,
        company_id: null,
        won_at: null,
        lost_at: null,
        lifecycle_state: 'active',
        lead_score: null,
        other_lost_reason: null,
        import_job_id: null,
        submitted_by_agent_id: null,
        created_by: null,
        updated_by: null,
        channel: null,
        channel_uid: null,
        unsubscribed_at: null,
        last_activity_at: null,
        title: null,
        middle_name: null,
        language: null,
        address: null,
        image_url: null,
        subject: null,
        message: null,
        row_version: 1,
      },
    },
  },
  transform(doc: Doc, ctx: Ctx): Outcome {
    if (isDeleted(doc))
      return { kind: 'exclude', code: 'SOFT_DELETED', reason: 'is_deleted or deleted_time is set' };
    const soft: Soft[] = [];

    // import rejects: the contact still loads, the raw rejected values go to quarantine for a human
    const markers: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(doc))
      if (REJECT_MARKER.test(k)) setOwn(markers, k, plain(v));
    if (Object.keys(markers).length > 0) {
      soft.push({
        code: 'IMPORT_REJECT_MARKERS',
        reason:
          'import validation rejected one or more values; raw values kept here, not in the contact',
        detail: markers,
      });
    }

    const firstName = str(doc.first_name);
    const lastName = str(doc.last_name);
    const name = composeDisplayName({ firstName, lastName });

    let email = str(doc.email)?.toLowerCase() ?? null;
    if (email && !EMAIL.test(email)) {
      soft.push({
        code: 'INVALID_EMAIL',
        reason: 'not an email address; left empty',
        detail: email,
      });
      email = null;
    }

    const ccRaw = str(doc.country_code);
    const picked = chooseContactPhone([str(doc.mobile_phone_number), str(doc.whatsapp_phone_number)], (raw) =>
      transformHooks.phoneOf(raw, ccRaw, ctx.defaultCountryCode),
    );
    const phone = picked.phone;
    if (picked.rejected !== null)
      soft.push({
        code: 'INVALID_PHONE',
        reason:
          'cannot be read as an E.164 number (letters, an extension, or the wrong digit count); left empty',
        detail: picked.rejected,
      });

    if (!name && !email && !phone && Object.keys(markers).length === 0) {
      return {
        kind: 'quarantine',
        code: 'NO_IDENTITY',
        reason: 'no name, email or readable phone',
      };
    }

    const t = times(doc, ctx.fallbackAt);
    soft.push(...t.soft);

    // a missing or unresolvable stage is "no stage chosen": the workspace default, exactly what the app does for a new contact
    let lifecycle = ctx.idx.defaultStage;
    const lcRaw = str(doc.lifecycle_stage);
    if (lcRaw) {
      const v = lifecycleValue(lcRaw, 'stage', ctx.idx);
      if (v) lifecycle = v;
      else
        soft.push({
          code: 'UNRESOLVED_LIFECYCLE',
          reason:
            'lifecycle stage is neither a known stage id nor label; the workspace default stage was used',
          detail: lcRaw,
        });
    }
    // a stage date that is present but unreadable would otherwise vanish without a trace
    const stageDate = (
      k: 'lifecycle_stage_date' | 'previous_lifecycle_stage_date',
    ): string | null => {
      const d = toDate(doc[k]);
      if (!d && str(doc[k]))
        soft.push({
          code: 'BAD_DATE',
          reason: `${k} is not a readable date; left empty`,
          detail: plain(doc[k]),
        });
      return iso(d);
    };
    const stageAt = stageDate('lifecycle_stage_date');
    const previousAt = stageDate('previous_lifecycle_stage_date');
    let previous: string | null = null;
    const prevRaw = str(doc.previous_lifecycle_stage);
    if (prevRaw) {
      previous = lifecycleValue(prevRaw, 'stage', ctx.idx) ?? null;
      if (!previous)
        soft.push({
          code: 'UNRESOLVED_LIFECYCLE',
          reason: 'previous lifecycle stage is unknown; left empty',
          detail: prevRaw,
        });
    }
    let status: string | null = null;
    const stRaw = str(doc.lifecycle_stage_status);
    if (stRaw) {
      status = lifecycleValue(stRaw, 'status', ctx.idx) ?? null;
      if (!status)
        soft.push({
          code: 'UNRESOLVED_LIFECYCLE',
          reason: 'lifecycle stage status is unknown; left empty',
          detail: stRaw,
        });
    }

    let source = str(doc.source);
    if (source && source.length > 128) {
      soft.push({
        code: 'TRUNCATED',
        reason: 'source longer than the 128-character column limit',
        detail: source,
      });
      source = cutText(source, 128);
    }

    const wa = subscriptionStatus(doc.whatsapp_subscription_status, ctx.idx, 'whatsapp_subscription_status');
    const data: Record<string, unknown> = {};
    const dropped: string[] = [];
    for (const [k, v] of Object.entries(doc)) {
      if (NATIVE.has(k) || REJECT_MARKER.test(k) || v === null || v === undefined) continue;
      if (isSecretEntry(k, v)) {
        dropped.push(k);
        continue;
      }
      const s = scrub(plain(v));
      dropped.push(...s.redacted.map((p) => `${k}.${p}`));
      const alias = BUILT_IN_ALIAS[k];
      // an explicit value under the built-in key itself wins over the Waboo alias
      if (alias && doc[alias] !== undefined && doc[alias] !== null && doc[alias] !== '') continue;
      setOwn(data, alias ?? k, optionValueOf(k, s.value, ctx.idx));
    }
    // Waboo lists Created Time and Modified Time as contact fields; WaDesk keeps them in created_at / updated_at. The same instants are also
    // kept in data (ISO text) so the two read-only field rows of the contact page have a value to show (README, "Contact properties").
    for (const k of ['created_time', 'modified_time'] as const) {
      const d = toDate(doc[k]);
      if (d) setOwn(data, k, d.toISOString());
    }
    if (dropped.length > 0) {
      soft.push({
        code: 'SECRET_KEYS_DROPPED',
        reason:
          'credential-looking keys were not copied (only their number is recorded, never names or values)',
        detail: { count: dropped.length },
      });
    }
    // the Waboo owner (a user's _id or user_id, a string or an int in the source) through id_map; no user collection = nothing to resolve
    let ownerId: number | null = null;
    const ownerRaw = str(doc.contact_owner);
    if (ctx.idx.hasUsers && ownerRaw) {
      const ref = ctx.ref('user', ownerRaw);
      if (ref && ref.table === 'users') {
        ownerId = ref.id;
        delete data.contact_owner; // the built-in Owner holds it now
      } else
        soft.push({
          code: 'OWNER_UNRESOLVED',
          reason:
            'contact_owner matches no migrated user; owner_id is left empty (the Waboo value stays in contacts.data)',
        });
    }
    const cc = ccRaw ? (/^\+?\d+$/.test(ccRaw) ? `+${ccRaw.replace(/\D/g, '')}` : ccRaw) : null;

    return {
      kind: 'rows',
      soft,
      rows: [
        {
          table: 'contacts',
          sub: '',
          row: {
            name,
            email,
            phone,
            lifecycle_stage: lifecycle,
            data,
            display_id: null,
            legacy_id: primaryKey(doc),
            first_name: firstName,
            last_name: lastName,
            lifecycle_stage_date: stageAt,
            previous_lifecycle_stage: previous,
            previous_lifecycle_stage_date: previousAt,
            lost_reason: str(doc.lost_reason),
            whatsapp_subscription_status: wa,
            sms_subscription_status: subscriptionStatus(doc.sms_subscription_status, ctx.idx, 'sms_subscription_status'),
            email_subscription_status: subscriptionStatus(doc.email_subscription_status, ctx.idx, 'email_subscription_status'),
            country_code: cc,
            is_unsubscribed: wa === 'unsubscribed',
            owner_id: ownerId,
            source,
            status,
            // the app keeps these two in columns of their own (the API reads them there); Waboo stores the checkbox as an option id
            email_confirmed: optionValueOf('email_confirmed', doc.email_confirmed, ctx.idx) === true,
            fax_number: str(doc.fax_number),
            created_at: t.created,
            updated_at: t.updated,
          },
        },
      ],
    };
  },
  /** CON-00001 style ids, reserved from sequence_counters the way DisplayIdService does, so the counter ends >= the max imported id. */
  async beforeInsert(tx, ctx, table, rows) {
    if (table !== 'contacts' || rows.length === 0) return;
    const res = await tx.execute(sql`
      INSERT INTO sequence_counters (org_id, module_key, current_value)
      VALUES (${ctx.orgId}, 'contacts', ${rows.length})
      ON CONFLICT (org_id, module_key) DO UPDATE SET current_value = sequence_counters.current_value + ${rows.length}
      RETURNING current_value`);
    const end = Number((res.rows[0] as { current_value: number | string }).current_value);
    sortForDisplayId(rows).forEach((r, i) => {
      r.display_id = `CON-${String(end - rows.length + 1 + i).padStart(5, '0')}`;
    });
  },
};

export const groupMembers: HandlerSpec = {
  handler: 'group_members',
  collection: 'contact_list',
  mapCollection: 'contact_list.marketing_list',
  virtual: true,
  // update mode: a membership the contact no longer has in Waboo is removed (only while the contact is still live and the row is untouched);
  // the timestamps hang off the contact's created time and the earliest contact date, so they are never rewritten
  update: {
    ignore: ['created_at', 'updated_at'],
    prune: (key, env) => env.idx.contactLive.has(key.split(':')[0]!),
  },
  fields: { _id: 'id', contact: 'col:contact_id', list: 'col:group_id', at: 'col:created_at' },
  tables: {
    contact_group_members: {
      columns: [c('contact_id', 'bigint'), c('group_id', 'bigint'), ...TS_COLS],
      fp: [],
      constants: { row_version: 1 },
    },
  },
  async *read({ source, client, idx }) {
    for await (const d of source.read(client, 'contact_list')) {
      if (isDeleted(d) || !Array.isArray(d.marketing_list)) continue;
      const contact = primaryKey(d);
      const at = times(d, idx.firstContactAt).created;
      for (const list of [...new Set(d.marketing_list.map(String))])
        yield { _id: `${contact}:${list}`, contact, list, at };
    }
  },
  transform(doc: Doc, ctx: Ctx): Outcome {
    const list = String(doc.list);
    if (ctx.idx.listDeleted.has(list))
      return {
        kind: 'exclude',
        code: 'LIST_DELETED',
        reason: 'the marketing list is soft-deleted',
      };
    const group = ctx.ref('marketing_list', list);
    if (!group)
      return {
        kind: 'quarantine',
        code: 'UNKNOWN_LIST',
        reason: `marketing list ${list} does not exist in the source`,
      };
    const contact = ctx.ref('contact_list', doc.contact);
    if (!contact)
      return {
        kind: 'quarantine',
        code: 'CONTACT_NOT_MIGRATED',
        reason: 'the contact was quarantined or not loaded',
      };
    const at = String(doc.at);
    return {
      kind: 'rows',
      rows: [
        {
          table: 'contact_group_members',
          sub: '',
          row: { contact_id: contact.id, group_id: group.id, created_at: at, updated_at: at },
        },
      ],
    };
  },
};
