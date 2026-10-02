import {
  customFieldKey,
  isCustomSegmentField,
  type ContactResponse,
  type SegmentCondition,
  type SegmentGroup,
  type SegmentNode,
} from '@crm/contracts';

/**
 * The meaning of every condition, written against a contact as the contacts API returns it (with `groups` and `tags`
 * expanded). Only the development stand-in uses it, but it is also the written-down semantics the screens rely on:
 * dates compare by calendar day (UTC), text ignores case, an empty value is null, '' or [].
 */

type Scalar = string | number | boolean | null;

const DAY_MS = 86_400_000;
const dayOf = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);

function fieldValue(c: ContactResponse, field: string): Scalar | string[] {
  if (isCustomSegmentField(field)) {
    const v = c.customFields[customFieldKey(field)];
    if (v === undefined || v === null) return null;
    if (Array.isArray(v)) return v.map(String);
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
    return null;
  }
  switch (field) {
    case 'name':
      return c.name;
    case 'email':
      return c.email;
    case 'phone':
      return c.phone;
    case 'source':
      return c.source;
    case 'leadScore':
      return c.leadScore;
    case 'lifecycleStage':
      return c.lifecycleStage;
    case 'status':
      return c.status;
    case 'owner':
      return c.ownerId;
    case 'tags':
      return (c.tags ?? []).map((t) => t.id);
    case 'groups':
      return (c.groups ?? []).map((g) => g.id);
    case 'unsubscribed':
      return c.isUnsubscribed;
    case 'imported':
      return c.source === 'import';
    case 'createdAt':
      return c.createdAt;
    case 'updatedAt':
      return c.updatedAt;
    case 'lastActivityAt':
      return c.lastActivityAt;
    case 'search':
      return [c.name, c.firstName, c.lastName, c.email, c.phone?.replace(/\D/g, '')].filter(Boolean).join(' ');
    default:
      return null;
  }
}

const isEmpty = (v: Scalar | string[]) => v === null || v === '' || (Array.isArray(v) && v.length === 0);
const text = (v: unknown) => String(v ?? '').toLowerCase();
const isDateField = (f: string) => f === 'createdAt' || f === 'updatedAt' || f === 'lastActivityAt';

function testCondition(c: ContactResponse, cond: SegmentCondition, now: number): boolean {
  const v = fieldValue(c, cond.field);
  const arg = cond.value;
  const date = isDateField(cond.field) || (typeof arg === 'string' && /^\d{4}-\d{2}-\d{2}/.test(arg));
  const cmp = (): number => {
    // dates by calendar day, numbers by value
    if (date && typeof arg === 'string') return dayOf(String(v)) - dayOf(arg);
    return Number(v) - Number(arg);
  };
  switch (cond.operator) {
    case 'is_empty':
      return isEmpty(v);
    case 'is_not_empty':
      return !isEmpty(v);
    case 'is_true':
      return v === true;
    case 'is_false':
      return v === false || v === null;
    case 'equals':
      if (isEmpty(v)) return false;
      return date ? cmp() === 0 : typeof arg === 'number' ? Number(v) === arg : text(v) === text(arg);
    case 'not_equals':
      return isEmpty(v) || text(v) !== text(arg);
    case 'contains':
      return text(v).includes(text(arg));
    case 'not_contains':
      return !text(v).includes(text(arg));
    case 'starts_with':
      return text(v).startsWith(text(arg));
    case 'matches':
      return text(arg)
        .split(/\s+/)
        .filter(Boolean)
        .every((w) => text(v).includes(w));
    case 'gt':
    case 'after':
      return !isEmpty(v) && cmp() > 0;
    case 'gte':
    case 'on_or_after':
      return !isEmpty(v) && cmp() >= 0;
    case 'lt':
    case 'before':
      return !isEmpty(v) && cmp() < 0;
    case 'lte':
    case 'on_or_before':
      return !isEmpty(v) && cmp() <= 0;
    case 'between': {
      const r = arg as { from: string | number; to: string | number };
      if (isEmpty(v) || !r || typeof r !== 'object') return false;
      if (typeof r.from === 'string') return dayOf(String(v)) >= dayOf(r.from) && dayOf(String(v)) <= dayOf(String(r.to));
      return Number(v) >= Number(r.from) && Number(v) <= Number(r.to);
    }
    case 'in':
      return Array.isArray(arg) && !isEmpty(v) && arg.map(text).includes(text(v));
    case 'not_in':
      return !Array.isArray(arg) || isEmpty(v) || !arg.map(text).includes(text(v));
    case 'has_any':
      return Array.isArray(arg) && Array.isArray(v) && arg.some((x) => v.includes(String(x)));
    case 'has_all':
      return Array.isArray(arg) && Array.isArray(v) && arg.every((x) => v.includes(String(x)));
    case 'has_none':
      return Array.isArray(arg) && (!Array.isArray(v) || !arg.some((x) => v.includes(String(x))));
    case 'in_last_days': {
      if (isEmpty(v)) return false;
      const t = Date.parse(String(v));
      return t <= now && t >= now - Number(arg) * DAY_MS;
    }
    case 'more_than_days_ago':
      return !isEmpty(v) && Date.parse(String(v)) < now - Number(arg) * DAY_MS;
  }
}

export function matches(c: ContactResponse, rules: SegmentGroup, now = Date.now()): boolean {
  const test = (n: SegmentNode): boolean =>
    n.type === 'group' ? matches(c, n, now) : testCondition(c, n, now);
  return rules.combinator === 'and' ? rules.children.every(test) : rules.children.some(test);
}

export const evaluate = (contacts: readonly ContactResponse[], rules: SegmentGroup, now = Date.now()) =>
  contacts.filter((c) => matches(c, rules, now));
