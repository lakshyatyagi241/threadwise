import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WidgetApi, startHarness, widgetBody, type Harness, type Tenant } from './support';

/**
 * The widget a website chat bot owns (the Customize and Install tabs): created by the first Customize save, one per bot,
 * only for a bot built for website chat, and kept out of the Chat widget list.
 */
let h: Harness;
let api: WidgetApi;
let t: Tenant;

const graph = () => ({
  flowNodes: [
    { id: 'n_trig', type: 'trigger', x: 0, y: 0, data: { kind: 'keyword', keywordMode: 'any' } },
    { id: 'n_msg', type: 'message', x: 300, y: 0, data: { text: 'hello' } },
  ],
  flowEdges: [{ id: 'e_1', source: 'n_trig', sourceHandle: 'out', target: 'n_msg' }],
  vars: [],
});

const look = (over: Record<string, unknown> = {}) => {
  const {
    name: _n,
    mode: _m,
    targetWhatsappCc: _c,
    targetWhatsappNumber: _t,
    ...rest
  } = widgetBody();
  return { ...rest, headerTitle: 'Ask Pricing Bot', ...over };
};

async function bot(flowType: string, name: string): Promise<string> {
  const res = await api.as(t.admin).post('/v2/flows').send({ name, flowType, graph: graph() });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
}

beforeAll(async () => {
  h = await startHarness();
  api = new WidgetApi(h);
  t = await api.signup('fwd');
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

describe('a website chat bot widget', () => {
  it('has no widget until Customize is saved once', async () => {
    const id = await bot('web', 'Fresh bot');
    const res = await api.as(t.admin).get(`/v2/flows/${id}/widget`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ widget: null });
  });

  it('the first save creates it named after the bot, linked and customized; a later save needs the row version', async () => {
    const id = await bot('web', 'Pricing bot');
    const first = await api.as(t.admin).put(`/v2/flows/${id}/widget`).send(look());
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body).toMatchObject({
      name: 'Pricing bot',
      flowId: id,
      headerTitle: 'Ask Pricing Bot',
      status: 'active',
    });
    expect(first.body.customizedAt).toEqual(expect.any(String));
    expect(first.body.embedToken).toEqual(expect.any(String));

    const read = await api.as(t.admin).get(`/v2/flows/${id}/widget`);
    expect(read.body.widget.id).toBe(first.body.id);

    const noVersion = await api.as(t.admin).put(`/v2/flows/${id}/widget`).send(look());
    expect(noVersion.status).toBe(409);

    const second = await api
      .as(t.admin)
      .put(`/v2/flows/${id}/widget`)
      .send(look({ headerTitle: 'Renamed', rowVersion: first.body.rowVersion }));
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect(second.body).toMatchObject({ id: first.body.id, headerTitle: 'Renamed' });
    expect(second.body.customizedAt).toBe(first.body.customizedAt);
    expect(second.body.embedToken).toBe(first.body.embedToken);

    const stale = await api
      .as(t.admin)
      .put(`/v2/flows/${id}/widget`)
      .send(look({ rowVersion: first.body.rowVersion }));
    expect(stale.status).toBe(409);
  });

  it('cannot be published until Customize has been saved once, then it can', async () => {
    const id = await bot('web', 'Needs a look');
    const early = await api.as(t.admin).post(`/v2/flows/${id}/publish`).send({});
    expect(early.status, JSON.stringify(early.body)).toBe(422);
    await api.as(t.admin).put(`/v2/flows/${id}/widget`).send(look());
    const live = await api.as(t.admin).post(`/v2/flows/${id}/publish`).send({});
    expect(live.status, JSON.stringify(live.body)).toBe(200);
    expect(live.body.isPublished).toBe(true);
  });

  it('does not hold back a WhatsApp bot', async () => {
    const id = await bot('chat', 'Plain bot');
    const live = await api.as(t.admin).post(`/v2/flows/${id}/publish`).send({});
    expect(live.status, JSON.stringify(live.body)).toBe(200);
  });

  it('lists the website bots for Settings > Channels > Web with one state word each, and leaves other channels out', async () => {
    const fresh = await bot('web', 'List: untouched');
    const drafted = await bot('web', 'List: draft');
    await api.as(t.admin).put(`/v2/flows/${drafted}/widget`).send(look());
    const live = await bot('web', 'List: live');
    await api.as(t.admin).put(`/v2/flows/${live}/widget`).send(look());
    await api.as(t.admin).post(`/v2/flows/${live}/publish`).send({});
    const wa = await bot('chat', 'List: whatsapp');

    const res = await api.as(t.admin).get('/v2/widgets/flow-bots');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const byId = new Map<string, { state: string; widget: unknown }>(
      res.body.data.map((b: { flowId: string; state: string; widget: unknown }) => [b.flowId, b]),
    );
    expect(byId.get(fresh)).toMatchObject({ state: 'needs_customizing', widget: null });
    expect(byId.get(drafted)).toMatchObject({ state: 'draft' });
    expect(byId.get(live)).toMatchObject({ state: 'live' });
    expect(byId.get(live)!.widget).toMatchObject({
      headerTitle: 'Ask Pricing Bot',
      status: 'active',
    });
    expect(byId.has(wa)).toBe(false);
    expect(res.body.total).toBeGreaterThanOrEqual(3);
  });

  it('shows a paused widget as paused, and keeps the list to people who can read flows', async () => {
    const id = await bot('web', 'List: paused');
    const w = await api.as(t.admin).put(`/v2/flows/${id}/widget`).send(look());
    await api.as(t.admin).post(`/v2/flows/${id}/publish`).send({});
    await api.setStatus(t.orgId, w.body.id, 'paused');
    const res = await api.as(t.admin).get('/v2/widgets/flow-bots');
    expect(res.body.data.find((b: { flowId: string }) => b.flowId === id)).toMatchObject({
      state: 'paused',
    });
    const none = await api.member(t, 'nolist', [['wgt.widgets.read']]);
    expect((await api.as(none.token).get('/v2/widgets/flow-bots')).status).toBe(403);
  });

  it('is refused for a bot built for another channel and for an unknown bot', async () => {
    const wa = await bot('chat', 'WhatsApp bot');
    expect((await api.as(t.admin).get(`/v2/flows/${wa}/widget`)).status).toBe(422);
    expect((await api.as(t.admin).put(`/v2/flows/${wa}/widget`).send(look())).status).toBe(422);
    const missing = '00000000-0000-4000-8000-000000000000';
    expect((await api.as(t.admin).get(`/v2/flows/${missing}/widget`)).status).toBe(404);
  });

  it('stays out of the Chat widget list and its numbers', async () => {
    const before = await api.as(t.admin).get('/v2/widgets');
    const id = await bot('web', 'Hidden from list');
    await api.as(t.admin).put(`/v2/flows/${id}/widget`).send(look());
    const after = await api.as(t.admin).get('/v2/widgets');
    expect(after.body.data).toHaveLength(before.body.data.length);
    expect(after.body.stats.total).toBe(before.body.stats.total);
  });

  it('is deleted with its bot', async () => {
    const id = await bot('web', 'Short lived');
    const w = await api.as(t.admin).put(`/v2/flows/${id}/widget`).send(look());
    const del = await api.as(t.admin).delete(`/v2/flows/${id}`);
    expect([200, 204]).toContain(del.status);
    const rows = await h.owner.query('SELECT 1 FROM chatbot_widgets WHERE uuid = $1', [w.body.id]);
    expect(rows.rowCount).toBe(0);
  });

  it('needs the flow keys: a member who cannot read flows gets 403', async () => {
    const id = await bot('web', 'Keys');
    const none = await api.member(t, 'noflows', [['wgt.widgets.read']]);
    expect((await api.as(none.token).get(`/v2/flows/${id}/widget`)).status).toBe(403);
    expect((await api.as(none.token).put(`/v2/flows/${id}/widget`).send(look())).status).toBe(403);
  });
});
