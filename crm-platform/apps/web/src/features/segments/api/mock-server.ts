import {
  bulkSelectionResultSchema,
  contactFilterToRules,
  contactResponseSchema,
  pageResponseSchema,
  type ContactResponse,
  type SegmentFilterInput,
} from '@crm/contracts';
import { apiFetch, type ApiRequest } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import { evaluate } from './mock-evaluate';
import type { Segment, SegmentRules } from './schemas';

/**
 * Development stand-in for the segments endpoints (see `http.ts`). Segments live in this browser's localStorage; the
 * rules are evaluated over the workspace's real contacts (the first 1000), fetched through the real contacts API, so
 * the preview and the members show real people. Anything that is not a segments route is passed to the real API.
 */

const STORE = 'segments:mock:data';
const ME = { id: '00000000-0000-4000-8000-000000000001', name: 'You' };
const contactsPage = pageResponseSchema(contactResponseSchema);

let cache: { at: number; rows: ContactResponse[] } | null = null;

async function contacts(): Promise<ContactResponse[]> {
  if (cache && Date.now() - cache.at < 30_000) return cache.rows;
  const rows: ContactResponse[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 5; i++) {
    const page = await apiFetch('/contacts', {
      query: { limit: 200, expand: 'groups,tags', cursor },
      schema: contactsPage,
    });
    rows.push(...page.data);
    if (!page.page.hasMore || !page.page.nextCursor) break;
    cursor = page.page.nextCursor;
  }
  cache = { at: Date.now(), rows };
  return rows;
}

function load(): Segment[] {
  try {
    return JSON.parse(window.localStorage.getItem(STORE) ?? '[]') as Segment[];
  } catch {
    return [];
  }
}
const save = (rows: Segment[]) => window.localStorage.setItem(STORE, JSON.stringify(rows));

const problem = (
  status: number,
  code: string,
  message: string,
  errors: Array<{ path: string; message: string }> = [],
) => new ApiError(status, code, message, 'mock-request', errors);

function check(body: Record<string, unknown>, rows: Segment[], selfId?: string) {
  const errors: Array<{ path: string; message: string }> = [];
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) errors.push({ path: 'name', message: 'name is required' });
  const rules = body.rules as SegmentRules | undefined;
  if (!rules || !Array.isArray(rules.children) || rules.children.length === 0) {
    errors.push({ path: 'rules', message: 'add at least one condition' });
  }
  if (errors.length) throw problem(422, 'VALIDATION_FAILED', 'invalid', errors);
  if (rows.some((s) => s.id !== selfId && s.name.toLowerCase() === name.toLowerCase())) {
    throw problem(409, 'SEG_NAME_TAKEN', 'name taken');
  }
}

async function counted(rules: SegmentRules): Promise<number> {
  return evaluate(await contacts(), rules).length;
}

function csv(rows: ContactResponse[]): Blob {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['name', 'email', 'phone', 'stage', 'status'].join(',')];
  for (const c of rows) lines.push([c.name, c.email, c.phone, c.lifecycleStage, c.status].map(esc).join(','));
  return new Blob([String.fromCharCode(0xfeff), lines.join('\n')], { type: 'text/csv' });
}

export async function mockExport(id: string): Promise<{ blob: Blob; filename: string }> {
  const seg = load().find((s) => s.id === id);
  if (!seg) throw problem(404, 'NOT_FOUND', 'not found');
  return { blob: csv(evaluate(await contacts(), seg.rules)), filename: `segment-${id.slice(0, 8)}.csv` };
}

async function create(body: Record<string, unknown>, rules: SegmentRules, rows: Segment[]): Promise<Segment> {
  const now = new Date().toISOString();
  const seg: Segment = {
    id: crypto.randomUUID(),
    name: String(body.name).trim(),
    description: (body.description as string | null | undefined) ?? null,
    color: (body.color as string | null | undefined) ?? null,
    visibility: body.visibility === 'shared' ? 'shared' : 'private',
    ownerId: ME.id,
    ownerName: ME.name,
    rules,
    rulesVersion: 1,
    memberCount: await counted(rules),
    countApproximate: false,
    memberCountAt: now,
    invalidConditions: [],
    canEdit: true,
    rowVersion: 1,
    createdAt: now,
    updatedAt: now,
  };
  save([seg, ...rows]);
  return seg;
}

export async function mockCall<T>(path: string, req: ApiRequest<T> = {}): Promise<T> {
  const method = req.method ?? 'GET';
  const body = (req.body ?? {}) as Record<string, unknown>;
  const reply = (value: unknown): T => (req.schema ? req.schema.parse(value) : (undefined as T));

  if (!path.startsWith('/segments')) return apiFetch(path, req);
  const rows = load();

  if (path === '/segments' && method === 'GET') {
    return reply({ data: rows, page: { nextCursor: null, hasMore: false, limit: 200 } });
  }
  if (path === '/segments' && method === 'POST') {
    check(body, rows);
    return reply(await create(body, body.rules as SegmentRules, rows));
  }
  if (path === '/segments/preview' && method === 'POST') {
    const hit = evaluate(await contacts(), body.rules as SegmentRules);
    return reply({ count: hit.length, countApproximate: false, sample: hit.slice(0, 10), invalidConditions: [] });
  }
  if (path === '/segments/from-filters' && method === 'POST') {
    const rules = contactFilterToRules((body.filter ?? {}) as SegmentFilterInput);
    if (!rules) throw problem(422, 'VALIDATION_FAILED', 'invalid', [{ path: 'filter', message: 'no conditions' }]);
    check({ ...body, rules }, rows);
    return reply(await create(body, rules, rows));
  }

  const m = /^\/segments\/([^/]+)(?:\/(.+))?$/.exec(path);
  const seg = m ? rows.find((s) => s.id === m[1]) : undefined;
  if (!m || !seg) throw problem(404, 'NOT_FOUND', 'segment not found');
  const sub = m[2];

  if (!sub && method === 'GET') return reply(seg);
  if (!sub && method === 'PATCH') {
    if (body.rowVersion !== seg.rowVersion) throw problem(409, 'ROW_VERSION_CONFLICT', 'changed meanwhile');
    check(body, rows, seg.id);
    const rules = body.rules as SegmentRules;
    const next: Segment = {
      ...seg,
      name: String(body.name).trim(),
      description: (body.description as string | null | undefined) ?? null,
      color: (body.color as string | null | undefined) ?? null,
      visibility: body.visibility === 'shared' ? 'shared' : 'private',
      rules,
      memberCount: await counted(rules),
      memberCountAt: new Date().toISOString(),
      rowVersion: seg.rowVersion + 1,
      updatedAt: new Date().toISOString(),
    };
    save(rows.map((s) => (s.id === seg.id ? next : s)));
    return reply(next);
  }
  if (!sub && method === 'DELETE') {
    save(rows.filter((s) => s.id !== seg.id));
    return undefined as T;
  }
  if (sub === 'refresh-count' && method === 'POST') {
    const memberCount = await counted(seg.rules);
    const now = new Date().toISOString();
    save(rows.map((s) => (s.id === seg.id ? { ...s, memberCount, memberCountAt: now } : s)));
    return reply({ memberCount, countApproximate: false, memberCountAt: now });
  }
  if (sub === 'contacts' && method === 'GET') {
    const all = evaluate(await contacts(), seg.rules);
    const limit = Number(req.query?.limit ?? 25);
    const from = req.query?.cursor ? Number(String(req.query.cursor).slice(2)) : 0;
    const more = from + limit < all.length;
    return reply({
      data: all.slice(from, from + limit),
      page: { nextCursor: more ? `o:${from + limit}` : null, hasMore: more, limit },
      meta: { total: all.length },
    });
  }
  if ((sub === 'tag' || sub === 'add-to-group') && method === 'POST') {
    const ids = evaluate(await contacts(), seg.rules).map((c) => c.id);
    const real = await apiFetch(sub === 'tag' ? '/contacts/bulk/tag' : '/contacts/bulk/group', {
      method: 'POST',
      body: sub === 'tag' ? { ids, action: 'add', ...body } : { ids, action: 'add', groupId: body.groupId },
      schema: bulkSelectionResultSchema,
    });
    cache = null;
    return reply({ matched: real.matched, changed: real.changed, queued: false });
  }
  throw problem(404, 'NOT_FOUND', 'no such route');
}
