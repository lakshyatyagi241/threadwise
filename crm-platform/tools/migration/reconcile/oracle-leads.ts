/**
 * An INDEPENDENT second implementation of the lead-data rules, written for the verifier. It imports nothing from transform/, load/ or
 * the loader's rules (shared on purpose: the pure hash `uuidv5` and the credential `scrub` of util.ts, the one definition of "secret").
 * It reads the raw dump and says, for every document, what must be in the target: a row (every column), a quarantine, or an exclusion.
 * A bug in transform/leads.ts therefore makes the target disagree with this file and reconcile fails.
 */
import { scrub, uuidv5 } from '../util';
import { dateOf, hexKey, oidDate, oracleDeleted, text } from './oracle';

type Doc = Record<string, unknown>;

export interface LVerdict {
  collection: string;
  key: string;
  verdict: 'load' | 'exclude' | 'quarantine';
  code?: string;
  uuid: string;
  /** lead_events / contact_attributions: the contact's legacy_id (Mongo _id hex) the row must point at */
  contact?: string;
  row?: Record<string, unknown>;
  softs: string[];
}

const RETENTION_MS = 365 * 86_400_000;
const ATTR = [
  'campaignMedium',
  'campaignName',
  'campaignSource',
  'source',
  'channel',
  'module',
  'entry_point',
];
const DEVICE = [
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
const SESSION: Array<[string, string]> = [
  ['session_id', 'sessionId'],
  ['botid', 'botId'],
  ['module_id', 'moduleId'],
];
const SYSTEM = new Set([
  '_id',
  'id',
  'contact_id',
  'createdAt',
  'updatedAt',
  ...SESSION.map(([k]) => k),
]);

const filled = (v: unknown): boolean => v !== null && v !== undefined && text(v) !== '';
const plainOf = (v: unknown): unknown => JSON.parse(JSON.stringify(v ?? null));
const keyOf = (d: Doc): string => hexKey(d._id) || text(d.id);

/** Which contact (by Mongo _id hex) a reference resolves to, and which references belong to a contact deleted at the source. */
export function contactDirectory(contactDocs: Doc[]): {
  legacyOf: (ref: string) => string | undefined;
  deleted: Set<string>;
} {
  const primary = new Set(contactDocs.map((d) => hexKey(d._id)).filter(Boolean));
  const byAlias = new Map<string, string>();
  const deleted = new Set<string>();
  for (const d of contactDocs) {
    const hex = hexKey(d._id);
    if (oracleDeleted(d)) {
      if (hex) deleted.add(hex);
      if (text(d.id)) deleted.add(text(d.id));
    }
    const alias = text(d.id);
    if (hex && alias && !primary.has(alias) && !byAlias.has(alias)) byAlias.set(alias, hex);
  }
  return { legacyOf: (ref) => (primary.has(ref) ? ref : byAlias.get(ref)), deleted };
}

export function oracleSources(client: string, present: string[]): LVerdict[] {
  const at = '__FALLBACK__';
  return present.map((c) => ({
    collection: 'lead_sources',
    key: c,
    verdict: 'load',
    uuid: uuidv5(`${client}|lead_sources|${c}`),
    row: {
      kind: 'connector',
      provider_key: 'waboo',
      external_ref: `waboo:${client}:${c}`,
      name: `Waboo import: ${c}`,
      status: 'paused',
      raw_retention_days: 365,
      field_mapping: {},
      defaults: {},
      created_at: at,
      updated_at: at,
    },
    softs: [],
  }));
}

export function oracleEvent(
  client: string,
  collection: 'leadrepo' | 'leads',
  doc: Doc,
  dir: ReturnType<typeof contactDirectory>,
  fallbackAt: string,
  sessionsInLeadrepo: Set<string> | null,
): LVerdict {
  const key = keyOf(doc);
  const base = {
    collection,
    key,
    uuid: uuidv5(`${client}|${collection}|${key}`),
    softs: [] as string[],
  };
  if (oracleDeleted(doc)) return { ...base, verdict: 'exclude', code: 'SOFT_DELETED' };
  if (
    sessionsInLeadrepo &&
    sessionsInLeadrepo.has(text(doc.session_id)) &&
    text(doc.session_id) !== ''
  )
    return { ...base, verdict: 'exclude', code: 'DUPLICATE_OF_LEADREPO' };
  const ref = text(doc.contact_id);
  if (ref === '') return { ...base, verdict: 'quarantine', code: 'NO_CONTACT_ID' };
  if (dir.deleted.has(ref)) return { ...base, verdict: 'exclude', code: 'PARENT_EXCLUDED' };
  const legacy = dir.legacyOf(ref);
  if (legacy === undefined) return { ...base, verdict: 'quarantine', code: 'CONTACT_NOT_MIGRATED' };
  // dates
  const created = dateOf(doc.createdAt) ?? oidDate(doc._id) ?? new Date(fallbackAt);
  const read = dateOf(doc.updatedAt) ?? created;
  const updated = read < created ? created : read;
  // payload
  const externalId = `${collection}:${key}`;
  const fields: Doc = {};
  const attribution: Doc = {};
  const device: Doc = {};
  for (const [k, v] of Object.entries(doc)) {
    if (SYSTEM.has(k) || k === '__waboo_dup_of_leadrepo' || !filled(v)) continue;
    (ATTR.includes(k) ? attribution : DEVICE.includes(k) ? device : fields)[k] = plainOf(v);
  }
  const legacyInfo: Doc = { collection, id: key };
  for (const [k, n] of SESSION) if (filled(doc[k])) legacyInfo[n] = String(doc[k]);
  const payload = scrub({
    externalId,
    fields,
    attribution,
    device,
    legacy: { waboo: legacyInfo },
  }).value;
  return {
    ...base,
    verdict: 'load',
    contact: legacy,
    row: {
      external_id: externalId,
      status: 'created',
      is_test: false,
      payload,
      payload_expires_at: new Date(Date.parse(fallbackAt) + RETENTION_MS).toISOString(),
      received_at: created.toISOString(),
      processed_at: updated.toISOString(),
      created_at: created.toISOString(),
      updated_at: updated.toISOString(),
    },
  };
}

export function oracleAttribution(
  client: string,
  doc: Doc,
  dir: ReturnType<typeof contactDirectory>,
  fallbackAt: string,
): LVerdict {
  const key = keyOf(doc);
  const base = {
    collection: 'contact_attribution',
    key,
    uuid: uuidv5(`${client}|contact_attribution|${key}`),
    softs: [] as string[],
  };
  if (oracleDeleted(doc)) return { ...base, verdict: 'exclude', code: 'SOFT_DELETED' };
  const ref = text(doc.contact_id);
  if (ref === '') return { ...base, verdict: 'quarantine', code: 'NO_CONTACT_ID' };
  if (dir.deleted.has(ref)) return { ...base, verdict: 'exclude', code: 'PARENT_EXCLUDED' };
  const legacy = dir.legacyOf(ref);
  if (legacy === undefined) return { ...base, verdict: 'quarantine', code: 'CONTACT_NOT_MIGRATED' };
  const ft = (doc.first_touch && typeof doc.first_touch === 'object' ? doc.first_touch : {}) as Doc;
  const pick = (k: string): string | null => text(ft[k]) || text(doc[k]) || null;
  const platform = pick('platform');
  const label = pick('source') ?? platform ?? pick('channel');
  if (label === null) return { ...base, verdict: 'quarantine', code: 'NO_SOURCE_LABEL' };
  const created = dateOf(doc.created_at) ?? oidDate(doc._id) ?? new Date(fallbackAt);
  const captured = dateOf(ft.captured_at) ?? created;
  const softs: string[] = [];
  const ls = text(doc.source);
  const lp = text(doc.platform);
  if (
    (ls !== '' && text(ft.source) !== '' && ls !== text(ft.source)) ||
    (lp !== '' && text(ft.platform) !== '' && lp !== text(ft.platform))
  )
    softs.push('LATEST_TOUCH_DIFFERS');
  return {
    ...base,
    softs,
    verdict: 'load',
    contact: legacy,
    row: {
      platform,
      source_label: label,
      campaign: text(ft.raw_utm_campaign) || null,
      form: pick('module_name'),
      captured_at: captured.toISOString(),
      created_at: captured.toISOString(),
      evidence: scrub({
        legacy: {
          waboo: {
            id: key,
            current: Object.fromEntries(
              Object.entries(doc)
                .filter(
                  ([k, v]) =>
                    !['_id', 'id', 'contact_id', 'first_touch'].includes(k) &&
                    v !== null &&
                    v !== undefined,
                )
                .map(([k, v]) => [k, plainOf(v)]),
            ),
            firstTouch: Object.fromEntries(
              Object.entries(ft)
                .filter(([, v]) => v !== null && v !== undefined)
                .map(([k, v]) => [k, plainOf(v)]),
            ),
          },
        },
      }).value,
    },
  };
}
