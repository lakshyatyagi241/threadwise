import { expect } from 'vitest';
import type { Api, Tenant } from '../contacts-attributes-tags/support';

/**
 * The steps of the journeys in docs/quality/journeys/journeys.json (QA task 9). A journey is an ordered list of step ids; each
 * step is a small function over a shared context. Keep a step to one thing a person does or sees, so journeys can be
 * recombined without writing new code. `test/unit/journeys/catalogue.spec.ts` fails when this list and the JSON differ.
 */
export type Role = 'admin' | 'reader-all' | 'reader-own' | 'no-access';

export interface Ctx {
  api: Api;
  role: Role;
  /** The text variant: a name or title from the unicode fixtures. */
  text: string;
  t?: Tenant;
  /** Token of the person who is looking. */
  actor?: string;
  contactId?: string;
  tagId?: string;
  companyId?: string;
  taskId?: string;
}

export type StepFn = (c: Ctx) => Promise<void>;

let seq = 0;
const phone = () => `+9197${String(50000000 + ++seq).padStart(8, '0')}`;
/** The first three characters by code point: what a person types into the search box. */
const prefix = (text: string) => Array.from(text.trim()).slice(0, 3).join('');
const need = <T>(v: T | undefined, what: string): T => {
  if (v === undefined)
    throw new Error(`this step needs ${what}, which an earlier step should have set`);
  return v;
};
const ids = (body: { data?: Array<{ id: string }>; items?: Array<{ id: string }> }) =>
  (body.data ?? body.items ?? []).map((x) => x.id);

export const STEPS: Record<string, StepFn> = {
  'workspace.signup': async (c) => {
    c.t = await c.api.signup('journey');
    c.actor = c.t.admin;
  },

  'session.read': async (c) => {
    const t = need(c.t, 'a workspace');
    const res = await c.api.as(t.admin).get('/v2/auth/session');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.org.slug).toBe(t.slug);
  },

  'actor.choose': async (c) => {
    const t = need(c.t, 'a workspace');
    const grants = {
      'reader-all': [['record.contacts.read', 'all']],
      'reader-own': [['record.contacts.read', 'own']],
      'no-access': [],
    } as const;
    if (c.role === 'admin') c.actor = t.admin;
    else
      c.actor = (
        await c.api.member(t, c.role, grants[c.role] as unknown as Array<[string, 'all' | 'own']>)
      ).token;
  },

  'contact.create': async (c) => {
    const t = need(c.t, 'a workspace');
    const res = await c.api.as(t.admin).post('/v2/contacts').send({ name: c.text, phone: phone() });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.name).toBe(c.text.trim());
    c.contactId = res.body.id as string;
  },

  'contact.read-as-actor': async (c) => {
    const id = need(c.contactId, 'a contact');
    const res = await c.api.as(need(c.actor, 'an actor')).get(`/v2/contacts/${id}`);
    if (c.role === 'admin' || c.role === 'reader-all') {
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.name).toBe(c.text.trim());
    } else if (c.role === 'reader-own') {
      // The contact belongs to the admin, so a member who may only read their own does not see that it exists.
      expect([403, 404]).toContain(res.status);
    } else {
      expect(res.status).toBe(403);
    }
  },

  'contact.search-as-actor': async (c) => {
    const id = need(c.contactId, 'a contact');
    const res = await c.api
      .as(need(c.actor, 'an actor'))
      .get(`/v2/contacts?q=${encodeURIComponent(prefix(c.text))}&limit=100`);
    if (c.role === 'admin' || c.role === 'reader-all') {
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(ids(res.body)).toContain(id);
    } else if (c.role === 'reader-own') {
      expect(res.status).toBe(200);
      expect(ids(res.body)).not.toContain(id);
    } else {
      expect(res.status).toBe(403);
    }
  },

  'tag.create': async (c) => {
    const t = need(c.t, 'a workspace');
    const res = await c.api.as(t.admin).post('/v2/tags').send({ name: c.text });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    c.tagId = res.body.id as string;
  },

  'tag.attach': async (c) => {
    const t = need(c.t, 'a workspace');
    const res = await c.api
      .as(t.admin)
      .post(`/v2/contacts/${need(c.contactId, 'a contact')}/tags`)
      .send({ tagId: need(c.tagId, 'a tag') });
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
  },

  'tag.list-on-contact': async (c) => {
    const t = need(c.t, 'a workspace');
    const res = await c.api.as(t.admin).get(`/v2/contacts/${need(c.contactId, 'a contact')}/tags`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const rows = (res.body.data ?? res.body) as Array<{ id: string; name: string }>;
    const mine = rows.find((r) => r.id === c.tagId);
    expect(mine?.name).toBe(c.text.trim());
  },

  'company.create': async (c) => {
    const t = need(c.t, 'a workspace');
    const res = await c.api.as(t.admin).post('/v2/companies').send({ name: c.text });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    c.companyId = res.body.id as string;
  },

  'company.find': async (c) => {
    const t = need(c.t, 'a workspace');
    const res = await c.api
      .as(t.admin)
      .get(`/v2/companies?q=${encodeURIComponent(prefix(c.text))}&limit=100`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(ids(res.body)).toContain(need(c.companyId, 'a company'));
  },

  'task.create': async (c) => {
    const t = need(c.t, 'a workspace');
    const res = await c.api.as(t.admin).post('/v2/tasks').send({ title: c.text });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    c.taskId = res.body.id as string;
  },

  'task.find': async (c) => {
    const t = need(c.t, 'a workspace');
    const res = await c.api
      .as(t.admin)
      .get(`/v2/tasks?q=${encodeURIComponent(prefix(c.text))}&limit=100`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(ids(res.body)).toContain(need(c.taskId, 'a task'));
  },
};
