import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AGENT, Api, Inbox, startHarness, type Grant, type Harness, type Tenant } from './support';

/**
 * Conversation tags (TW-TIB1-036, 037): the workspace library (shared with contacts' tags), putting tags on threads, the list
 * filter and chips, bulk tag, and the permission and tenancy rules.
 */
process.env.CHANNEL_SIMULATOR_ENABLED = 'true';

let h: Harness;
let api: Api;
let inbox: Inbox;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  inbox = new Inbox(h, api);
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

const TAGGER: Grant[] = [...AGENT, ['inbox.conversation.tag', 'all']];

describe('conversation tags', () => {
  let t: Tenant;
  let other: Tenant;
  let ch: { id: string };
  let manager: { token: string; userId: number };
  let agent: { token: string; userId: number };
  let reader: { token: string; userId: number };
  let bulker: { token: string; userId: number };

  const library = (token: string) => api.as(token).get('/v2/inbox/tags');
  const createTag = (token: string, body: Record<string, unknown>) =>
    api.as(token).post('/v2/inbox/tags').send(body);
  const apply = (token: string, uuid: string, body: Record<string, unknown>) =>
    api.as(token).post(`/v2/inbox/conversations/${uuid}/tags`).send(body);
  const listIds = async (token: string, query = '') =>
    (
      (await api.as(token).get(`/v2/inbox/conversations?status=all${query}`)).body.data as Array<{
        id: string;
        labels: Array<{ id: string; name: string }>;
      }>
    ).map((r) => r.id);

  beforeAll(async () => {
    t = await api.signup('ilb');
    other = await api.signup('ilo');
    ch = await inbox.channel(t.admin);
    manager = await api.member(t, 'manager', [...TAGGER, ['inbox.tag.manage', 'all']]);
    agent = await api.member(t, 'agent', TAGGER);
    reader = await api.member(t, 'reader', AGENT);
    bulker = await api.member(t, 'bulker', [...TAGGER, ['inbox.conversation.bulk', 'all']]);
  });

  it('the library: create, case-insensitive duplicate, edit with the version, usage count, delete', async () => {
    const created = await createTag(manager.token, {
      name: 'VIP',
      color: '#5B3D8A',
      description: 'Big spenders',
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({
      name: 'VIP',
      color: '#5B3D8A',
      description: 'Big spenders',
      conversationCount: 0,
    });

    const dup = await createTag(manager.token, { name: 'vip' });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('CON_TAG_NAME_TAKEN');
    expect((await createTag(manager.token, { name: 'Bad', color: 'red;x' })).status).toBe(422);
    expect((await createTag(agent.token, { name: 'Nope' })).status).toBe(403);

    const edited = await api
      .as(manager.token)
      .patch(`/v2/inbox/tags/${created.body.id}`)
      .send({ rowVersion: created.body.rowVersion, name: 'VIP customer', description: null });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(edited.body).toMatchObject({ name: 'VIP customer', description: null });
    const stale = await api
      .as(manager.token)
      .patch(`/v2/inbox/tags/${created.body.id}`)
      .send({ rowVersion: created.body.rowVersion, color: '#000000' });
    expect(stale.status).toBe(409);

    const all = await library(reader.token);
    expect(all.status).toBe(200);
    expect(all.body.data.map((l: { name: string }) => l.name)).toContain('VIP customer');

    const del = await api.as(manager.token).delete(`/v2/inbox/tags/${created.body.id}`);
    expect(del.status).toBe(204);
    expect(
      (await library(reader.token)).body.data.map((l: { name: string }) => l.name),
    ).not.toContain('VIP customer');
    expect((await api.as(manager.token).delete(`/v2/inbox/tags/${created.body.id}`)).status).toBe(
      404,
    );
  });

  it('puts a tag on a thread: chips on the row, one timeline and outbox event, a repeat is a no-op, filter by tag', async () => {
    const tag = (await createTag(manager.token, { name: 'Refund' })).body;
    const a = await inbox.conversation(t, ch.id, {});
    const b = await inbox.conversation(t, ch.id, {});
    const v = await inbox.version(a.uuid);

    const res = await apply(agent.token, a.uuid, { tagId: tag.id });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.labels).toEqual([{ id: tag.id, name: 'Refund', color: tag.color }]);
    expect(res.body.rowVersion).toBeGreaterThan(v);

    const again = await apply(agent.token, a.uuid, { tagId: tag.id });
    expect(again.status).toBe(200);
    expect(again.body.rowVersion).toBe(res.body.rowVersion);

    const events = (await api.as(agent.token).get(`/v2/inbox/conversations/${a.uuid}/events`)).body
      .data as Array<{ type: string; payload: Record<string, unknown> }>;
    expect(events.filter((e) => e.type === 'tag_added')).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ tagId: tag.id, name: 'Refund' });
    expect(
      (await api.events(t.orgId, 'conversation.tag_added')).filter(
        (e) => e.conversationId === a.uuid,
      ),
    ).toHaveLength(1);

    expect(await listIds(agent.token, `&tags=${tag.id}`)).toEqual([a.uuid]);
    expect(await listIds(agent.token)).toEqual(expect.arrayContaining([a.uuid, b.uuid]));
    expect(
      (await api.as(agent.token).get(`/v2/inbox/conversations/${a.uuid}`)).body.labels,
    ).toHaveLength(1);
    expect(
      (await library(agent.token)).body.data.find((l: { id: string }) => l.id === tag.id)
        .conversationCount,
    ).toBe(1);

    const off = await api
      .as(agent.token)
      .delete(`/v2/inbox/conversations/${a.uuid}/tags/${tag.id}`);
    expect(off.status).toBe(200);
    expect(off.body.labels).toEqual([]);
    expect(await listIds(agent.token, `&tags=${tag.id}`)).toEqual([]);
    const offAgain = await api
      .as(agent.token)
      .delete(`/v2/inbox/conversations/${a.uuid}/tags/${tag.id}`);
    expect(offAgain.body.rowVersion).toBe(off.body.rowVersion);
  });

  it('naming a new tag creates it only for someone who manages tags; a name that exists is found ignoring case', async () => {
    const c = await inbox.conversation(t, ch.id, {});
    const denied = await apply(agent.token, c.uuid, { name: 'Brand new' });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('INBOX_LABEL_CREATE_FORBIDDEN');

    const made = await apply(manager.token, c.uuid, { name: 'Brand new' });
    expect(made.status, JSON.stringify(made.body)).toBe(200);
    expect(made.body.labels.map((l: { name: string }) => l.name)).toEqual(['Brand new']);

    const d = await inbox.conversation(t, ch.id, {});
    const found = await apply(agent.token, d.uuid, { name: 'BRAND NEW' });
    expect(found.status).toBe(200);
    expect(found.body.labels).toHaveLength(1);
    const tags = await h.owner.query(
      `SELECT count(*)::int AS n FROM tags WHERE org_id = $1 AND lower(name) = 'brand new'`,
      [t.orgId],
    );
    expect(tags.rows[0].n).toBe(1);
  });

  it('refuses without the tag right, for a tag of another workspace, and for a thread the caller cannot see', async () => {
    const tag = (await createTag(manager.token, { name: 'Scoped' })).body;
    const foreign = (await createTag(other.admin, { name: 'Elsewhere' })).body;
    const c = await inbox.conversation(t, ch.id, {});
    expect((await apply(reader.token, c.uuid, { tagId: tag.id })).status).toBe(403);
    const cross = await apply(agent.token, c.uuid, { tagId: foreign.id });
    expect(cross.status).toBe(404);
    expect(cross.body.code).toBe('INBOX_LABEL_NOT_FOUND');
    expect((await apply(agent.token, c.uuid, {})).status).toBe(422);
    expect((await apply(agent.token, c.uuid, { tagId: tag.id, name: 'x' })).status).toBe(422);

    const own = await api.member(t, 'ownonly', [
      ['inbox.conversation.read', 'own'],
      ['inbox.conversation.tag', 'all'],
    ]);
    const hidden = await inbox.conversation(t, ch.id, { assigneeUserId: agent.userId });
    expect((await apply(own.token, hidden.uuid, { tagId: tag.id })).status).toBe(404);
  });

  it('bulk: adds and removes a tag on many threads with per-row outcomes, and needs the tag right', async () => {
    const tag = (await createTag(manager.token, { name: 'Bulky' })).body;
    const a = await inbox.conversation(t, ch.id, {});
    const b = await inbox.conversation(t, ch.id, {});
    const bulk = (token: string, body: Record<string, unknown>) =>
      api.as(token).post('/v2/inbox/conversations/bulk').send(body);

    const add = await bulk(bulker.token, {
      ids: [a.uuid, b.uuid],
      action: { type: 'tag', mode: 'add', tagId: tag.id },
    });
    expect(add.status, JSON.stringify(add.body)).toBe(200);
    expect(add.body).toMatchObject({ done: 2, unchanged: 0, failed: 0 });
    const again = await bulk(bulker.token, {
      ids: [a.uuid, b.uuid],
      action: { type: 'tag', mode: 'add', tagId: tag.id },
    });
    expect(again.body).toMatchObject({ done: 0, unchanged: 2 });
    expect(await listIds(bulker.token, `&tags=${tag.id}`)).toHaveLength(2);

    const remove = await bulk(bulker.token, {
      ids: [a.uuid],
      action: { type: 'tag', mode: 'remove', tagId: tag.id },
    });
    expect(remove.body).toMatchObject({ done: 1 });
    expect(await listIds(bulker.token, `&tags=${tag.id}`)).toEqual([b.uuid]);

    const noTag = await api.member(t, 'bulkonly', [...AGENT, ['inbox.conversation.bulk', 'all']]);
    expect(
      (
        await bulk(noTag.token, {
          ids: [a.uuid],
          action: { type: 'tag', mode: 'add', tagId: tag.id },
        })
      ).status,
    ).toBe(403);
  });

  it('deleting a tag takes it off the threads that carried it', async () => {
    const tag = (await createTag(manager.token, { name: 'Temporary' })).body;
    const c = await inbox.conversation(t, ch.id, {});
    await apply(agent.token, c.uuid, { tagId: tag.id });
    expect((await api.as(manager.token).delete(`/v2/inbox/tags/${tag.id}`)).status).toBe(204);
    expect(
      (await api.as(agent.token).get(`/v2/inbox/conversations/${c.uuid}`)).body.labels,
    ).toEqual([]);
  });

  it('the original names keep working: /labels routes, ?labels=, and the bulk action type "label"', async () => {
    const made = await api.as(manager.token).post('/v2/inbox/labels').send({ name: 'Legacy name' });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const tag = made.body;
    expect(
      (await api.as(agent.token).get('/v2/inbox/labels')).body.data.some(
        (l: { id: string }) => l.id === tag.id,
      ),
    ).toBe(true);
    // The two paths are one library.
    expect(
      (await api.as(agent.token).get('/v2/inbox/tags')).body.data.some(
        (l: { id: string }) => l.id === tag.id,
      ),
    ).toBe(true);

    const a = await inbox.conversation(t, ch.id, {});
    const b = await inbox.conversation(t, ch.id, {});
    const onA = await api
      .as(agent.token)
      .post(`/v2/inbox/conversations/${a.uuid}/labels`)
      .send({ tagId: tag.id });
    expect(onA.status).toBe(200);
    expect(await listIds(agent.token, `&labels=${tag.id}`)).toEqual([a.uuid]);
    expect(await listIds(agent.token, `&tags=${tag.id}`)).toEqual([a.uuid]);

    const viaBulk = await api
      .as(bulker.token)
      .post('/v2/inbox/conversations/bulk')
      .send({ ids: [b.uuid], action: { type: 'label', mode: 'add', tagId: tag.id } });
    expect(viaBulk.body).toMatchObject({ done: 1 });
    const off = await api
      .as(agent.token)
      .delete(`/v2/inbox/conversations/${b.uuid}/labels/${tag.id}`);
    expect(off.status).toBe(200);
  });

  it('contact tags: the thread detail lists them, and tagScope=contact filters by the tags of the contact only', async () => {
    const tag = (await createTag(manager.token, { name: 'VIP contact' })).body;
    const [contactUuid] = await api.seedContacts(t, [{ name: 'Tagged Tara' }]);
    const contactId = Number(
      (await h.owner.query(`SELECT id FROM contacts WHERE uuid = $1`, [contactUuid])).rows[0].id,
    );
    const tagId = Number(
      (await h.owner.query(`SELECT id FROM tags WHERE uuid = $1`, [tag.id])).rows[0].id,
    );
    await h.owner.query(
      `INSERT INTO contact_tags (org_id, contact_id, tag_id) VALUES ($1, $2, $3)`,
      [t.orgId, contactId, tagId],
    );
    const withContact = await inbox.conversation(t, ch.id, { contactId });
    const withoutContact = await inbox.conversation(t, ch.id, {});
    // A conversation tag with the same id on another thread must not leak into the contact scope.
    await apply(agent.token, withoutContact.uuid, { tagId: tag.id });

    const detail = await api.as(t.admin).get(`/v2/inbox/conversations/${withContact.uuid}`);
    expect(detail.status, JSON.stringify(detail.body)).toBe(200);
    expect(detail.body.contactSummary.contactTags).toEqual([
      { id: tag.id, name: 'VIP contact', color: tag.color },
    ]);
    expect(detail.body.labels).toEqual([]);

    expect(await listIds(agent.token, `&tags=${tag.id}&tagScope=contact`)).toEqual([
      withContact.uuid,
    ]);
    expect(await listIds(agent.token, `&tags=${tag.id}`)).toEqual([withoutContact.uuid]);
    expect((await api.as(agent.token).get(`/v2/inbox/conversations?tagScope=other`)).status).toBe(
      422,
    );
  });
});
