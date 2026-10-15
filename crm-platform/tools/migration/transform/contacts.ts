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
export const REJECT_MARKER = /^__.+__(error_reason|unverified_value)$/;

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

/** Test seam: the verifier's independent oracle must catch a bug injected here. */
export const transformHooks = {
  phoneOf: (raw: string, cc: string | null, def: string | null) => phoneOf(raw, cc, def),
};

/** A subscription value (option id or label) as the app's lowercase status word. */
export function subscriptionStatus(raw: unknown, idx: SourceIndex): string | null {
  const v = str(raw);
  if (!v) return null;
  const label = (idx.optionLabel.get(v) ?? v).trim().toLowerCase();
  if (['yes', 'subscribed', 'opt-in', 'opted in', 'opt in'].includes(label)) return 'subscribed';
  if (['no', 'unsubscribed', 'opt-out', 'opted out', 'opt out'].includes(label))
    return 'unsubscribed';
  return slug(label) || null;
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
        email_confirmed: false,
        lead_score: null,
        other_lost_reason: null,
        import_job_id: null,
        submitted_by_agent_id: null,
        created_by: null,
        updated_by: null,
        channel: null,
        channel_uid: null,
        unsubscribed_at: null,
        fax_number: null,
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
    const rawPhone = str(doc.mobile_phone_number) ?? str(doc.whatsapp_phone_number);
    let phone: string | null = null;
    if (rawPhone) {
      phone = transformHooks.phoneOf(rawPhone, ccRaw, ctx.defaultCountryCode);
      if (!phone)
        soft.push({
          code: 'INVALID_PHONE',
          reason:
            'cannot be read as an E.164 number (letters, an extension, or the wrong digit count); left empty',
          detail: rawPhone,
        });
    }

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

    const wa = subscriptionStatus(doc.whatsapp_subscription_status, ctx.idx);
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
      setOwn(data, k, s.value);
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
      if (ref && ref.table === 'users') ownerId = ref.id;
      else
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
            lifecycle_stage_date: iso(toDate(doc.lifecycle_stage_date)),
            previous_lifecycle_stage: previous,
            previous_lifecycle_stage_date: iso(toDate(doc.previous_lifecycle_stage_date)),
            lost_reason: str(doc.lost_reason),
            whatsapp_subscription_status: wa,
            sms_subscription_status: subscriptionStatus(doc.sms_subscription_status, ctx.idx),
            email_subscription_status: subscriptionStatus(doc.email_subscription_status, ctx.idx),
            country_code: cc,
            is_unsubscribed: wa === 'unsubscribed',
            owner_id: ownerId,
            source,
            status,
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
    rows.forEach((r, i) => {
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
