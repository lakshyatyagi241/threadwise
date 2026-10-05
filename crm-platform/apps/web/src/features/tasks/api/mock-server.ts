import type { TaskBucket, TaskResponse } from '@crm/contracts';
import type { ApiRequest } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import { bucketOf } from '../lib/dates';
import { mockRefs, mockState } from './http';

/**
 * An in-memory stand-in for the tasks API, used only when the real endpoints are unreachable on purpose (see `http.ts`).
 * It answers in the wire format of `@crm/contracts` (tasks) on the routes the controller is expected to serve, and applies the
 * rules of the spec: status and `doneAt` agree, complete and reopen are idempotent, an assignee must be a member, a stale
 * `rowVersion` is a 409, bulk calls report each failure, buckets are cut from the due instant.
 */
type Priority = TaskResponse['priority'];
interface Row {
  id: string;
  title: string;
  notes: string | null;
  priority: Priority;
  dueAt: string | null;
  doneAt: string | null;
  assigneeId: string | null;
  contactId: string | null;
  dealId: string | null;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
}

const uid = () => crypto.randomUUID();
const HOUR = 3_600_000;
const MEMBERS = [
  { id: '00000000-0000-4000-8000-0000000000a1', fullName: 'Priya Nair' },
  { id: '00000000-0000-4000-8000-0000000000a2', fullName: 'Marco Bellini' },
  { id: '00000000-0000-4000-8000-0000000000a3', fullName: 'Layla Haddad' },
];
const CONTACTS = [
  { id: '00000000-0000-4000-8000-0000000000c1', name: 'Acme Industries' },
  { id: '00000000-0000-4000-8000-0000000000c2', name: 'Delta Corp' },
  { id: '00000000-0000-4000-8000-0000000000c3', name: 'Hassan Al-Farsi' },
];
const DEALS = [
  { id: '00000000-0000-4000-8000-0000000000d1', title: 'Enterprise plan renewal' },
  { id: '00000000-0000-4000-8000-0000000000d2', title: 'Warehouse pilot' },
];

let rows: Row[] | null = null;
let seededFor = '';

function seed(me: string): Row[] {
  const now = Date.now();
  const at = (h: number | null) => (h === null ? null : new Date(now + h * HOUR).toISOString());
  const mk = (
    title: string,
    priority: Priority,
    due: number | null,
    assigneeId: string | null,
    extra: Partial<Row> = {},
  ): Row => ({
    id: uid(),
    title,
    notes: null,
    priority,
    dueAt: at(due),
    doneAt: null,
    assigneeId,
    contactId: null,
    dealId: null,
    createdAt: new Date(now - 48 * HOUR).toISOString(),
    updatedAt: new Date(now - 24 * HOUR).toISOString(),
    rowVersion: 1,
    ...extra,
  });
  const out: Row[] = [
    mk('Call Acme about renewal', 'high', -26, me, {
      contactId: CONTACTS[0]!.id,
      dealId: DEALS[0]!.id,
      notes: 'Ask about the extra seats and the new billing contact.',
    }),
    mk('Send revised quote to Delta Corp', 'high', -3, me, { contactId: CONTACTS[1]!.id }),
    mk('Prepare demo deck', 'medium', 4, me),
    mk('Review onboarding checklist', 'low', 6, MEMBERS[0]!.id),
    mk('Follow up with Hassan after trial', 'medium', 52, me, {
      contactId: CONTACTS[2]!.id,
      dealId: DEALS[1]!.id,
    }),
    mk('Quarterly pipeline review', 'low', 150, MEMBERS[1]!.id),
    mk('Tidy contact tags', 'low', null, null),
    mk('Draft welcome message template', 'medium', null, me),
    mk('Send contract to Layla', 'high', -50, MEMBERS[2]!.id),
  ];
  for (let i = 1; i <= 40; i++) {
    const owners = [me, MEMBERS[0]!.id, MEMBERS[1]!.id, null];
    out.push(
      mk(
        `Follow-up ${i}`,
        (['low', 'medium', 'high'] as const)[i % 3]!,
        i % 7 === 0 ? null : (i % 9) * 11 - 20,
        owners[i % 4]!,
      ),
    );
  }
  for (const [i, title] of [
    'Update CRM notes',
    'Book venue for webinar',
    'Send invoice 1042',
  ].entries()) {
    out.push(
      mk(title, 'medium', -72 - i * 24, me, {
        doneAt: at(-60 - i * 20),
        contactId: i === 2 ? CONTACTS[1]!.id : null,
      }),
    );
  }
  return out;
}

function table(): Row[] {
  if (!rows || seededFor !== mockState.me.id) {
    rows = seed(mockState.me.id);
    seededFor = mockState.me.id;
  }
  return rows;
}

function person(id: string | null): { id: string; name: string } | null {
  if (!id) return null;
  if (id === mockState.me.id) return { id, name: mockState.me.name };
  const m = MEMBERS.find((x) => x.id === id);
  return m ? { id, name: m.fullName } : null;
}

const contactName = (id: string) =>
  CONTACTS.find((c) => c.id === id)?.name ?? mockRefs.get(`contact:${id}`) ?? null;
const dealTitle = (id: string) =>
  DEALS.find((d) => d.id === id)?.title ?? mockRefs.get(`deal:${id}`) ?? 'Deal';

function wire(r: Row): TaskResponse {
  const now = new Date();
  const status = r.doneAt ? 'done' : 'open';
  const bucket = bucketOf(r.dueAt, status, now);
  return {
    id: r.id,
    title: r.title,
    notes: r.notes,
    priority: r.priority,
    status,
    dueAt: r.dueAt,
    doneAt: r.doneAt,
    remindedAt: null,
    bucket,
    overdue: bucket === 'overdue',
    assignee: person(r.assigneeId),
    createdBy: person(mockState.me.id),
    contact: r.contactId ? { id: r.contactId, name: contactName(r.contactId) } : null,
    deal: r.dealId ? { id: r.dealId, title: dealTitle(r.dealId) } : null,
    company: null,
    source: 'manual',
    rowVersion: r.rowVersion,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

type Query = NonNullable<ApiRequest<unknown>['query']>;
const str = (q: Query, k: string) => (q[k] === undefined ? undefined : String(q[k]));

function filterRows(q: Query, forCounts: boolean, link?: { kind: string; id: string }): Row[] {
  const me = mockState.me.id;
  const term = str(q, 'q')?.toLowerCase();
  const prio = str(q, 'priority');
  return table().filter((r) => {
    if (term && !r.title.toLowerCase().includes(term)) return false;
    if (prio && r.priority !== prio) return false;
    if (str(q, 'mine') === 'true' && r.assigneeId !== me) return false;
    const a = str(q, 'assigneeId');
    if (a && r.assigneeId !== a) return false;
    if (str(q, 'unassigned') === 'true' && r.assigneeId) return false;
    const c = str(q, 'contactId');
    if (c && r.contactId !== c) return false;
    const d = str(q, 'dealId');
    if (d && r.dealId !== d) return false;
    if (link?.kind === 'contact' && r.contactId !== link.id) return false;
    if (link?.kind === 'deal' && r.dealId !== link.id) return false;
    if (forCounts) return true;
    const status = str(q, 'status') ?? 'open';
    if (status === 'open' && r.doneAt) return false;
    if (status === 'done' && !r.doneAt) return false;
    const due = str(q, 'due');
    if (due) {
      const b = bucketOf(r.dueAt, r.doneAt ? 'done' : 'open', new Date());
      const want: Record<string, TaskBucket> = {
        overdue: 'overdue',
        today: 'today',
        upcoming: 'upcoming',
        none: 'no_date',
      };
      if (b !== want[due]) return false;
    }
    return true;
  });
}

function sortRows(list: Row[], sort: string | undefined, status: string): Row[] {
  const how = sort ?? (status === 'done' ? 'completed' : 'due');
  const out = [...list];
  if (how === 'created') out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  else if (how === 'completed') out.sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''));
  else
    out.sort((a, b) =>
      a.dueAt && b.dueAt
        ? a.dueAt.localeCompare(b.dueAt)
        : a.dueAt
          ? -1
          : b.dueAt
            ? 1
            : a.title.localeCompare(b.title),
    );
  return out;
}

function memberCheck(id: string | null | undefined): void {
  if (id && !person(id))
    throw new ApiError(422, 'TASK_ASSIGNEE_INVALID', 'Assignee is not an active member');
}

function find(id: string): Row {
  const r = table().find((x) => x.id === id);
  if (!r) throw new ApiError(404, 'NOT_FOUND', 'Task not found');
  return r;
}

function touch(r: Row) {
  r.rowVersion += 1;
  r.updatedAt = new Date().toISOString();
}

function page(list: Row[], q: Query): unknown {
  const limit = Number(q.limit ?? 50);
  const from = q.cursor ? Number(atob(String(q.cursor))) : 0;
  const slice = list.slice(from, from + limit);
  const more = from + limit < list.length;
  return {
    data: slice.map(wire),
    page: { nextCursor: more ? btoa(String(from + limit)) : null, hasMore: more, limit },
  };
}

function counts(q: Query) {
  const open = filterRows(q, true).filter((r) => !r.doneAt);
  const now = new Date();
  const by = (b: TaskBucket) => open.filter((r) => bucketOf(r.dueAt, 'open', now) === b).length;
  const mine = table().filter((r) => !r.doneAt && r.assigneeId === mockState.me.id);
  return {
    overdue: by('overdue'),
    today: by('today'),
    upcoming: by('upcoming'),
    noDate: by('no_date'),
    open: open.length,
    done: filterRows(q, true).filter((r) => r.doneAt).length,
    mine: {
      open: mine.length,
      overdue: mine.filter((r) => bucketOf(r.dueAt, 'open', now) === 'overdue').length,
    },
  };
}

function applyBulk(ids: string[], fn: (r: Row) => void): unknown {
  const succeeded: string[] = [];
  const failed: Array<{ id: string; code: string; message: string }> = [];
  for (const id of ids) {
    const r = table().find((x) => x.id === id);
    if (!r) failed.push({ id, code: 'NOT_FOUND', message: 'Task not found' });
    else {
      fn(r);
      succeeded.push(id);
    }
  }
  return { succeeded, failed };
}

const delay = () => new Promise((r) => setTimeout(r, 120));

export async function mockCall<T>(path: string, req: ApiRequest<T>): Promise<T> {
  await delay();
  const method = req.method ?? 'GET';
  const q: Query = req.query ?? {};
  const body = (req.body ?? {}) as Record<string, unknown>;
  const out = (v: unknown): T => (req.schema ? req.schema.parse(v) : (undefined as T));

  if (path === '/users')
    return out({ data: [{ id: mockState.me.id, fullName: mockState.me.name }, ...MEMBERS] });

  const linked = /^\/(contacts|deals)\/([^/]+)\/tasks$/.exec(path);
  if (linked && method === 'GET') {
    const kind = linked[1] === 'contacts' ? 'contact' : 'deal';
    const list = filterRows(q, false, { kind, id: linked[2]! });
    return out(page(sortRows(list, str(q, 'sort'), str(q, 'status') ?? 'open'), q));
  }

  if (path === '/tasks' && method === 'GET') {
    const list = filterRows(q, false);
    return out(page(sortRows(list, str(q, 'sort'), str(q, 'status') ?? 'open'), q));
  }
  if (path === '/tasks/counts') return out(counts(q));
  if (path === '/tasks' && method === 'POST') {
    const title = String(body.title ?? '').trim();
    if (!title)
      throw new ApiError(422, 'VALIDATION_FAILED', 'Invalid', undefined, [
        { path: 'title', message: 'required' },
      ]);
    const assigneeId =
      body.assigneeId === undefined ? mockState.me.id : (body.assigneeId as string | null);
    memberCheck(assigneeId);
    const now = new Date().toISOString();
    const r: Row = {
      id: uid(),
      title,
      notes: (body.notes as string | null) ?? null,
      priority: (body.priority as Priority) ?? 'medium',
      dueAt: (body.dueAt as string | null) ?? null,
      doneAt: null,
      assigneeId,
      contactId: (body.contactId as string | null) ?? null,
      dealId: (body.dealId as string | null) ?? null,
      createdAt: now,
      updatedAt: now,
      rowVersion: 1,
    };
    table().push(r);
    return out(wire(r));
  }

  const bulk = /^\/tasks\/bulk\/(complete|reopen|assign|delete)$/.exec(path);
  if (bulk && method === 'POST') {
    const ids = (body.ids as string[]) ?? [];
    switch (bulk[1]) {
      case 'complete':
        return out(
          applyBulk(ids, (r) => {
            if (!r.doneAt) {
              r.doneAt = new Date().toISOString();
              touch(r);
            }
          }),
        );
      case 'reopen':
        return out(
          applyBulk(ids, (r) => {
            if (r.doneAt) {
              r.doneAt = null;
              touch(r);
            }
          }),
        );
      case 'assign': {
        memberCheck(body.assigneeId as string | null);
        return out(
          applyBulk(ids, (r) => {
            r.assigneeId = body.assigneeId as string | null;
            touch(r);
          }),
        );
      }
      default:
        return out(
          applyBulk(ids, (r) => {
            rows = table().filter((x) => x !== r);
          }),
        );
    }
  }

  const one = /^\/tasks\/([^/]+)(?:\/(complete|reopen))?$/.exec(path);
  if (one) {
    const r = find(one[1]!);
    if (method === 'GET') return out(wire(r));
    if (method === 'DELETE') {
      rows = table().filter((x) => x !== r);
      return undefined as T;
    }
    if (one[2] === 'complete') {
      if (!r.doneAt) {
        r.doneAt = new Date().toISOString();
        touch(r);
      }
      return out(wire(r));
    }
    if (one[2] === 'reopen') {
      if (r.doneAt) {
        r.doneAt = null;
        touch(r);
      }
      return out(wire(r));
    }
    if (method === 'PATCH') {
      if (body.rowVersion !== r.rowVersion)
        throw new ApiError(409, 'ROW_VERSION_CONFLICT', 'Changed by someone else');
      if ('title' in body) r.title = String(body.title);
      if ('notes' in body) r.notes = (body.notes as string | null) ?? null;
      if ('priority' in body) r.priority = body.priority as Priority;
      if ('dueAt' in body) r.dueAt = (body.dueAt as string | null) ?? null;
      if ('assigneeId' in body) {
        memberCheck(body.assigneeId as string | null);
        r.assigneeId = (body.assigneeId as string | null) ?? null;
      }
      if ('contactId' in body) r.contactId = (body.contactId as string | null) ?? null;
      if ('dealId' in body) r.dealId = (body.dealId as string | null) ?? null;
      touch(r);
      return out(wire(r));
    }
  }
  throw new ApiError(404, 'NOT_FOUND', 'No such route in the stand-in');
}
