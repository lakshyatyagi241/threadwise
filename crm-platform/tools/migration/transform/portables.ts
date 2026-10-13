import { isDeleted, plain, primaryKey, scrub, slug, str, type Doc } from '../util';
import { c, times, TS_COLS } from './common';
import type { Ctx, HandlerSpec, Outcome, Soft } from './types';

/**
 * whatsapp_flow -> wa_forms, api_library -> api_library_apis, webhooks -> (quarantined), chatlabels -> (quarantined).
 * See the README section "Stage 2: forms, API library, webhooks, labels" for the decisions.
 */

const SECRET_PARTS = ['authorization', 'token', 'secret', 'password', 'passwd', 'apikey', 'cookie', 'credential', 'signature', 'bearer', 'privatekey', 'xauth'];
// mirrors apiLibraryIsSensitiveName of packages/contracts/src/api-library/definition.ts (not importable here)
const sensitive = (name: string): boolean => {
  const k = name.toLowerCase().replace(/[-_.\s]/g, '');
  return k === 'auth' || SECRET_PARTS.some((p) => k.includes(p));
};
const idTail = (doc: Doc): string => primaryKey(doc).replace(/[^a-z0-9]/gi, '').slice(-6).toLowerCase();
const isObj = (v: unknown): v is Doc => v !== null && typeof v === 'object' && !Array.isArray(v);

// --- whatsapp_flow -> wa_forms --------------------------------------------------------------------------------------------------

export const waForms: HandlerSpec = {
  handler: 'wa_forms',
  collection: 'whatsapp_flow',
  mapCollection: 'whatsapp_flow',
  tables: {
    wa_forms: {
      columns: [c('title', 'text'), c('slug', 'text'), c('definition_json', 'jsonb'), c('status', 'text'), ...TS_COLS],
      fp: ['title', 'slug', 'definition_json', 'status'],
      // never published, never tied to a provider: nothing can sync to Meta or be sent from an imported form
      constants: {
        user_id: null,
        purpose: null,
        audience_type: 'lead_capture',
        submission_cap: 0,
        cap_reached_note: null,
        send_button_label: 'Send',
        thank_you_note: null,
        meta_flow_id: null,
        provider_config_id: null,
        published_at: null,
        publish_error: null,
        submission_count: 0,
        row_version: 1,
      },
    },
  },
  fields: {
    _id: 'id',
    id: 'id',
    name: 'col:title (and slug: slugified name + the last 6 characters of the id, so it is unique)',
    status: 'col:status = draft always (DRAFT / PUBLISHED both load as draft: nothing is published); the Waboo value is kept in definition_json.legacyWaboo.status',
    categories: 'jsonb:definition_json.legacyWaboo.categories',
    template_flow: 'jsonb:definition_json.legacyWaboo.template_flow (the Meta Flow JSON, raw, scrubbed; no WaDesk builder reads it yet: FORM_DEFINITION_RAW)',
    mapping_object: 'jsonb:definition_json.legacyWaboo.mapping_object (screen field -> contact property map, raw)',
    meta_id: 'jsonb:definition_json.legacyWaboo.meta_id (NOT in meta_flow_id: a form with a Meta id would be sent by flow nodes and edited at Meta)',
    clone_id: 'jsonb:definition_json.legacyWaboo.clone_id',
    created_time: 'col:created_at',
    modified_time: 'col:updated_at',
    is_deleted: 'drop:soft-delete flag; deleted forms are excluded and counted',
    deleted_time: 'drop:soft-delete timestamp',
  },
  transform(doc: Doc, ctx: Ctx): Outcome {
    if (isDeleted(doc)) return { kind: 'exclude', code: 'SOFT_DELETED', reason: 'is_deleted or deleted_time is set' };
    const title = str(doc.name);
    if (!title) return { kind: 'quarantine', code: 'INVALID_NAME', reason: 'form name is empty' };
    const t = times(doc, ctx.fallbackAt);
    const soft: Soft[] = [...t.soft];
    const wStatus = (str(doc.status) ?? '').toUpperCase();
    if (wStatus === 'PUBLISHED')
      soft.push({ code: 'FORM_NOT_PUBLISHED', reason: 'the form was PUBLISHED in Waboo; it loads as a draft with no provider and no Meta id (publish it again from WaDesk)' });
    soft.push({ code: 'FORM_DEFINITION_RAW', reason: 'template_flow / mapping_object are kept raw under definition_json.legacyWaboo, not converted to the WaDesk form definition' });
    const legacyWaboo = scrub(
      plain({
        status: str(doc.status),
        categories: doc.categories,
        template_flow: doc.template_flow,
        mapping_object: doc.mapping_object,
        meta_id: str(doc.meta_id),
        clone_id: str(doc.clone_id),
      }),
    ).value;
    const base = slug(title).replace(/_/g, '-').slice(0, 60) || 'form';
    return {
      kind: 'rows',
      soft,
      rows: [
        {
          table: 'wa_forms',
          sub: '',
          row: {
            title,
            slug: `${base}-${idTail(doc)}`,
            definition_json: { source: 'waboo', legacyWaboo },
            status: 'draft',
            created_at: t.created,
            updated_at: t.updated,
          },
        },
      ],
    };
  },
};

// --- api_library -> api_library_apis ----------------------------------------------------------------------------------------------

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const TOKEN = /\{\{\s*([^{}]+?)\s*\}\}/g;

export const apiLibrary: HandlerSpec = {
  handler: 'api_library',
  collection: 'api_library',
  mapCollection: 'api_library',
  tables: {
    api_library_apis: {
      columns: [
        c('name', 'text'),
        c('method', 'text'),
        c('url', 'text'),
        c('payload_type', 'text'),
        c('headers', 'jsonb'),
        c('body', 'jsonb'),
        ...TS_COLS,
      ],
      fp: ['name', 'method', 'url', 'payload_type', 'headers', 'body'],
      constants: { variables: [], function_code: null, mapping_config: [], response_variables: [], created_by: null, row_version: 1 },
    },
  },
  fields: {
    _id: 'id',
    id: 'drop:the id inside Waboo (id_map keeps the document id)',
    name: 'col:name (letters, digits, underscore, 64 max; a changed name gets _<last 4 of the id>: API_NAME_CHANGED)',
    method: 'col:method (upper case; one WaDesk does not have is quarantined)',
    payload_type: 'col:payload_type (application/json or multipart/form-data)',
    url: 'col:url (the value of a secret-looking query parameter is emptied: API_URL_SECRET_BLANKED)',
    header: 'col:headers ([{key, value, secret}]; a secret-looking header keeps its name with an EMPTY value and secret=true: API_HEADER_SECRET_BLANKED)',
    body: 'col:body (scrubbed of credential-looking keys)',
    body_config: 'drop:the Waboo payload-editor rows (name, type, default_value, key); WaDesk declares variables itself (API_VARIABLES_NOT_CARRIED)',
    created_time: 'col:created_at',
    modified_time: 'col:updated_at',
    is_deleted: 'drop:soft-delete flag; deleted APIs are excluded and counted',
    deleted_time: 'drop:soft-delete timestamp',
  },
  transform(doc: Doc, ctx: Ctx): Outcome {
    if (isDeleted(doc)) return { kind: 'exclude', code: 'SOFT_DELETED', reason: 'is_deleted or deleted_time is set' };
    const t = times(doc, ctx.fallbackAt);
    const soft: Soft[] = [...t.soft];
    const rawName = str(doc.name) ?? '';
    let name = rawName.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 64);
    if (name === '' || name !== rawName) {
      name = `${name || 'api'}`.slice(0, 59) + `_${idTail(doc).slice(-4)}`;
      soft.push({ code: 'API_NAME_CHANGED', reason: 'the name had characters a flow variable cannot hold (or was empty); it was made letters, digits and underscore', detail: { from: rawName, to: name } });
    }
    const method = (str(doc.method) ?? '').toUpperCase();
    if (!METHODS.has(method)) return { kind: 'quarantine', code: 'METHOD_UNSUPPORTED', reason: `method "${method}" is not GET / POST / PUT / PATCH / DELETE` };
    let url = str(doc.url) ?? '';
    if (url === '' || url.length > 2048) return { kind: 'quarantine', code: 'INVALID_URL', reason: 'url is empty or longer than 2048 characters' };
    // a secret in the query string would sit in clear text in the list screen
    const q = url.indexOf('?');
    if (q >= 0) {
      let blanked = 0;
      const head = url.slice(0, q);
      const [query, hash = ''] = url.slice(q + 1).split(/#(.*)/s);
      const cleaned = query!
        .split('&')
        .map((p) => {
          const i = p.indexOf('=');
          if (i > 0 && sensitive(p.slice(0, i)) && p.slice(i + 1) !== '') {
            blanked++;
            return `${p.slice(0, i)}=`;
          }
          return p;
        })
        .join('&');
      if (blanked > 0) {
        url = `${head}?${cleaned}${hash ? `#${hash}` : ''}`;
        soft.push({ code: 'API_URL_SECRET_BLANKED', reason: `${blanked} secret-looking query parameter value(s) were emptied` });
      }
    }
    const payload = (str(doc.payload_type) ?? 'application/json').toLowerCase();
    if (payload !== 'application/json' && payload !== 'multipart/form-data')
      return { kind: 'quarantine', code: 'PAYLOAD_UNSUPPORTED', reason: `payload_type "${payload}" is not application/json or multipart/form-data` };
    const headers: Array<{ key: string; value: string; secret: boolean }> = [];
    if (doc.header !== undefined && doc.header !== null) {
      if (!isObj(doc.header)) return { kind: 'quarantine', code: 'HEADER_SHAPE', reason: 'header is not an object' };
      for (const [k, v] of Object.entries(doc.header)) {
        const key = k.trim();
        if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(key) || key.length > 128)
          return { kind: 'quarantine', code: 'HEADER_NAME_INVALID', reason: 'a header name is not a valid HTTP header name' };
        const text = typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v);
        if (sensitive(key)) {
          headers.push({ key, value: '', secret: true });
          if (text !== '') soft.push({ code: 'API_HEADER_SECRET_BLANKED', reason: 'a secret-looking header keeps its name with an empty value (the secret goes through the encrypted path)', detail: { header: key } });
        } else headers.push({ key, value: text.slice(0, 4000), secret: false });
      }
      if (headers.length > 30) return { kind: 'quarantine', code: 'TOO_MANY_HEADERS', reason: 'more than 30 headers' };
    }
    let body: unknown = null;
    if (doc.body !== undefined && doc.body !== null) {
      if (typeof doc.body !== 'object') return { kind: 'quarantine', code: 'BODY_SHAPE', reason: 'body is neither an object nor an array' };
      body = scrub(plain(doc.body)).value;
    }
    if (Array.isArray(doc.body_config) && doc.body_config.length > 0)
      soft.push({ code: 'API_VARIABLES_NOT_CARRIED', reason: 'body_config (the payload-editor rows and their defaults) was not carried; {{tokens}} in the API are not declared as variables', detail: { rows: doc.body_config.length } });
    const tokens = new Set<string>();
    for (const m of (url + JSON.stringify(body) + JSON.stringify(headers)).matchAll(TOKEN)) tokens.add(m[1]!.trim());
    if (tokens.size > 0) soft.push({ code: 'API_TOKENS_UNDECLARED', reason: 'the API holds {{tokens}} that are not declared as variables', detail: { count: tokens.size } });
    return {
      kind: 'rows',
      soft,
      rows: [
        {
          table: 'api_library_apis',
          sub: '',
          row: { name, method, url, payload_type: payload, headers, body, created_at: t.created, updated_at: t.updated },
        },
      ],
    };
  },
};

// --- webhooks (outbound): not loadable without the app's crypto ---------------------------------------------------------------------

export const outboundWebhooks: HandlerSpec = {
  handler: 'outbound_webhooks',
  collection: 'webhooks',
  mapCollection: 'webhooks',
  tables: {
    webhooks: {
      columns: [c('name', 'text'), c('webhook_url', 'text'), c('secret', 'text'), c('events', 'jsonb'), c('status', 'boolean'), ...TS_COLS],
      fp: ['name', 'events', 'status'],
      constants: { user_id: null, environment: null, http_method: 'POST', is_failing: false, success_count: 0, failure_count: 0, retry_count: 0, row_version: 1 },
    },
  },
  // the collection is empty on all three clients: no shape is known, so nothing is claimed
  fields: { _id: 'id', id: 'id' },
  extraKeysStored: true,
  transform(): Outcome {
    // webhooks.webhook_url is NOT NULL and the app stores (and DECRYPTS, on the list screen) it as a CryptoService blob; a plain value would
    // make the whole list fail. The tool has no crypto, so a webhook cannot be written. It is kept in the raw archive.
    return { kind: 'quarantine', code: 'WEBHOOK_URL_NEEDS_ENCRYPTION', reason: 'webhook_url (and secret) are stored encrypted by the app; this tool cannot write them. Re-create the webhook in WaDesk (WEBHOOK_SECRET_NOT_CARRIED)' };
  },
};

// --- chatlabels -> tags + conversation_tag: not resolvable exactly -------------------------------------------------------------------

export const chatLabels: HandlerSpec = {
  handler: 'chat_labels',
  collection: 'chatlabels',
  mapCollection: 'chatlabels',
  tables: {
    tags: { columns: [c('name', 'citext'), ...TS_COLS], fp: ['name'], constants: { color: null, description: null, row_version: 1 } },
    conversation_tag: {
      columns: [c('conversation_id', 'bigint'), c('tag_id', 'bigint'), c('added_by', 'bigint'), ...TS_COLS],
      fp: ['conversation_id', 'tag_id'],
      constants: { row_version: 1 },
    },
  },
  fields: { _id: 'id', id: 'id' },
  extraKeysStored: true,
  transform(): Outcome {
    // the collection is empty on all three clients (no shape seen), and conversations are keyed by phone number (thread), not by Waboo id
    return { kind: 'quarantine', code: 'LABEL_LINK_UNVERIFIED', reason: 'the label -> conversation link cannot be resolved exactly (no sample, conversations are built per phone number); nothing is guessed' };
  },
};
