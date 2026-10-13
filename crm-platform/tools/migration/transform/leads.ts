import { docKeys, isDeleted, plain, scrub, setOwn, str, toDate, type Doc } from '../util';
import { c, times } from './common';
import type { Ctx, HandlerSpec, Outcome, Row, Soft } from './types';

/**
 * Stage 2: lead data. Three Waboo collections, three targets:
 *   leadrepo / leads  -> lead_events (history of one lead capture each) under one inert lead_sources row per collection
 *   contact_attribution -> contact_attributions (the first touch of a contact)
 * Everything is HISTORY: lead_events are written as status `created` (finished), the lead_sources are `paused` connectors with no token,
 * no deal, no outbox, no notification (the ingest service writes those; this tool never calls it). See README "Stage 2: lead data".
 */

/** Days a migrated payload is kept before the app's retention sweep nulls it (the largest value the table allows). */
export const LEAD_RETENTION_DAYS = 365;
/** The collections that become an import lead source, in load order. */
export const LEAD_SOURCE_COLLECTIONS = ['leadrepo', 'leads'] as const;
/** Marker the stream of `leads` puts on a document whose session already exists in leadrepo (never part of a Waboo document). */
export const DUP_MARK = '__waboo_dup_of_leadrepo';

export const sourceName = (collection: string): string => `Waboo import: ${collection}`;
export const sourceRef = (client: string, collection: string): string =>
  `waboo:${client}:${collection}`;
export const expiryOf = (fallbackAt: string): string =>
  new Date(Date.parse(fallbackAt) + LEAD_RETENTION_DAYS * 86_400_000).toISOString();

// --- lead_sources: one derived document per lead collection that is in the dump ----------------------------------------------------

export const leadSources: HandlerSpec = {
  handler: 'lead_sources',
  collection: 'leadrepo',
  mapCollection: 'lead_sources',
  virtual: true,
  tables: {
    lead_sources: {
      columns: [
        c('kind', 'text'),
        c('provider_key', 'text'),
        c('external_ref', 'text'),
        c('name', 'text'),
        c('status', 'text'),
        c('raw_retention_days', 'integer'),
        c('field_mapping', 'jsonb'),
        c('defaults', 'jsonb'),
        c('created_at', 'timestamptz'),
        c('updated_at', 'timestamptz'),
      ],
      constants: {
        token_hash: null,
        token_hint: null,
        token_rotated_at: null,
        secret_enc: null,
        external_id_path: null,
        rr_cursor: 0,
        last_event_at: null,
        created_by: null,
        row_version: 1,
      },
    },
  },
  fields: { _id: 'id' },
  async *read({ source, client }) {
    for (const coll of LEAD_SOURCE_COLLECTIONS) {
      if (!source.collections(client).includes(coll)) continue;
      let any = false;
      for await (const _ of source.read(client, coll)) {
        any = true;
        break;
      }
      if (any) yield { _id: coll };
    }
  },
  transform(doc: Doc, ctx: Ctx): Outcome {
    const coll = String(doc._id);
    return {
      kind: 'rows',
      rows: [
        {
          table: 'lead_sources',
          sub: '',
          row: {
            kind: 'connector',
            provider_key: 'waboo',
            external_ref: sourceRef(ctx.client, coll),
            name: sourceName(coll),
            status: 'paused',
            raw_retention_days: LEAD_RETENTION_DAYS,
            field_mapping: {},
            defaults: {},
            created_at: ctx.fallbackAt,
            updated_at: ctx.fallbackAt,
          },
        },
      ],
    };
  },
};

// --- lead_events -------------------------------------------------------------------------------------------------------------------

/** Keys that have a fixed place in the payload; every other key is a form answer and goes to payload.fields (dynamic per client). */
const SESSION_KEYS = ['session_id', 'botid', 'module_id'];
const ATTRIBUTION_KEYS = [
  'campaignMedium',
  'campaignName',
  'campaignSource',
  'source',
  'channel',
  'module',
  'entry_point',
];
const DEVICE_KEYS = [
  'browser',
  'browserName',
  'city',
  'country',
  'deviceModel',
  'deviceType',
  'language',
  'operatingSystem',
  'operatingSystemName',
  'referrer',
  'referrerKeyword',
  'referrerName',
  'referrerSearchEngineUrl',
  'referrerType',
  'referrerUrl',
  'state',
  'matomo',
  'identity_id',
];
const SYSTEM_KEYS = ['_id', 'id', 'contact_id', 'createdAt', 'updatedAt', DUP_MARK];

const present = (v: unknown): boolean =>
  v !== null && v !== undefined && !(typeof v === 'string' && v.trim() === '');

const LEAD_FIELDS: Record<string, string> = {
  _id: 'id (external_id = <collection>:<_id>)',
  id: 'id',
  contact_id: 'col:contact_id (resolved through id_map)',
  createdAt: 'col:created_at / received_at',
  updatedAt: 'col:updated_at / processed_at',
  session_id: 'payload.legacy.waboo.sessionId',
  botid: 'payload.legacy.waboo.botId',
  module_id: 'payload.legacy.waboo.moduleId',
  [DUP_MARK]: 'drop:stream marker of the leads step, not a Waboo field',
  ...Object.fromEntries(ATTRIBUTION_KEYS.map((k) => [k, 'payload.attribution'])),
  ...Object.fromEntries(DEVICE_KEYS.map((k) => [k, 'payload.device'])),
};

/** The payload the app keeps for a lead: { externalId, fields, attribution, device, legacy }. Scrubbed, empty values removed. */
export function leadPayload(doc: Doc, collection: string, key: string, externalId: string): Row {
  const fields: Doc = {};
  const attribution: Doc = {};
  const device: Doc = {};
  const sys = new Set([...SYSTEM_KEYS, ...SESSION_KEYS]);
  for (const [k, v] of Object.entries(doc)) {
    if (sys.has(k) || !present(v)) continue;
    if (ATTRIBUTION_KEYS.includes(k)) setOwn(attribution, k, plain(v));
    else if (DEVICE_KEYS.includes(k)) setOwn(device, k, plain(v));
    else setOwn(fields, k, plain(v));
  }
  const legacy: Doc = { collection, id: key };
  for (const [k, name] of [
    ['session_id', 'sessionId'],
    ['botid', 'botId'],
    ['module_id', 'moduleId'],
  ] as const)
    if (present(doc[k])) legacy[name] = String(doc[k]);
  const payload = { externalId, fields, attribution, device, legacy: { waboo: legacy } };
  return scrub(payload).value as Row;
}

function leadEvent(collection: 'leadrepo' | 'leads'): HandlerSpec['transform'] {
  return (doc: Doc, ctx: Ctx): Outcome => {
    if (isDeleted(doc))
      return { kind: 'exclude', code: 'SOFT_DELETED', reason: 'is_deleted or deleted_time is set' };
    if (doc[DUP_MARK] === true)
      return {
        kind: 'exclude',
        code: 'DUPLICATE_OF_LEADREPO',
        reason: 'a leadrepo document has the same session_id: the lead is loaded from leadrepo',
      };
    const key = docKeys(doc)[0]?.key;
    if (!key) return { kind: 'quarantine', code: 'NO_KEY', reason: 'no _id' };
    const contactKey = str(doc.contact_id);
    if (!contactKey)
      return {
        kind: 'quarantine',
        code: 'NO_CONTACT_ID',
        reason: 'the lead names no contact; nothing is created for it',
      };
    const contact = ctx.ref('contact_list', contactKey);
    if (!contact) {
      if (ctx.idx.contactDeleted.has(contactKey))
        return { kind: 'exclude', code: 'PARENT_EXCLUDED', reason: 'the contact is soft-deleted' };
      return {
        kind: 'quarantine',
        code: 'CONTACT_NOT_MIGRATED',
        reason: `contact ${contactKey} is not a migrated contact`,
      };
    }
    const src = ctx.ref('lead_sources', collection);
    if (!src)
      return {
        kind: 'quarantine',
        code: 'SOURCE_MISSING',
        reason: `the lead_sources step has not loaded the import source of ${collection}`,
      };
    const t = times(doc, ctx.fallbackAt, ['createdAt', 'created_at'], ['updatedAt', 'updated_at']);
    const soft: Soft[] = [...t.soft];
    let updated = t.updated;
    if (updated < t.created) {
      soft.push({
        code: 'DATES_SWAPPED',
        reason: 'updatedAt is before createdAt: updated_at is set to created_at',
        detail: updated,
      });
      updated = t.created;
    }
    const externalId = `${collection}:${key}`;
    return {
      kind: 'rows',
      soft,
      rows: [
        {
          table: 'lead_events',
          sub: '',
          row: {
            source_id: src.id,
            external_id: externalId,
            status: 'created',
            is_test: false,
            contact_id: contact.id,
            payload: leadPayload(doc, collection, key, externalId),
            payload_expires_at: expiryOf(ctx.fallbackAt),
            received_at: t.created,
            processed_at: updated,
            created_at: t.created,
            updated_at: updated,
          },
        },
      ],
    };
  };
}

const EVENT_TABLE = {
  columns: [
    c('source_id', 'bigint'),
    c('external_id', 'text'),
    c('status', 'text'),
    c('is_test', 'boolean'),
    c('contact_id', 'bigint'),
    c('payload', 'jsonb'),
    c('payload_expires_at', 'timestamptz'),
    c('received_at', 'timestamptz'),
    c('processed_at', 'timestamptz'),
    c('created_at', 'timestamptz'),
    c('updated_at', 'timestamptz'),
  ],
  constants: {
    reason: null,
    error: null,
    deal_id: null,
    payload_purged_at: null,
    attempts: 1,
    duplicate_count: 0,
    last_duplicate_at: null,
    row_version: 1,
  },
};

export const leadEvents: HandlerSpec = {
  handler: 'lead_events',
  collection: 'leadrepo',
  mapCollection: 'leadrepo',
  tables: { lead_events: EVENT_TABLE },
  fields: LEAD_FIELDS,
  extraKeysStored: true,
  transform: leadEvent('leadrepo'),
};

export const leadEventsLeads: HandlerSpec = {
  handler: 'lead_events_leads',
  collection: 'leads',
  mapCollection: 'leads',
  tables: { lead_events: EVENT_TABLE },
  fields: LEAD_FIELDS,
  extraKeysStored: true,
  /** The `leads` rows whose session is already in leadrepo are marked, so the transform (loader and verifier alike) excludes them. */
  async *read({ source, client }) {
    if (!source.collections(client).includes('leads')) return;
    const known = new Set<string>();
    if (source.collections(client).includes('leadrepo'))
      for await (const d of source.read(client, 'leadrepo')) {
        const s = str(d.session_id);
        if (s) known.add(s);
      }
    for await (const d of source.read(client, 'leads')) {
      const s = str(d.session_id);
      yield s && known.has(s) ? { ...d, [DUP_MARK]: true } : d;
    }
  },
  transform: leadEvent('leads'),
};

// --- contact_attribution -> contact_attributions ---------------------------------------------------------------------------------------

const ATTR_FIELDS: Record<string, string> = {
  _id: 'id',
  id: 'id',
  contact_id: 'col:contact_id (resolved through id_map)',
  first_touch:
    'col:platform / source_label / campaign / form / captured_at (first_touch.source, .platform, .raw_utm_campaign, .module_name, .captured_at); first_touch.channel, .module_type, .raw_utm_source|medium|content|term and the registry ids have no column',
  source: 'col:source_label fallback when first_touch has none',
  platform: 'col:platform fallback when first_touch has none',
  module_name: 'col:form fallback when first_touch has none',
  created_at: 'col:captured_at fallback; created_at of the row = captured_at',
  channel: 'drop:channel of the CURRENT touch; contact_attributions has no channel column',
  module_type: 'drop:module type (Contacts / API / Whatsapp Chatbot); no column',
  updated_at: 'drop:contact_attributions is append-only and has no updated_at',
};

export const attributions: HandlerSpec = {
  handler: 'attributions',
  collection: 'contact_attribution',
  mapCollection: 'contact_attribution',
  tables: {
    contact_attributions: {
      columns: [
        c('contact_id', 'bigint'),
        c('platform', 'text'),
        c('source_label', 'text'),
        c('campaign', 'text'),
        c('form', 'text'),
        c('captured_at', 'timestamptz'),
        c('created_at', 'timestamptz'),
      ],
      constants: { lead_event_id: null, source_id: null, adset: null, ad: null },
    },
  },
  fields: ATTR_FIELDS,
  transform(doc: Doc, ctx: Ctx): Outcome {
    if (isDeleted(doc))
      return { kind: 'exclude', code: 'SOFT_DELETED', reason: 'is_deleted or deleted_time is set' };
    const contactKey = str(doc.contact_id);
    if (!contactKey)
      return { kind: 'quarantine', code: 'NO_CONTACT_ID', reason: 'attribution without a contact' };
    const contact = ctx.ref('contact_list', contactKey);
    if (!contact) {
      if (ctx.idx.contactDeleted.has(contactKey))
        return { kind: 'exclude', code: 'PARENT_EXCLUDED', reason: 'the contact is soft-deleted' };
      return {
        kind: 'quarantine',
        code: 'CONTACT_NOT_MIGRATED',
        reason: `contact ${contactKey} is not a migrated contact`,
      };
    }
    const ft: Doc =
      doc.first_touch && typeof doc.first_touch === 'object' ? (doc.first_touch as Doc) : {};
    const pick = (k: string): string | null => str(ft[k]) ?? str(doc[k]);
    const platform = pick('platform');
    const label = pick('source') ?? platform ?? pick('channel');
    if (!label)
      return {
        kind: 'quarantine',
        code: 'NO_SOURCE_LABEL',
        reason: 'no source, platform or channel to put in source_label (NOT NULL)',
      };
    const soft: Soft[] = [];
    const t = times(doc, ctx.fallbackAt, ['created_at'], ['updated_at']);
    soft.push(...t.soft);
    let captured = toDate(ft.captured_at);
    if (!captured) {
      if (ft.captured_at !== undefined && ft.captured_at !== null)
        soft.push({ code: 'BAD_DATE', reason: 'first_touch.captured_at is not a readable date' });
      captured = new Date(t.created);
    }
    const latest = { source: str(doc.source), platform: str(doc.platform) };
    if (
      (latest.source !== null && str(ft.source) !== null && latest.source !== str(ft.source)) ||
      (latest.platform !== null &&
        str(ft.platform) !== null &&
        latest.platform !== str(ft.platform))
    )
      soft.push({
        code: 'LATEST_TOUCH_DIFFERS',
        reason:
          'the current (top-level) touch differs from first_touch; only the first touch is imported',
        detail: { source: latest.source, platform: latest.platform },
      });
    return {
      kind: 'rows',
      soft,
      rows: [
        {
          table: 'contact_attributions',
          sub: '',
          row: {
            contact_id: contact.id,
            platform,
            source_label: label,
            campaign: str(ft.raw_utm_campaign),
            form: pick('module_name'),
            captured_at: captured.toISOString(),
            created_at: captured.toISOString(),
          },
        },
      ],
    };
  },
};
