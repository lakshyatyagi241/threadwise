import { isDeleted, str, type Doc } from '../util';
import { c, times, TS_COLS } from './common';
import { TYPE_MAP } from './fields';
import type { Ctx, HandlerSpec, Outcome, Soft } from './types';

/**
 * segments -> segments, contact_saved_views (custom ones) -> contact_views.
 *
 * Waboo keeps a filter as a rule-builder tree: { combinator, not, rules: [{ field, operator, value, valueSource } | group] } (plus a
 * mongodb_query that is only its machine copy). WaDesk keeps { type: 'group', combinator, children: [{ type: 'condition', field,
 * operator, value } | group] } (packages/contracts/src/segments/rules.ts). The conversion is by the KIND of the field (a Waboo property
 * type becomes a WaDesk field type, which has a kind); anything that cannot be said exactly in WaDesk's rules (a negated group, an
 * operator the kind does not have, an unknown field) quarantines the whole segment or view with RULE_UNSUPPORTED: a filter that
 * silently selects other contacts is worse than a missing one. A system view (My / Unassigned / All Contacts) exists natively: excluded.
 */

type Kind = 'text' | 'number' | 'date' | 'option' | 'user' | 'multi' | 'boolean';

// mirrors segmentKindForFieldType / SEGMENT_OPERATORS_BY_KIND of packages/contracts/src/segments/rules.ts (that package is not importable
// here: the tool does not resolve its dependencies). The verifier re-reads every stored tree, so a drift shows up as an alarm.
const KIND_OF_TYPE: Record<string, Kind | undefined> = {
  text: 'text',
  long_text: 'text',
  url: 'text',
  email: 'text',
  phone: 'text',
  timezone: 'text',
  lookup: 'text',
  integer: 'number',
  big_integer: 'number',
  decimal: 'number',
  percentage: 'number',
  currency: 'number',
  rating: 'number',
  boolean: 'boolean',
  checkbox: 'boolean',
  date: 'date',
  datetime: 'date',
  select: 'option',
  radio: 'option',
  multiselect: 'multi',
};
const OPS: Record<Kind, readonly string[]> = {
  text: ['equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'in', 'not_in', 'is_empty', 'is_not_empty'],
  number: ['equals', 'not_equals', 'gt', 'gte', 'lt', 'lte', 'between', 'in', 'not_in', 'is_empty', 'is_not_empty'],
  date: ['equals', 'before', 'after', 'on_or_before', 'on_or_after', 'between', 'in_last_days', 'more_than_days_ago', 'is_empty', 'is_not_empty'],
  option: ['equals', 'not_equals', 'in', 'not_in', 'is_empty', 'is_not_empty'],
  user: ['equals', 'not_equals', 'in', 'not_in', 'is_empty', 'is_not_empty'],
  multi: ['has_any', 'has_all', 'has_none', 'is_empty', 'is_not_empty'],
  boolean: ['is_true', 'is_false'],
};
/** Waboo built-in contact fields a rule can name, and what they are in WaDesk. */
const BUILTIN: Record<string, { field: string; kind: Kind }> = {
  contact_owner: { field: 'owner', kind: 'user' },
  lifecycle_stage: { field: 'lifecycleStage', kind: 'option' },
  email: { field: 'email', kind: 'text' },
  created_time: { field: 'createdAt', kind: 'date' },
  modified_time: { field: 'updatedAt', kind: 'date' },
};
const CUSTOM_KEY = /^[a-z][a-z0-9_]{0,99}$/;
const MAX_DEPTH = 3;
const MAX_CONDITIONS = 50;

class Unsupported extends Error {}

type Value = string | number | Array<string | number> | { from: string | number; to: string | number };
type Node = { type: 'condition'; field: string; operator: string; value?: Value } | { type: 'group'; combinator: 'and' | 'or'; children: Node[] };

const scalar = (v: unknown): string | number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && v.length <= 255) return v.trim();
  return null;
};
const listOf = (v: unknown): Array<string | number> | null => {
  const raw = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : null;
  if (!raw) return null;
  const out = raw.map((x) => scalar(typeof x === 'string' ? x.trim() : x)).filter((x): x is string | number => x !== null);
  return out.length > 0 && out.length <= 100 ? out : null;
};

/** One Waboo operator on one kind of field, as a WaDesk operator and value; throws Unsupported when it cannot be said exactly. */
function condition(field: string, kind: Kind, wop: string, value: unknown): Node {
  const op = (operator: string, v?: Value): Node => {
    if (!OPS[kind].includes(operator)) throw new Unsupported(`operator "${wop}" has no equivalent on a ${kind} field (${field})`);
    return v === undefined ? { type: 'condition', field, operator } : { type: 'condition', field, operator, value: v };
  };
  const one = (operator: string): Node => {
    const s = scalar(value);
    if (s === null) throw new Unsupported(`operator "${wop}" on ${field} needs a value`);
    return op(operator, s);
  };
  const list = (operator: string): Node => {
    const l = listOf(value);
    if (!l) throw new Unsupported(`operator "${wop}" on ${field} needs a list of values`);
    return op(operator, l);
  };
  switch (wop) {
    case 'null':
      return op('is_empty');
    case 'notNull':
      return op('is_not_empty');
    case '=':
      if (kind === 'boolean') return op(['true', 'yes', '1', 'checked'].includes(String(value).toLowerCase()) ? 'is_true' : 'is_false');
      return kind === 'multi' ? list('has_any') : one('equals');
    case '!=':
      return kind === 'multi' ? list('has_none') : one('not_equals');
    case '>':
      return one(kind === 'date' ? 'after' : 'gt');
    case '>=':
      return one(kind === 'date' ? 'on_or_after' : 'gte');
    case '<':
      return one(kind === 'date' ? 'before' : 'lt');
    case '<=':
      return one(kind === 'date' ? 'on_or_before' : 'lte');
    case 'contains':
      return kind === 'multi' ? list('has_any') : one('contains');
    case 'doesNotContain':
      return kind === 'multi' ? list('has_none') : one('not_contains');
    case 'beginsWith':
      return one('starts_with');
    case 'in':
      return list(kind === 'multi' ? 'has_any' : 'in');
    case 'notIn':
      return list(kind === 'multi' ? 'has_none' : 'not_in');
    case 'between': {
      const l = listOf(value);
      if (!l || l.length !== 2) throw new Unsupported(`operator "between" on ${field} needs two values`);
      return op('between', { from: l[0]!, to: l[1]! });
    }
    default:
      throw new Unsupported(`operator "${wop}" on ${field} is not one WaDesk has`);
  }
}

/** The kind of a Waboo rule field and the WaDesk name it gets (custom.<key> for a property the target has). */
function fieldOf(name: string, ctx: Ctx): { field: string; kind: Kind } {
  const b = BUILTIN[name];
  if (b) return b;
  const def = ctx.idx.fieldsByName.get(name);
  if (!def || !ctx.idx.declaredKeys.has(name)) throw new Unsupported(`field "${name}" is not a property of this workspace`);
  if (!CUSTOM_KEY.test(name)) throw new Unsupported(`field "${name}" cannot be a WaDesk custom property key`);
  const kind = KIND_OF_TYPE[TYPE_MAP[String(def.type ?? '').toLowerCase()] ?? 'text'];
  if (!kind) throw new Unsupported(`field "${name}" has a type WaDesk cannot filter`);
  return { field: `custom.${name}`, kind };
}

export function convertTree(raw: unknown, ctx: Ctx): Node {
  let count = 0;
  const walk = (n: unknown, depth: number): Node => {
    if (depth > MAX_DEPTH) throw new Unsupported('the rule tree is deeper than WaDesk allows (3 levels)');
    if (n === null || typeof n !== 'object' || Array.isArray(n)) throw new Unsupported('the rule tree is not an object');
    const o = n as Doc;
    if (Array.isArray(o.rules)) {
      if (o.not === true) throw new Unsupported('a negated group cannot be said in WaDesk rules');
      const comb = String(o.combinator ?? 'and').toLowerCase();
      if (comb !== 'and' && comb !== 'or') throw new Unsupported(`combinator "${comb}" is not and / or`);
      const children = o.rules.map((r: unknown) => walk(r, depth + 1));
      if (children.length === 0) throw new Unsupported('a group with no rules');
      return { type: 'group', combinator: comb, children };
    }
    if (++count > MAX_CONDITIONS) throw new Unsupported('more than 50 conditions');
    if (str(o.valueSource) && str(o.valueSource) !== 'value') throw new Unsupported('a rule compares two fields, which WaDesk rules cannot');
    const f = fieldOf(String(o.field ?? ''), ctx);
    return condition(f.field, f.kind, String(o.operator ?? ''), o.value);
  };
  const root = walk(raw, 1);
  // WaDesk's root is always a group: a single bare rule is wrapped
  return root.type === 'group' ? root : { type: 'group', combinator: 'and', children: [root] };
}

const num = (v: unknown): number | null => {
  const raw = v !== null && typeof v === 'object' ? ((v as Doc).$numberInt ?? (v as Doc).$numberLong ?? (v as Doc).$numberDouble) : v;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

export const segments: HandlerSpec = {
  handler: 'segments',
  collection: 'segments',
  mapCollection: 'segments',
  tables: {
    segments: {
      columns: [
        c('name', 'text'),
        c('visibility', 'text'),
        c('owner_id', 'bigint'),
        c('rules', 'jsonb'),
        c('rules_version', 'integer'),
        ...TS_COLS,
      ],
      fp: ['name', 'visibility', 'rules'],
      constants: { row_version: 1 },
    },
  },
  fields: {
    _id: 'id',
    id: 'id',
    name: 'col:name',
    filter_query: 'col:rules (converted to the WaDesk rule tree; a filter that cannot be said exactly quarantines the segment)',
    mongodb_query: 'drop:the machine copy of filter_query (MONGO_QUERY_DROPPED)',
    contact_count: 'drop:a cached member count (WaDesk counts the members itself)',
    segment_type: 'excludes a segment that is not a contact segment',
    created_by: 'col:owner_id (the migrated user, when the id resolves)',
    updated_by: 'drop:last editor; segments has no such column',
    created_time: 'col:created_at',
    modified_time: 'col:updated_at',
    is_deleted: 'drop:soft-delete flag; deleted segments are excluded and counted',
    deleted_time: 'drop:soft-delete timestamp',
  },
  transform(doc: Doc, ctx: Ctx): Outcome {
    if (isDeleted(doc)) return { kind: 'exclude', code: 'SOFT_DELETED', reason: 'is_deleted or deleted_time is set' };
    const type = str(doc.segment_type);
    if (type && type !== 'contact') return { kind: 'exclude', code: 'NOT_CONTACT_SEGMENT', reason: `segment_type "${type}" is not a contact segment` };
    const name = str(doc.name);
    if (!name || name.length > 191) return { kind: 'quarantine', code: 'INVALID_NAME', reason: 'segment name is empty or longer than 191 characters' };
    let rules: Node;
    try {
      rules = convertTree(doc.filter_query, ctx);
    } catch (e) {
      if (e instanceof Unsupported) return { kind: 'quarantine', code: 'RULE_UNSUPPORTED', reason: e.message };
      throw e;
    }
    const t = times(doc, ctx.fallbackAt);
    const soft: Soft[] = [...t.soft];
    const owner = doc.created_by !== undefined && doc.created_by !== null ? ctx.ref('user', doc.created_by) : undefined;
    if (doc.mongodb_query !== undefined)
      soft.push({ code: 'MONGO_QUERY_DROPPED', reason: 'mongodb_query is the machine copy of filter_query and was not kept' });
    return {
      kind: 'rows',
      soft,
      rows: [
        {
          table: 'segments',
          sub: '',
          // a Waboo segment belongs to the workspace (no sharing setting): shared, so every member sees it
          row: { name, visibility: 'shared', owner_id: owner?.id ?? null, rules, rules_version: 1, created_at: t.created, updated_at: t.updated },
        },
      ],
    };
  },
};

export const savedViews: HandlerSpec = {
  handler: 'saved_views',
  collection: 'contact_saved_views',
  mapCollection: 'contact_saved_views',
  tables: {
    contact_views: {
      columns: [c('name', 'text'), c('filter', 'jsonb'), c('position', 'integer'), c('is_shared', 'boolean'), c('created_by', 'bigint'), ...TS_COLS],
      fp: ['name', 'filter', 'position', 'is_shared'],
      constants: { row_version: 1 },
    },
  },
  fields: {
    _id: 'id',
    id: 'id',
    viewId: 'drop:the id of the view inside Waboo (id_map keeps the document id)',
    name: 'col:name',
    type: 'a system view is excluded (WaDesk has My / Unassigned / All Contacts built in), a custom one is loaded',
    filter_query: 'col:filter.rules (the converted rule tree as JSON text)',
    contact_filter: 'drop:the key of a system view (my_contacts / all_contacts); null on a custom view',
    mongodb_query: 'drop:the machine copy of filter_query',
    position: 'col:position',
    access_type: 'drop:can_view / can_edit: WaDesk shares a view read-only or keeps it private; edit rights are not carried',
    shared_with: 'col:is_shared (everyone = shared, me = private to its creator)',
    created_by: 'col:created_by (the migrated user, when the id resolves)',
    updated_by: 'drop:last editor; contact_views has no such column',
    created_time: 'col:created_at',
    modified_time: 'col:updated_at',
    deleted_time: 'drop:soft-delete timestamp',
    is_deleted: 'drop:soft-delete flag; deleted views are excluded and counted',
    columns: 'drop:the columns a view shows: contact_views has no column for it (recorded in missing-in-wadesk-log.md)',
    is_favorite: 'drop:the favorite star of a view: contact_views has no such column (recorded in missing-in-wadesk-log.md)',
    user_list:
      'drop:the users a view is shared with one by one: WaDesk shares a view with everyone or keeps it private (shared_with = everyone / me)',
  },
  transform(doc: Doc, ctx: Ctx): Outcome {
    if (isDeleted(doc)) return { kind: 'exclude', code: 'SOFT_DELETED', reason: 'is_deleted or deleted_time is set' };
    if ((str(doc.type) ?? '').toLowerCase() === 'system')
      return { kind: 'exclude', code: 'SYSTEM_VIEW', reason: 'a system view exists natively in WaDesk (My, Unassigned and All Contacts)' };
    const name = str(doc.name);
    if (!name || name.length > 191) return { kind: 'quarantine', code: 'INVALID_NAME', reason: 'view name is empty or longer than 191 characters' };
    let filter: Record<string, unknown> = {};
    const fq = doc.filter_query as Doc | null | undefined;
    // a view with no rules shows every contact: that is a view with no filter, not an unsupported one
    const noRules = !!fq && Array.isArray(fq.rules) && fq.rules.length === 0 && fq.not !== true;
    if (!noRules && doc.filter_query !== undefined && doc.filter_query !== null) {
      try {
        const text = JSON.stringify(convertTree(doc.filter_query, ctx));
        if (text.length > 20_000) throw new Unsupported('the rule tree is longer than 20,000 characters');
        filter = { rules: text };
      } catch (e) {
        if (e instanceof Unsupported) return { kind: 'quarantine', code: 'RULE_UNSUPPORTED', reason: e.message };
        throw e;
      }
    }
    const t = times(doc, ctx.fallbackAt);
    const soft: Soft[] = [...t.soft];
    const owner = doc.created_by !== undefined && doc.created_by !== null ? ctx.ref('user', doc.created_by) : undefined;
    const sharedWith = (str(doc.shared_with) ?? '').toLowerCase();
    let isShared = sharedWith !== 'me';
    if (sharedWith !== 'everyone' && sharedWith !== 'me')
      soft.push({ code: 'SHARED_WITH_UNKNOWN', reason: 'shared_with is neither everyone nor me: the view is shared with everyone' });
    if (!isShared && !owner) {
      // a private view nobody owns would be invisible to everyone
      isShared = true;
      soft.push({ code: 'VIEW_OWNER_UNRESOLVED', reason: 'the private view has no migrated owner: it is shared so it stays visible' });
    }
    return {
      kind: 'rows',
      soft,
      rows: [
        {
          table: 'contact_views',
          sub: '',
          row: {
            name,
            filter,
            position: Math.max(0, Math.trunc(num(doc.position) ?? 0)),
            is_shared: isShared,
            created_by: owner?.id ?? null,
            created_at: t.created,
            updated_at: t.updated,
          },
        },
      ],
    };
  },
};
