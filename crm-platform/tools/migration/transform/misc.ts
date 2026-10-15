import { docKeys, isDeleted, str, type Doc } from '../util';
import { c, times, TS_COLS } from './common';
import { isStatusDoc } from './source-index';
import type { Ctx, HandlerSpec, Outcome } from './types';

// --- lifecycle stages and statuses -> status_options -------------------------------------------------------------------------------

const LIFECYCLE_FIELDS = {
  _id: 'id',
  id: 'id',
  parent_id: 'col:stage_option_id (statuses) / ignored for stages',
  created_time: 'col:created_at',
  modified_time: 'col:updated_at',
  is_deleted: 'drop:soft-delete flag; deleted rows are excluded and counted',
  deleted_time: 'drop:soft-delete timestamp (empty string on live rows)',
  position: 'col:position',
  label: 'col:label (and the value, slugified)',
  name: 'col:label fallback',
  type: 'col:is_won / is_lost / which group (open, closed_won, closed_lost = status)',
  default: 'col:is_default',
  custom: 'drop:whether the stage was added by the client; status_options has no such flag',
  disable: 'col:is_active (inverted)',
};

const STATUS_COLS = [
  c('module_key', 'text'),
  c('option_group', 'text'),
  c('value', 'text'),
  c('label', 'text'),
  c('position', 'integer'),
  c('is_default', 'boolean'),
  c('is_active', 'boolean'),
  c('is_won', 'boolean'),
  c('is_lost', 'boolean'),
  c('stage_option_id', 'bigint'),
  ...TS_COLS,
];
const STATUS_FP = [
  'module_key',
  'option_group',
  'value',
  'label',
  'position',
  'is_default',
  'is_active',
  'is_won',
  'is_lost',
  'stage_option_id',
];

function lifecycle(kind: 'stage' | 'status'): HandlerSpec {
  return {
    handler: kind === 'stage' ? 'lifecycle' : 'lifecycle_status',
    collection: 'contact_lifecycle_stages',
    mapCollection: 'contact_lifecycle_stages',
    update: {},
    only: (d) => isStatusDoc(d) === (kind === 'status'),
    tables: {
      status_options: {
        columns: STATUS_COLS,
        fp: STATUS_FP,
        constants: { color: null, row_version: 1 },
      },
    },
    fields: LIFECYCLE_FIELDS,
    transform(doc: Doc, ctx: Ctx): Outcome {
      if (isDeleted(doc))
        return {
          kind: 'exclude',
          code: 'SOFT_DELETED',
          reason: 'is_deleted or deleted_time is set',
        };
      const entry = ctx.idx.stageByKey.get(docKeys(doc)[0]!.key);
      if (!entry)
        return {
          kind: 'quarantine',
          code: 'NOT_INDEXED',
          reason: 'stage missing from the source index',
        };
      const parent =
        kind === 'status' && entry.parentRef
          ? ctx.ref('contact_lifecycle_stages', entry.parentRef)
          : undefined;
      const t = times(doc, ctx.fallbackAt);
      return {
        kind: 'rows',
        soft: t.soft,
        rows: [
          {
            table: 'status_options',
            sub: '',
            row: {
              module_key: 'contacts',
              option_group: kind === 'stage' ? 'lifecycle_stage' : 'status',
              value: entry.value,
              label: entry.label,
              position: entry.position,
              is_default: entry.isDefault,
              is_active: entry.isActive,
              is_won: entry.isWon,
              is_lost: entry.isLost,
              stage_option_id:
                parent && ctx.idx.stageByKey.get(entry.parentRef!)?.kind === 'stage'
                  ? parent.id
                  : null,
              created_at: t.created,
              updated_at: t.updated,
            },
          },
        ],
      };
    },
  };
}
export const lifecycleStages = lifecycle('stage');
export const lifecycleStatuses = lifecycle('status');

// --- tags ---------------------------------------------------------------------------------------------------------------------------

export const tags: HandlerSpec = {
  handler: 'tags',
  collection: 'contact_tag',
  mapCollection: 'contact_tag',
  update: {},
  tables: {
    tags: {
      columns: [c('name', 'citext'), ...TS_COLS],
      fp: ['name'],
      constants: { color: null, description: null, row_version: 1 },
    },
  },
  fields: { _id: 'id', id: 'id', tag_title: 'col:name' },
  transform(doc: Doc, ctx: Ctx): Outcome {
    const name = str(doc.tag_title);
    if (!name) return { kind: 'quarantine', code: 'EMPTY_TAG', reason: 'tag without a title' };
    const t = times(doc, ctx.fallbackAt);
    return {
      kind: 'rows',
      soft: t.soft,
      rows: [
        { table: 'tags', sub: '', row: { name, created_at: t.created, updated_at: t.updated } },
      ],
    };
  },
};

// --- marketing lists -> contact_groups ---------------------------------------------------------------------------------------------

export const groups: HandlerSpec = {
  handler: 'groups',
  collection: 'marketing_list',
  mapCollection: 'marketing_list',
  update: {},
  tables: {
    contact_groups: {
      columns: [c('name', 'text'), c('note', 'text'), c('color', 'text'), ...TS_COLS],
      fp: ['name'],
      constants: { created_by: null, row_version: 1 },
    },
  },
  fields: {
    _id: 'id',
    id: 'id',
    name: 'col:name',
    created_time: 'col:created_at',
    modified_time: 'col:updated_at',
    deleted_time: 'drop:soft-delete timestamp; deleted lists are excluded and counted',
    is_deleted: 'drop:soft-delete flag',
    created_by: 'drop:a Waboo user; contact_groups.created_by is a users FK (users are phase 2)',
    user_id: 'drop:a Waboo user; contact_groups.created_by is a users FK (users are phase 2)',
  },
  transform(doc: Doc, ctx: Ctx): Outcome {
    if (isDeleted(doc))
      return { kind: 'exclude', code: 'SOFT_DELETED', reason: 'is_deleted or deleted_time is set' };
    const name = str(doc.name);
    if (!name || name.length > 191)
      return {
        kind: 'quarantine',
        code: 'INVALID_NAME',
        reason: 'list name is empty or longer than 191 characters',
      };
    const t = times(doc, ctx.fallbackAt);
    return {
      kind: 'rows',
      soft: t.soft,
      rows: [
        {
          table: 'contact_groups',
          sub: '',
          row: { name, note: null, color: null, created_at: t.created, updated_at: t.updated },
        },
      ],
    };
  },
};

// --- notes --------------------------------------------------------------------------------------------------------------------------

export const notes: HandlerSpec = {
  handler: 'notes',
  collection: 'contact_notes',
  mapCollection: 'contact_notes',
  tables: {
    contact_notes: {
      columns: [c('contact_id', 'bigint'), c('body', 'text'), ...TS_COLS],
      fp: ['contact_id', 'body', 'created_at'],
      constants: { created_by: null, updated_by: null, row_version: 1 },
    },
  },
  fields: {
    _id: 'id',
    id: 'id',
    contact_id: 'col:contact_id (resolved through id_map)',
    context: 'col:body',
    created_at: 'col:created_at',
    updated_at: 'col:updated_at',
    is_deleted: 'drop:soft-delete flag; deleted notes are excluded and counted',
    created_by:
      'drop:author is a Waboo user; contact_notes.created_by is a users FK (users are phase 2)',
    updated_by: 'drop:author is a Waboo user (users are phase 2)',
    created_by_username: 'drop:author display name; no column (users are phase 2)',
    updated_by_username: 'drop:author display name; no column (users are phase 2)',
  },
  transform(doc: Doc, ctx: Ctx): Outcome {
    if (isDeleted(doc))
      return { kind: 'exclude', code: 'SOFT_DELETED', reason: 'is_deleted or deleted_time is set' };
    const key = str(doc.contact_id);
    const contact = key ? ctx.ref('contact_list', key) : undefined;
    if (!contact) {
      if (key && ctx.idx.contactDeleted.has(key))
        return { kind: 'exclude', code: 'PARENT_EXCLUDED', reason: 'the contact is soft-deleted' };
      return {
        kind: 'quarantine',
        code: 'ORPHAN_CONTACT',
        reason: `contact ${key ?? '(none)'} is not a migrated contact`,
      };
    }
    const body = str(doc.context);
    if (!body) return { kind: 'quarantine', code: 'EMPTY_NOTE', reason: 'note has no text' };
    const t = times(doc, ctx.fallbackAt);
    return {
      kind: 'rows',
      soft: t.soft,
      rows: [
        {
          table: 'contact_notes',
          sub: '',
          row: {
            contact_id: contact.id,
            body: String(doc.context),
            created_at: t.created,
            updated_at: t.updated,
          },
        },
      ],
    };
  },
};
