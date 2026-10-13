import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { WidgetApi, widgetBody, type Tenant } from '../chatbot-widget/support';
import { node, startFlowPipeline, until, type FlowPipeline } from './support';

/**
 * A published website chat bot answering a visitor, end to end: the editor API makes the bot and its widget, the visitor writes through
 * the public widget routes, the inbox's worker stores the line, the flow runtime answers, and the reply (with its buttons) comes back
 * through the history poll. Real Postgres, Redis and BullMQ.
 */
let p: FlowPipeline;
let api: WidgetApi;
let t: Tenant;

beforeAll(async () => {
  p = await startFlowPipeline();
  api = new WidgetApi(p.h);
  t = await api.signup('webbot');
}, 240_000);

afterAll(async () => {
  await p?.stop();
});

/** The editor's graph shape (the runtime specs' helper writes `vars` as an object and has no edge ids). */
const graph = (flowNodes: unknown[], flowEdges: unknown[]) => ({ flowNodes, flowEdges, vars: [] });
const edge = (source: string, target: string, sourceHandle = 'out') => ({
  id: `e_${source}_${sourceHandle}`,
  source,
  sourceHandle,
  target,
});

const look = () => {
  const {
    name: _n,
    mode: _m,
    targetWhatsappCc: _c,
    targetWhatsappNumber: _t,
    ...rest
  } = widgetBody();
  return rest;
};

interface Line {
  id: number;
  body: string | null;
  buttons?: Array<{ id: string; title: string }>;
  media?: { kind: string; name: string; url: string };
  input?: { type: string; format?: string; accept?: string[] };
  links?: Array<{ label: string; url: string }>;
  cards?: Array<{
    title: string;
    text: string;
    image?: string;
    buttons: Array<Record<string, unknown>>;
  }>;
}

/** A 1x1 PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** A website chat bot with its widget, published; returns the widget token. */
async function liveBot(
  name: string,
  flowGraph: unknown,
): Promise<{ flowId: string; token: string }> {
  const created = await api
    .as(t.admin)
    .post('/v2/flows')
    .send({ name, flowType: 'web', graph: flowGraph });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const flowId = created.body.id as string;
  const widget = await api.as(t.admin).put(`/v2/flows/${flowId}/widget`).send(look());
  expect(widget.status, JSON.stringify(widget.body)).toBe(200);
  const live = await api.as(t.admin).post(`/v2/flows/${flowId}/publish`).send({});
  expect(live.status, JSON.stringify(live.body)).toBe(200);
  return { flowId, token: widget.body.embedToken as string };
}

const trigger = () =>
  node('t', 'trigger', { kind: 'keyword', keywordMode: 'any' }, { isStart: true });

/** Every business line the visitor's poll has shown so far, once each. */
async function linesUntil(
  token: string,
  visitor: string,
  label: string,
  enough: (all: Line[]) => boolean,
): Promise<Line[]> {
  const seen = new Map<number, Line>();
  return until(
    label,
    async () => {
      const since = Math.max(0, ...seen.keys());
      const res = await api.pub(token).history(visitor, since);
      for (const m of (res.body.messages ?? []) as Line[]) seen.set(m.id, m);
      const all = [...seen.values()].sort((a, b) => a.id - b.id);
      return enough(all) ? all : undefined;
    },
    25_000,
  );
}

describe('a website chat bot answers its visitor', () => {
  it('starts on the first message, offers reply buttons, and routes the tap', async () => {
    const { token } = await liveBot(
      'Pricing bot',
      graph(
        [
          trigger(),
          node('b1', 'buttons', { prompt: 'Pick one', options: ['Docs', 'Price'] }),
          node('docs', 'message', { text: 'Docs are at example.test/docs' }),
          node('price', 'message', { text: 'Pro is 49' }),
        ],
        [edge('t', 'b1'), edge('b1', 'docs', 'p0'), edge('b1', 'price', 'p1')],
      ),
    );
    const visitor = await api.visitor(token);

    const sent = await api.pub(token).message({ body: 'hello there', visitor_uuid: visitor });
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    expect(sent.body.reply).toBeNull();

    const first = await linesUntil(token, visitor, 'the bot asks', (all) =>
      all.some((l) => l.buttons?.length === 2),
    );
    const ask = first.find((l) => l.buttons?.length === 2)!;
    expect(ask.body).toBe('Pick one');
    expect(ask.buttons!.map((b) => b.title)).toEqual(['Docs', 'Price']);

    // The visitor taps "Price": the body is the title, the id is the button's.
    const price = ask.buttons!.find((b) => b.title === 'Price')!;
    const tap = await api
      .pub(token)
      .message({ body: price.title, tap_id: price.id, visitor_uuid: visitor });
    expect(tap.status, JSON.stringify(tap.body)).toBe(200);
    const after = await linesUntil(token, visitor, 'the bot answers the tap', (all) =>
      all.some((l) => l.body === 'Pro is 49'),
    );
    expect(after.some((l) => l.body === 'Docs are at example.test/docs')).toBe(false);

    // The thread holds the visitor's two lines once each, as the customer's.
    const thread = await api.thread(t.orgId, visitor);
    const mine = thread.filter((m) => m.direction === 'in').map((m) => m.body);
    expect(mine).toEqual(['hello there', 'Price']);
  });

  it("keeps one bot out of another bot's widget", async () => {
    const a = await liveBot(
      'Bot A',
      graph([trigger(), node('m', 'message', { text: 'I am bot A' })], [edge('t', 'm')]),
    );
    const b = await liveBot(
      'Bot B',
      graph([trigger(), node('m', 'message', { text: 'I am bot B' })], [edge('t', 'm')]),
    );
    const va = await api.visitor(a.token);
    const vb = await api.visitor(b.token);

    await api.pub(a.token).message({ body: 'hi', visitor_uuid: va });
    await api.pub(b.token).message({ body: 'hi', visitor_uuid: vb });

    const linesA = await linesUntil(a.token, va, 'bot A answers', (all) => all.length > 0);
    const linesB = await linesUntil(b.token, vb, 'bot B answers', (all) => all.length > 0);
    expect(linesA.map((l) => l.body)).toEqual(['I am bot A']);
    expect(linesB.map((l) => l.body)).toEqual(['I am bot B']);
  });

  it('shows a file the bot sends, and only to the visitor it was sent to', async () => {
    const { ChatMediaStore } =
      await import('../../../src/infra/providers/chat-conversations/media');
    const stored = await p.h.app.get(ChatMediaStore, { strict: false }).store({
      orgId: t.orgId,
      filename: 'welcome.png',
      buffer: PNG,
    });
    const { token } = await liveBot(
      'Media bot',
      graph(
        [
          trigger(),
          node('m', 'media', {
            kind: 'image',
            url: `chatmedia:${stored.key}`,
            caption: 'Our menu',
          }),
          node('after', 'message', { text: 'Anything else?' }),
        ],
        [edge('t', 'm'), edge('m', 'after')],
      ),
    );
    const visitor = await api.visitor(token);
    const other = await api.visitor(token);

    await api.pub(token).message({ body: 'hi', visitor_uuid: visitor });
    const lines = await linesUntil(token, visitor, 'the bot sends the file', (all) =>
      all.some((l) => l.media),
    );
    const line = lines.find((l) => l.media)!;
    expect(line.media).toMatchObject({ kind: 'image', url: `api/media/${line.id}` });
    expect(line.body).toBe('Our menu');
    // The address never names the stored object.
    expect(JSON.stringify(line)).not.toContain(stored.key);

    const res = await request(p.h.app.getHttpServer())
      .get(`/widget/${token}/api/media/${line.id}?visitor_uuid=${visitor}`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect((res.body as Buffer).equals(PNG)).toBe(true);

    // Another visitor of the same widget, or no visitor at all, cannot read it.
    const asOther = await request(p.h.app.getHttpServer()).get(
      `/widget/${token}/api/media/${line.id}?visitor_uuid=${other}`,
    );
    expect(asOther.status).toBe(404);
    const anon = await request(p.h.app.getHttpServer()).get(
      `/widget/${token}/api/media/${line.id}`,
    );
    expect(anon.status).toBe(404);
  });

  it('tells the window what a question waits for, and keeps it on a wrong answer', async () => {
    const { token } = await liveBot(
      'Typed bot',
      graph(
        [
          trigger(),
          node('d', 'ask', {
            question: 'Your birth date?',
            validate: 'date',
            dateFormat: 'dd/mm/yyyy',
            var: 'dob',
          }),
          node('done', 'message', { text: 'Born on {{dob}}' }),
        ],
        [edge('t', 'd'), edge('d', 'done')],
      ),
    );
    const visitor = await api.visitor(token);
    await api.pub(token).message({ body: 'hi', visitor_uuid: visitor });
    const asked = await linesUntil(token, visitor, 'the bot asks the date', (all) =>
      all.some((l) => l.input?.type === 'date'),
    );
    expect(asked.find((l) => l.input)!.input).toEqual({ type: 'date', format: 'dd/mm/yyyy' });

    // A wrong answer is told so and the same input is kept.
    await api.pub(token).message({ body: 'tomorrow-ish', visitor_uuid: visitor });
    const retry = await linesUntil(
      token,
      visitor,
      'the bot says it is wrong',
      (all) => all.filter((l) => l.input?.type === 'date').length >= 2,
    );
    expect(retry.filter((l) => l.input?.type === 'date')).toHaveLength(2);

    await api.pub(token).message({ body: '04/05/1990', visitor_uuid: visitor });
    await linesUntil(token, visitor, 'the bot accepts it', (all) =>
      all.some((l) => l.body === 'Born on 04/05/1990'),
    );
  });

  it('takes a file the visitor attaches, and refuses what is not a file', async () => {
    const { token } = await liveBot(
      'File bot',
      graph(
        [
          trigger(),
          node('f', 'ask_file', { question: 'Send your ID', var: 'idfile', extensions: ['png'] }),
          node('done', 'message', { text: 'Got {{idfile_name}}' }),
        ],
        [edge('t', 'f'), edge('f', 'done')],
      ),
    );
    const visitor = await api.visitor(token);
    await api.pub(token).message({ body: 'hi', visitor_uuid: visitor });
    const asked = await linesUntil(token, visitor, 'the bot asks for the file', (all) =>
      all.some((l) => l.input?.type === 'file'),
    );
    expect(asked.find((l) => l.input)!.input).toEqual({ type: 'file', accept: ['png'] });

    const send = (content: Buffer, name: string, uuid = visitor) =>
      request(p.h.app.getHttpServer())
        .post(`/widget/${token}/api/upload?visitor_uuid=${uuid}`)
        .attach('file', content, name);
    // A script renamed to .png is refused by its content, not its name.
    const fake = await send(Buffer.from('<script>alert(1)</script>'), 'id.png');
    expect(fake.status).toBe(422);
    const empty = await send(Buffer.alloc(0), 'id.png');
    expect(empty.status).toBe(422);

    const ok = await send(PNG, 'my-id.png');
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    await linesUntil(token, visitor, 'the flow continues after the file', (all) =>
      all.some((l) => /^Got /.test(l.body ?? '')),
    );
    // The visitor's file is on their thread as the customer's, stored as an image under the media store's own key.
    const rows = await api.h.owner.query(
      `SELECT m.kind, m.media_key, m.media_name FROM messages m
         JOIN chatbot_widget_visitors v ON v.org_id = m.org_id AND v.conversation_id = m.conversation_id
        WHERE m.org_id = $1 AND v.visitor_uuid = $2 AND m.direction = 'in' AND m.media_key IS NOT NULL`,
      [t.orgId, visitor],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ kind: 'image', media_name: 'my-id.png' });
  });

  it('shows link, call and email buttons on a bot line, and drops any address a browser must not open', async () => {
    const { token } = await liveBot(
      'Links bot',
      graph(
        [
          trigger(),
          node('c', 'cta', {
            bodyText: 'Reach us any way you like',
            actions: [
              { type: 'url', label: 'Our site', value: 'https://example.test/hello' },
              { type: 'phone', label: 'Call us', value: '+91 98765 43210' },
              { type: 'email', label: 'Write to us', value: 'hello@example.test' },
            ],
          }),
          node('bad', 'cta', {
            bodyText: 'Careful now',
            actions: [
              { type: 'url', label: 'Script', value: 'javascript:alert(1)' },
              { type: 'url', label: 'Fine', value: 'https://example.test/ok' },
            ],
          }),
        ],
        [edge('t', 'c'), edge('c', 'bad')],
      ),
    );
    const visitor = await api.visitor(token);
    await api.pub(token).message({ body: 'hi', visitor_uuid: visitor });
    const lines = await linesUntil(
      token,
      visitor,
      'the bot sends its buttons',
      (all) => all.filter((l) => l.links?.length).length >= 2,
    );
    const [first, second] = lines.filter((l) => l.links?.length);
    expect(first!.body).toBe('Reach us any way you like');
    expect(first!.links).toEqual([
      { label: 'Our site', url: 'https://example.test/hello' },
      { label: 'Call us', url: 'tel:+919876543210' },
      { label: 'Write to us', url: 'mailto:hello@example.test' },
    ]);
    // A script address never reaches the window; the good button of the same step does.
    expect(second!.links).toEqual([{ label: 'Fine', url: 'https://example.test/ok' }]);
  });

  it('shows a small picture in front of a reply button and a link button, and drops a picture that is not an https address', async () => {
    const icon = 'https://example.test/widget-assets/f/bi0a1b2c3d?v=abc';
    const { token } = await liveBot(
      'Icons bot',
      graph(
        [
          trigger(),
          node('b1', 'buttons', {
            prompt: 'Pick one',
            options: ['Docs', 'Price', 'Talk'],
            optionIcons: [icon, 'javascript:alert(1)', ''],
          }),
          node('c', 'cta', {
            bodyText: 'Our site',
            actions: [
              { type: 'url', label: 'Open', value: 'https://example.test/', icon },
              {
                type: 'url',
                label: 'Bad icon',
                value: 'https://example.test/x',
                icon: 'data:image/png;base64,AAAA',
              },
            ],
          }),
        ],
        [edge('t', 'b1'), edge('b1', 'c', 'p0')],
      ),
    );
    const visitor = await api.visitor(token);
    await api.pub(token).message({ body: 'hi', visitor_uuid: visitor });
    const first = await linesUntil(token, visitor, 'the bot asks', (all) =>
      all.some((l) => l.buttons?.length === 3),
    );
    const ask = first.find((l) => l.buttons?.length === 3)!;
    expect(ask.buttons).toEqual([
      expect.objectContaining({ title: 'Docs', icon }),
      expect.not.objectContaining({ icon: expect.anything() }),
      expect.not.objectContaining({ icon: expect.anything() }),
    ]);
    const docs = ask.buttons!.find((b) => b.title === 'Docs')!;
    await api.pub(token).message({ body: 'Docs', tap_id: docs.id, visitor_uuid: visitor });
    const lines = await linesUntil(token, visitor, 'the link buttons arrive', (all) =>
      all.some((l) => l.links?.length),
    );
    const links = lines.find((l) => l.links?.length)!.links!;
    expect(links[0]).toEqual({ label: 'Open', url: 'https://example.test/', icon });
    expect(links[1]).toEqual({ label: 'Bad icon', url: 'https://example.test/x' });
  });

  it('starts the bot at the step a quick reply, menu entry or banner is tied to, and refuses a jump into another bot', async () => {
    const { token } = await liveBot(
      'Jump bot',
      graph(
        [
          trigger(),
          node('welcome', 'message', { text: 'Welcome to the bot' }),
          node('pricing', 'message', { text: 'Pricing details here' }),
        ],
        [edge('t', 'welcome')],
      ),
    );
    const visitor = await api.visitor(token);
    const cfg = await api.pub(token).config(visitor);
    const flowUuid = cfg.body.widget.flow_uuid as string;
    expect(flowUuid).toMatch(/^[0-9a-f-]{36}$/);

    // A tap tied to the "pricing" step starts the bot there: the welcome line is skipped.
    const tap = await api
      .pub(token)
      .message({ body: 'Pricing', tap_id: `go:${flowUuid}:pricing`, visitor_uuid: visitor });
    expect(tap.status, JSON.stringify(tap.body)).toBe(200);
    const lines = await linesUntil(token, visitor, 'the bot answers from the step', (all) =>
      all.some((l) => l.body === 'Pricing details here'),
    );
    expect(lines.some((l) => l.body === 'Welcome to the bot')).toBe(false);

    // A jump naming a bot that does not exist (or is not live here) starts nothing of its own.
    const other = await api.pub(token).message({
      body: 'Nowhere',
      tap_id: 'go:00000000-0000-0000-0000-000000000000:pricing',
      visitor_uuid: visitor,
    });
    expect(other.status).toBe(200);
  });

  it("shows a carousel of cards and routes a tap on a card button down that button's own exit", async () => {
    const { token } = await liveBot(
      'Carousel bot',
      graph(
        [
          trigger(),
          node('c', 'carousel', {
            text: 'Pick a centre',
            var: 'centre',
            cards: [
              {
                image: 'https://example.test/pune.png',
                title: 'Pune centre',
                text: 'Open 9 to 5',
                buttons: [
                  { type: 'reply', label: 'Book Pune' },
                  { type: 'url', label: 'Details', value: 'https://example.test/pune' },
                ],
              },
              {
                title: 'Mumbai centre',
                text: 'Open 10 to 6',
                buttons: [
                  { type: 'reply', label: 'Book Mumbai' },
                  { type: 'url', label: 'Bad link', value: 'javascript:alert(1)' },
                ],
              },
            ],
          }),
          node('pune', 'message', { text: 'Pune booked' }),
          node('mumbai', 'message', { text: 'Mumbai booked' }),
        ],
        [edge('t', 'c'), edge('c', 'pune', 'p0'), edge('c', 'mumbai', 'p1')],
      ),
    );
    const visitor = await api.visitor(token);
    await api.pub(token).message({ body: 'hi', visitor_uuid: visitor });
    const lines = await linesUntil(token, visitor, 'the bot sends its cards', (all) =>
      all.some((l) => l.cards?.length),
    );
    const line = lines.find((l) => l.cards?.length)!;
    expect(line.body).toBe('Pick a centre');
    expect(line.cards).toHaveLength(2);
    const [pune, mumbai] = line.cards!;
    expect(pune!.title).toBe('Pune centre');
    expect(pune!.image).toBe('https://example.test/pune.png');
    expect(pune!.buttons[0]).toMatchObject({ kind: 'reply', title: 'Book Pune' });
    expect(pune!.buttons[1]).toEqual({
      kind: 'link',
      label: 'Details',
      url: 'https://example.test/pune',
    });
    // The script address is dropped; the reply button of the same card stays.
    expect(mumbai!.buttons).toHaveLength(1);
    expect(mumbai!.buttons[0]).toMatchObject({ kind: 'reply', title: 'Book Mumbai' });

    const tap = async (b: { id: string; title: string }) =>
      api.pub(token).message({ body: b.title, tap_id: b.id, visitor_uuid: visitor });
    await tap(mumbai!.buttons[0] as { id: string; title: string });
    await linesUntil(token, visitor, 'the second card routes', (all) =>
      all.some((l) => l.body === 'Mumbai booked'),
    );
    // The cards stay tappable: the first card's button routes down its own exit too.
    await tap(pune!.buttons[0] as { id: string; title: string });
    await linesUntil(token, visitor, 'the first card routes', (all) =>
      all.some((l) => l.body === 'Pune booked'),
    );
  });

  it('branches on nested AND / OR rules of a condition, down its Yes or No exit', async () => {
    const { token } = await liveBot(
      'Condition bot',
      graph(
        [
          trigger(),
          node('q', 'ask', { prompt: 'Which plan?', var: 'plan' }),
          node('c', 'condition', {
            conditionGroup: {
              op: 'or',
              items: [
                { variable: 'plan', operator: 'equals', value: 'pro' },
                {
                  op: 'and',
                  items: [
                    { variable: 'plan', operator: 'contains', value: 'ent' },
                    { variable: 'plan', operator: 'contains', value: 'rise' },
                  ],
                },
              ],
            },
          }),
          node('yes', 'message', { text: 'Premium line' }),
          node('no', 'message', { text: 'Standard line' }),
        ],
        [edge('t', 'q'), edge('q', 'c'), edge('c', 'yes', 'yes'), edge('c', 'no', 'no')],
      ),
    );
    for (const [answer, expected] of [
      ['enterprise', 'Premium line'],
      ['basic', 'Standard line'],
    ] as const) {
      const visitor = await api.visitor(token);
      await api.pub(token).message({ body: 'hi', visitor_uuid: visitor });
      await linesUntil(token, visitor, 'the bot asks', (all) =>
        all.some((l) => l.body === 'Which plan?'),
      );
      await api.pub(token).message({ body: answer, visitor_uuid: visitor });
      const lines = await linesUntil(token, visitor, `the bot answers ${answer}`, (all) =>
        all.some((l) => l.body === 'Premium line' || l.body === 'Standard line'),
      );
      expect(lines.map((l) => l.body)).toContain(expected);
    }
  });

  it('hands the visitor to a person from a button: a carousel hand-over button and a quick reply, with no step wired after them', async () => {
    const team = String(
      (
        await p.h.owner.query(
          `INSERT INTO teams (org_id, name) VALUES ($1, 'Care team') RETURNING uuid`,
          [t.orgId],
        )
      ).rows[0].uuid,
    );
    const assigned = async (visitor: string) =>
      (
        await p.h.owner.query(
          `SELECT tm.uuid AS team FROM chatbot_widget_visitors v
             JOIN conversations c ON c.org_id = v.org_id AND c.id = v.conversation_id
             LEFT JOIN teams tm ON tm.org_id = c.org_id AND tm.id = c.assignee_team_id
            WHERE v.visitor_uuid = $1`,
          [visitor],
        )
      ).rows[0]?.team ?? null;

    const { token } = await liveBot(
      'Handover bot',
      graph(
        [
          trigger(),
          node('c', 'carousel', {
            text: 'How can we help?',
            cards: [
              {
                title: 'Billing',
                text: 'Invoices and payments',
                buttons: [
                  { type: 'agent', label: 'Talk to billing', team, note: 'Wants billing help' },
                ],
              },
            ],
          }),
        ],
        [edge('t', 'c')],
      ),
    );
    const visitor = await api.visitor(token);
    await api.pub(token).message({ body: 'hi', visitor_uuid: visitor });
    const lines = await linesUntil(token, visitor, 'the bot sends its cards', (all) =>
      all.some((l) => l.cards?.length),
    );
    const btn = lines.find((l) => l.cards?.length)!.cards![0]!.buttons[0] as {
      id: string;
      title: string;
    };
    expect(btn.title).toBe('Talk to billing');
    expect(await assigned(visitor)).toBeNull();
    await api.pub(token).message({ body: btn.title, tap_id: btn.id, visitor_uuid: visitor });
    await until(
      'the conversation reaches the team',
      async () => ((await assigned(visitor)) === team ? true : undefined),
      25_000,
    );

    // A quick reply flagged as a hand-over does the same.
    const q = await liveBot(
      'Handover buttons',
      graph(
        [
          trigger(),
          node('b', 'buttons', {
            prompt: 'Pick one',
            options: ['Pricing', 'Talk to a person'],
            handoffs: { '1': { team, message: 'Asked for a person' } },
          }),
          node('price', 'message', { text: 'Pro is 49' }),
        ],
        [edge('t', 'b'), edge('b', 'price', 'p0')],
      ),
    );
    const v2 = await api.visitor(q.token);
    await api.pub(q.token).message({ body: 'hi', visitor_uuid: v2 });
    const asked = await linesUntil(q.token, v2, 'the bot asks', (all) =>
      all.some((l) => l.buttons?.length === 2),
    );
    const person = asked
      .find((l) => l.buttons?.length === 2)!
      .buttons!.find((b) => b.title === 'Talk to a person')!;
    await api.pub(q.token).message({ body: person.title, tap_id: person.id, visitor_uuid: v2 });
    await until(
      'the second conversation reaches the team',
      async () => ((await assigned(v2)) === team ? true : undefined),
      25_000,
    );
  });

  it("keeps a visitor's thumbs up or down on a line the bot sent, only on their own thread", async () => {
    const { token } = await liveBot(
      'Feedback bot',
      graph([trigger(), node('m', 'message', { text: 'Rate me' })], [edge('t', 'm')]),
    );
    const visitor = await api.visitor(token);
    const stranger = await api.visitor(token);
    await api.pub(token).message({ body: 'hi', visitor_uuid: visitor });
    const lines = await linesUntil(token, visitor, 'the bot answers', (all) =>
      all.some((l) => l.body === 'Rate me'),
    );
    const line = lines.find((l) => l.body === 'Rate me')!;
    const mark = (uuid: string, value: 'up' | 'down' | null, id = line.id) =>
      request(p.h.app.getHttpServer())
        .post(`/widget/${token}/api/feedback?visitor_uuid=${uuid}`)
        .send({ message_id: id, value });
    const stored = async () =>
      (
        await p.h.owner.query(
          `SELECT m.meta->>'feedback' AS f FROM messages m
             JOIN chatbot_widget_visitors v ON v.org_id = m.org_id AND v.conversation_id = m.conversation_id
            WHERE m.org_id = $1 AND v.visitor_uuid = $2 AND m.id = $3`,
          [t.orgId, visitor, line.id],
        )
      ).rows[0]?.f ?? null;

    expect((await mark(visitor, 'up')).status).toBe(200);
    expect(await stored()).toBe('up');
    expect((await mark(visitor, 'down')).status).toBe(200);
    expect(await stored()).toBe('down');
    // Another visitor cannot mark it, and a made-up line is the same 404.
    expect((await mark(stranger, 'up')).status).toBe(404);
    expect(await stored()).toBe('down');
    expect((await mark(visitor, 'up', line.id + 100000)).status).toBe(404);
    expect((await mark(visitor, null)).status).toBe(200);
    expect(await stored()).toBeNull();
    // Anything but up, down or null is refused.
    const bad = await request(p.h.app.getHttpServer())
      .post(`/widget/${token}/api/feedback?visitor_uuid=${visitor}`)
      .send({ message_id: line.id, value: 'maybe' });
    expect(bad.status).toBe(422);
  });

  it('verifies a phone number with a one-time code: needs the country code, takes the right code, ends after three wrong tries', async () => {
    const { OTP_SENDER_PORT } =
      await import('../../../src/infra/providers/auth-registration-security/otp-sender.port');
    const sender = p.h.app.get(OTP_SENDER_PORT, { strict: false }) as {
      send: (i: { to: string; code: string; ttlMinutes: number }) => Promise<void>;
    };
    const sent: Array<{ to: string; code: string }> = [];
    const original = sender.send.bind(sender);
    sender.send = async (i) => {
      sent.push({ to: i.to, code: i.code });
    };
    try {
      const { token } = await liveBot(
        'Verify bot',
        graph(
          [
            trigger(),
            node('ph', 'ask', {
              prompt: 'Your phone?',
              validate: 'phone',
              verifyOtp: true,
              var: 'phone',
            }),
            node('ok', 'message', { text: 'Phone {{phone}} verified: {{phone_verified}}' }),
          ],
          [edge('t', 'ph'), edge('ph', 'ok')],
        ),
      );
      const say = async (visitor: string, body: string) =>
        api.pub(token).message({ body, visitor_uuid: visitor });

      // The right code.
      const v1 = await api.visitor(token);
      await say(v1, 'hi');
      await linesUntil(token, v1, 'the bot asks', (all) =>
        all.some((l) => l.body === 'Your phone?'),
      );
      await say(v1, '9876543210');
      await linesUntil(token, v1, 'it asks for the country code', (all) =>
        all.some((l) => /country code/i.test(l.body ?? '')),
      );
      expect(sent).toHaveLength(0);
      await say(v1, '+91 98765 43210');
      await linesUntil(token, v1, 'it sends a code', (all) =>
        all.some((l) => /We sent a code to \+919876543210/.test(l.body ?? '')),
      );
      expect(sent).toHaveLength(1);
      expect(sent[0]!.to).toBe('+919876543210');
      expect(sent[0]!.code).toMatch(/^\d{6}$/);
      await say(v1, sent[0]!.code === '000000' ? '111111' : '000000');
      await linesUntil(token, v1, 'a wrong code is refused', (all) =>
        all.some((l) => /not right/i.test(l.body ?? '')),
      );
      await say(v1, sent[0]!.code);
      const done = await linesUntil(token, v1, 'the right code passes', (all) =>
        all.some((l) => /verified/.test(l.body ?? '')),
      );
      expect(done.map((l) => l.body)).toContain('Phone +919876543210 verified: yes');

      // Three wrong tries: the run moves on, the number is not verified.
      const v2 = await api.visitor(token);
      await say(v2, 'hi');
      await linesUntil(token, v2, 'the bot asks', (all) =>
        all.some((l) => l.body === 'Your phone?'),
      );
      await say(v2, '+14155550123');
      await linesUntil(token, v2, 'it sends a code', (all) =>
        all.some((l) => /We sent a code/.test(l.body ?? '')),
      );
      const wrong = sent.at(-1)!.code === '000000' ? '111111' : '000000';
      for (let i = 0; i < 3; i++) await say(v2, wrong);
      const failed = await linesUntil(token, v2, 'three wrong tries end the question', (all) =>
        all.some((l) => /verified: no/.test(l.body ?? '')),
      );
      expect(failed.map((l) => l.body)).toContain('Phone  verified: no');
    } finally {
      sender.send = original;
    }
  });
});
