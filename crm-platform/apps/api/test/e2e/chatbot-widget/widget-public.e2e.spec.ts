import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  WidgetApi,
  startAiStub,
  startHarness,
  uuidRe,
  type AiStub,
  type Harness,
  type Tenant,
  type WidgetJson,
} from './support';

/**
 * The visitor side of the chatbot widget end to end through HTTP (WD-WGT-008 to 020, 022): the loader script and chat page,
 * the config, the message, the history poll, the allow-list and the throttle. The AI vendor is a local stub that records
 * what it was asked, so the prompt is tested as it travels.
 */
let h: Harness;
let api: WidgetApi;
let ai: AiStub;
let t: Tenant;

beforeAll(async () => {
  ai = await startAiStub();
  process.env.WGT_AI_OPENAI_API_KEY = 'sk-test';
  process.env.WGT_AI_OPENAI_BASE_URL = ai.url;
  h = await startHarness();
  api = new WidgetApi(h);
  t = await api.signup('wgpub');
}, 240_000);

afterAll(async () => {
  await h?.stop();
  await ai?.stop();
  delete process.env.WGT_AI_OPENAI_API_KEY;
  delete process.env.WGT_AI_OPENAI_BASE_URL;
});

const aiWidget = async (over: Record<string, unknown> = {}, assistant = {}) => {
  const a = await api.assistant(t, assistant);
  const w = await api.widget(t.admin, {
    name: 'AI widget',
    mode: 'ai',
    assistantId: a.uuid,
    ...over,
  });
  return { w, a };
};

describe('loader script (WD-WGT-008)', () => {
  let w: WidgetJson;
  beforeAll(async () => {
    w = await api.widget(t.admin, {
      name: 'Loader',
      autoOpen: true,
      position: 'bottom_left',
      buttonColor: '#112233',
    });
  });

  it('WD-WGT-008 #5: it is JavaScript, never cached without revalidation, and the .js alias answers the same', async () => {
    const res = await api.pub(w.embedToken).embed();
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/javascript/);
    expect(res.headers['cache-control']).toBe('no-cache, must-revalidate');
    const alias = await api.pub(w.embedToken).embed('embed.js');
    expect(alias.status).toBe(200);
    // Each supertest call binds its own port, and the chat address follows the host it was asked on.
    const norm = (js: string) => js.replace(/127\.0\.0\.1:\d+/g, 'HOST');
    expect(norm(alias.text)).toBe(norm(res.text));
  });

  it('WD-WGT-008 #1/#3: the script carries the placement, colour and auto-open of the widget and points at its chat page', async () => {
    const res = await api.pub(w.embedToken).embed();
    expect(res.text).toContain('"left"');
    expect(res.text).toContain('#112233');
    expect(res.text).toContain('setTimeout(toggle, 1200)');
    expect(res.text).toContain(`/widget/${w.embedToken}/chat`);
  });

  it('WD-WGT-008 #2: an unknown token is a 404 that is still typed JavaScript, with a comment', async () => {
    const res = await api.pub('x'.repeat(48)).embed();
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/^application\/javascript/);
    expect(res.text).toContain('// chatbot widget not found or paused');
  });

  it('WD-WGT-022 #1: a token of the wrong shape never reaches the lookup (404)', async () => {
    expect((await api.pub('short').embed()).status).toBe(404);
    expect((await api.pub('a'.repeat(81)).chat()).status).toBe(404);
  });
});

describe('chat page (WD-WGT-009, 022)', () => {
  it('WD-WGT-009 #1 / WD-WGT-022 #4: it is an HTML document that can be framed from any site', async () => {
    const w = await api.widget(t.admin, { name: 'Framed <i>page</i>' });
    const res = await api.pub(w.embedToken).chat();
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/html/);
    expect(res.headers['x-frame-options']).toBeUndefined();
    expect(res.headers['content-security-policy']).toBeUndefined();
    expect(res.text).toContain('<title>Framed &lt;i&gt;page&lt;/i&gt;</title>');
    expect(res.text).toContain(`/widget/' + TOKEN + '/api/`);
  });

  it('WD-WGT-009 #4: an unknown token is a plain-text 404 "Widget not found"', async () => {
    const res = await api.pub('y'.repeat(48)).chat();
    expect(res.status).toBe(404);
    expect(res.text).toBe('Widget not found');
  });
});

describe('config and the visitor (WD-WGT-010, 011, 012, 013)', () => {
  it('WD-WGT-010 #1: a first call creates one visitor row, returns its uuid and sets the visitor cookie', async () => {
    const w = await api.widget(t.admin, { name: 'Config 1' });
    const res = await api
      .pub(w.embedToken)
      .config(undefined, {
        referer: 'https://customer.example/pricing',
        'user-agent': 'UnitBrowser/1',
      });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.visitor.uuid).toMatch(uuidRe);
    expect(res.body.visitor).toMatchObject({ name: null, email: null, phone: null });
    expect(res.body.transcript).toEqual([]);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toContain(`wgt_vid_${w.id}=${res.body.visitor.uuid}`);
    expect(cookie).toMatch(/Max-Age=31536000/);
    const row = await h.owner.query(
      `SELECT first_seen_at, last_seen_at, ip, referrer_url, user_agent FROM chatbot_widget_visitors WHERE org_id = $1 AND visitor_uuid = $2`,
      [t.orgId, res.body.visitor.uuid],
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].first_seen_at).toBeTruthy();
    expect(row.rows[0].ip).toBeTruthy();
    expect(row.rows[0].referrer_url).toBe('https://customer.example/pricing');
    expect(row.rows[0].user_agent).toBe('UnitBrowser/1');
  });

  it('WD-WGT-010 #2 / WD-WGT-011 #2: the same uuid again reuses the row, sets no cookie and moves last_seen_at on', async () => {
    const w = await api.widget(t.admin, { name: 'Config 2' });
    const first = await api.pub(w.embedToken).config();
    const uuid = first.body.visitor.uuid as string;
    const seen1 = await h.owner.query(
      `SELECT last_seen_at FROM chatbot_widget_visitors WHERE org_id = $1 AND visitor_uuid = $2`,
      [t.orgId, uuid],
    );
    await new Promise((r) => setTimeout(r, 20));
    const again = await api.pub(w.embedToken).config(uuid);
    expect(again.body.visitor.uuid).toBe(uuid);
    expect(again.headers['set-cookie']).toBeUndefined();
    expect(
      await api.count(
        `SELECT count(*)::int AS n FROM chatbot_widget_visitors WHERE org_id = $1 AND widget_id = (SELECT id FROM chatbot_widgets WHERE uuid = $2)`,
        [t.orgId, w.id],
      ),
    ).toBe(1);
    const seen2 = await h.owner.query(
      `SELECT last_seen_at FROM chatbot_widget_visitors WHERE org_id = $1 AND visitor_uuid = $2`,
      [t.orgId, uuid],
    );
    expect(new Date(seen2.rows[0].last_seen_at).getTime()).toBeGreaterThan(
      new Date(seen1.rows[0].last_seen_at).getTime(),
    );
  });

  it('WD-WGT-011 rule 1: the cookie works as well as the query value, and the header as a third way', async () => {
    const w = await api.widget(t.admin, { name: 'Config 3' });
    const uuid = (await api.pub(w.embedToken).config()).body.visitor.uuid as string;
    const byCookie = await api
      .pub(w.embedToken)
      .config(undefined, { cookie: `other=1; wgt_vid_${w.id}=${uuid}` });
    expect(byCookie.body.visitor.uuid).toBe(uuid);
    const byHeader = await api.pub(w.embedToken).config(undefined, { 'x-visitor-uuid': uuid });
    expect(byHeader.body.visitor.uuid).toBe(uuid);
  });

  it("WD-WGT-011 #3: a uuid issued by widget A is never honoured by widget B, and A's conversation stays hidden", async () => {
    const a = await api.widget(t.admin, { name: 'Replay A' });
    const b = await api.widget(t.admin, { name: 'Replay B' });
    const uuid = await api.visitor(a.embedToken);
    await api.pub(a.embedToken).message({ body: 'secret of A', visitor_uuid: uuid });
    const replay = await api.pub(b.embedToken).config(uuid);
    expect(replay.body.visitor.uuid).not.toBe(uuid);
    expect(replay.body.transcript).toEqual([]);
    expect(String(replay.headers['set-cookie'])).toContain(`wgt_vid_${b.id}=`);
  });

  it('WD-WGT-011 #4: two widgets on one site give one browser two independent visitor rows', async () => {
    const a = await api.widget(t.admin, { name: 'Twin A' });
    const b = await api.widget(t.admin, { name: 'Twin B' });
    const ua = await api.visitor(a.embedToken);
    const ub = await api.visitor(b.embedToken);
    expect(ua).not.toBe(ub);
  });

  it('WD-WGT-011 rule 5: a uuid the server never issued is not adopted; a fresh one is returned', async () => {
    const w = await api.widget(t.admin, { name: 'Config 4' });
    const made = crypto.randomUUID();
    const res = await api.pub(w.embedToken).config(made);
    expect(res.body.visitor.uuid).not.toBe(made);
    const junk = await api.pub(w.embedToken).config("'; DROP TABLE chatbot_widgets; --");
    expect(junk.status).toBe(200);
    expect(junk.body.visitor.uuid).toMatch(uuidRe);
  });

  it('WD-WGT-010: the config carries the appearance the iframe paints, and none of the secrets', async () => {
    const w = await api.widget(t.admin, {
      name: 'Look',
      headerBg: '#112233',
      headerTextColor: '#FFFFFF',
      headerTitle: 'Talk to us',
      bodyBgKind: 'image',
      bodyBgImageUrl: 'https://cdn.example/bg.png',
      buttonLabel: 'Ask',
      actionButtonBg: '#010203',
      actionButtonTextColor: '#EEEEEE',
      messageBubbleColor: '#F0F0F0',
      messageTextColor: '#111111',
      collectName: true,
      collectEmail: true,
      collectPhone: false,
      allowedDomains: ['acme.com'],
    });
    const res = await api.pub(w.embedToken).config();
    expect(res.body.widget).toEqual({
      name: 'Look',
      mode: 'whatsapp',
      header_title: 'Talk to us',
      header_bg: '#112233',
      header_text: '#FFFFFF',
      welcome_message: 'Hi! How can we help today?',
      bubble_color: '#F0F0F0',
      bubble_text: '#111111',
      body_bg_kind: 'image',
      body_bg_color: '#ECE5DD',
      body_bg_image_url: 'https://cdn.example/bg.png',
      button_label: 'Ask',
      button_bg: '#010203',
      button_text: '#EEEEEE',
      collect_name: true,
      collect_email: true,
      collect_phone: false,
      whatsapp_url: 'https://wa.me/919876543210?text=Hi+there',
    });
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('allowed');
    expect(text).not.toContain(w.embedToken);
  });

  it('WD-WGT-013 #1/#2/#3: the WhatsApp link follows the mode and the number', async () => {
    const a = await api.assistant(t);
    const both = await api.widget(t.admin, { name: 'Both', mode: 'both', assistantId: a.uuid });
    expect((await api.pub(both.embedToken).config()).body.widget.whatsapp_url).toBe(
      'https://wa.me/919876543210?text=Hi+there',
    );
    const ai = await api.widget(t.admin, { name: 'Ai only', mode: 'ai', assistantId: a.uuid });
    expect((await api.pub(ai.embedToken).config()).body.widget.whatsapp_url).toBeNull();
    const none = await api.widget(t.admin, {
      name: 'No number',
      mode: 'whatsapp',
      targetWhatsappNumber: '',
      targetWhatsappCc: '',
    });
    expect((await api.pub(none.embedToken).config()).body.widget.whatsapp_url).toBeNull();
    const plain = await api.widget(t.admin, { name: 'No text', prefilledMessage: '' });
    expect((await api.pub(plain.embedToken).config()).body.widget.whatsapp_url).toBe(
      'https://wa.me/919876543210',
    );
  });

  it('WD-WGT-012 #1/#2: a returning visitor gets the whole thread, oldest first, from their own point of view', async () => {
    const w = await api.widget(t.admin, { name: 'Repaint' });
    const uuid = await api.visitor(w.embedToken);
    await api.pub(w.embedToken).message({ body: 'one', visitor_uuid: uuid });
    await api.pub(w.embedToken).message({ body: 'two', visitor_uuid: uuid });
    await api.agentReply(t.orgId, uuid, 'a person answers');
    const res = await api.pub(w.embedToken).config(uuid);
    const bodies = res.body.transcript.map((m: { body: string }) => m.body);
    expect(bodies).toEqual(['Hi! How can we help today?', 'one', 'two', 'a person answers']);
    expect(res.body.transcript.map((m: { dir: string }) => m.dir)).toEqual([
      'in',
      'out',
      'out',
      'in',
    ]);
    expect(res.body.transcript.map((m: { from: string }) => m.from)).toEqual([
      'assistant',
      'visitor',
      'visitor',
      'assistant',
    ]);
    const ids = res.body.transcript.map((m: { id: number }) => m.id);
    expect([...ids].sort((a, b) => a - b)).toEqual(ids);
  });

  it('WD-WGT-012 #3: a long thread repaints its NEWEST 200 messages, still oldest first (WaDesk showed the oldest 200)', async () => {
    const w = await api.widget(t.admin, { name: 'Long thread', welcomeMessage: '' });
    const uuid = await api.visitor(w.embedToken);
    await api.pub(w.embedToken).message({ body: 'seed', visitor_uuid: uuid });
    const conv = await api.conversationOf(t.orgId, uuid);
    await h.owner.query(
      `INSERT INTO inbox_messages (org_id, conversation_id, direction, from_number, to_number, body, status, sent_at)
       SELECT $1, $2, 'in', $3, 'x', 'bulk ' || g, 'delivered', now() FROM generate_series(1, 205) g`,
      [t.orgId, conv!.id, uuid],
    );
    const res = await api.pub(w.embedToken).config(uuid);
    expect(res.body.transcript).toHaveLength(200);
    expect(res.body.transcript[199].body).toBe('bulk 205');
    expect(res.body.transcript[0].body).toBe('bulk 6');
  });

  it('WD-WGT-012 #2: a brand-new visitor has an empty transcript (the iframe shows the opening line itself)', async () => {
    const w = await api.widget(t.admin, { name: 'Fresh' });
    expect((await api.pub(w.embedToken).config()).body.transcript).toEqual([]);
  });

  it('WD-WGT-010 rule 3: the config of an unknown token is 404 widget_not_found', async () => {
    const res = await api.pub('z'.repeat(48)).config();
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ ok: false, error: 'widget_not_found' });
  });
});

describe('send a visitor message (WD-WGT-014, 015)', () => {
  it('WD-WGT-014 #1: the response has ok and an inbound id, the line is stored inbound, and unread goes up by 1', async () => {
    const w = await api.widget(t.admin, { name: 'Msg 1' });
    const uuid = await api.visitor(w.embedToken);
    const res = await api.pub(w.embedToken).message({ body: 'hello there', visitor_uuid: uuid });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.inbound.id).toBe('number');
    expect(res.body.reply).toBeNull();
    const thread = await api.thread(t.orgId, uuid);
    const inbound = thread.find((m) => m.direction === 'in')!;
    expect(inbound).toMatchObject({ body: 'hello there', status: 'delivered', from_number: uuid });
    expect(inbound.meta).toMatchObject({
      channel: 'chatbot_widget',
      visitor_uuid: uuid,
      widget_id: w.id,
    });
    const conv = await api.conversationOf(t.orgId, uuid);
    expect(conv).toMatchObject({ unread_count: 1, preview: 'hello there' });
    expect(conv!.last_inbound_at).toBeTruthy();
    expect(conv!.last_message_at).toBeTruthy();
    await api.pub(w.embedToken).message({ body: 'again', visitor_uuid: uuid });
    expect((await api.conversationOf(t.orgId, uuid))!.unread_count).toBe(2);
  });

  it('WD-WGT-014 #2 / rule 1: an empty or 8001-character body is 422 and nothing is stored; 8000 is fine', async () => {
    const w = await api.widget(t.admin, { name: 'Msg 2' });
    const uuid = await api.visitor(w.embedToken);
    const empty = await api.pub(w.embedToken).message({ body: '', visitor_uuid: uuid });
    expect(empty.status).toBe(422);
    expect(empty.body).toEqual({
      message: 'The body field is required.',
      errors: { body: ['The body field is required.'] },
    });
    expect((await api.pub(w.embedToken).message({ body: '   ', visitor_uuid: uuid })).status).toBe(
      422,
    );
    expect((await api.pub(w.embedToken).message({ visitor_uuid: uuid })).status).toBe(422);
    const long = await api
      .pub(w.embedToken)
      .message({ body: 'x'.repeat(8001), visitor_uuid: uuid });
    expect(long.status).toBe(422);
    expect(long.body.errors.body[0]).toBe(
      'The body field must not be greater than 8000 characters.',
    );
    expect(await api.thread(t.orgId, uuid)).toEqual([]);
    expect(
      (await api.pub(w.embedToken).message({ body: 'x'.repeat(8000), visitor_uuid: uuid })).status,
    ).toBe(200);
  });

  it('WD-WGT-014 #3: a malformed email is 422 and nothing is stored', async () => {
    const w = await api.widget(t.admin, { name: 'Msg 3' });
    const uuid = await api.visitor(w.embedToken);
    const res = await api
      .pub(w.embedToken)
      .message({ body: 'hi', email: 'notanemail', visitor_uuid: uuid });
    expect(res.status).toBe(422);
    expect(res.body.errors.email[0]).toBe('The email field must be a valid email address.');
    expect(await api.thread(t.orgId, uuid)).toEqual([]);
    const long = await api
      .pub(w.embedToken)
      .message({ body: 'hi', name: 'n'.repeat(121), visitor_uuid: uuid });
    expect(long.status).toBe(422);
    expect(
      (
        await api
          .pub(w.embedToken)
          .message({ body: 'hi', phone: '1'.repeat(33), visitor_uuid: uuid })
      ).status,
    ).toBe(422);
  });

  it('WD-WGT-014 rule 2 / WD-WGT-005 #2: name, email and phone are stored on the visitor, last non-empty write wins', async () => {
    const w = await api.widget(t.admin, { name: 'Msg 4' });
    const uuid = await api.visitor(w.embedToken);
    await api
      .pub(w.embedToken)
      .message({
        body: 'one',
        name: 'Asha',
        email: 'asha@example.com',
        phone: '+91 98765 43210',
        visitor_uuid: uuid,
      });
    await api.pub(w.embedToken).message({ body: 'two', name: '', email: null, visitor_uuid: uuid });
    let row = await h.owner.query(
      `SELECT name, email, phone FROM chatbot_widget_visitors WHERE org_id = $1 AND visitor_uuid = $2`,
      [t.orgId, uuid],
    );
    expect(row.rows[0]).toEqual({
      name: 'Asha',
      email: 'asha@example.com',
      phone: '+91 98765 43210',
    });
    await api.pub(w.embedToken).message({ body: 'three', name: 'Asha K', visitor_uuid: uuid });
    row = await h.owner.query(
      `SELECT name FROM chatbot_widget_visitors WHERE org_id = $1 AND visitor_uuid = $2`,
      [t.orgId, uuid],
    );
    expect(row.rows[0].name).toBe('Asha K');
    const cfg = await api.pub(w.embedToken).config(uuid);
    expect(cfg.body.visitor).toMatchObject({ name: 'Asha K', email: 'asha@example.com' });
  });

  it('WD-WGT-014 rule 1: an unknown token is 404 widget_not_found and stores nothing', async () => {
    const res = await api.pub('q'.repeat(48)).message({ body: 'hi' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ ok: false, error: 'widget_not_found' });
  });

  it('WD-WGT-014 rule 3: a resolved conversation is not reopened; the message still lands (parity)', async () => {
    const w = await api.widget(t.admin, { name: 'Msg 5' });
    const uuid = await api.visitor(w.embedToken);
    await api.pub(w.embedToken).message({ body: 'first', visitor_uuid: uuid });
    await h.owner.query(
      `UPDATE conversations SET inbox_status = 'resolved', resolved_at = now() WHERE org_id = $1 AND id = $2`,
      [t.orgId, (await api.conversationOf(t.orgId, uuid))!.id],
    );
    await api.pub(w.embedToken).message({ body: 'after resolve', visitor_uuid: uuid });
    const conv = await api.conversationOf(t.orgId, uuid);
    expect(conv!.inbox_status).toBe('resolved');
    expect((await api.thread(t.orgId, uuid)).map((m) => m.body)).toContain('after resolve');
  });

  it('WD-WGT-015 #1: the first message creates a chatbot_widget conversation titled with the visitor name, linked to the visitor', async () => {
    const w = await api.widget(t.admin, { name: 'Conv 1' });
    const uuid = await api.visitor(w.embedToken);
    await api.pub(w.embedToken).message({ body: 'hi', name: 'Asha', visitor_uuid: uuid });
    const conv = await api.conversationOf(t.orgId, uuid);
    expect(conv).toMatchObject({
      channel: 'chatbot_widget',
      platform: 'WIDGET',
      origin: 'web',
      status: 'open',
      inbox_status: 'open',
      title: 'Asha',
      priority: 'normal',
    });
    expect(conv!.raw_jid).toBe(`widget-${w.id}-${uuid}`);
    expect(conv!.device_id).toBeNull();
    expect(conv!.assignee_user_id).toBeNull();
    expect(conv!.sla_policy_id).toBeNull();
    expect(conv!.routing_meta).toMatchObject({
      widget_id: w.id,
      widget_name: 'Conv 1',
      visitor_uuid: uuid,
    });
  });

  it('WD-WGT-015 rule 3: with no name or email the title is "Visitor " and six characters of the uuid', async () => {
    const w = await api.widget(t.admin, { name: 'Conv 2' });
    const uuid = await api.visitor(w.embedToken);
    await api.pub(w.embedToken).message({ body: 'hi', visitor_uuid: uuid });
    expect((await api.conversationOf(t.orgId, uuid))!.title).toBe(`Visitor ${uuid.slice(0, 6)}`);
  });

  it('WD-WGT-015 #2: a second message uses the same conversation', async () => {
    const w = await api.widget(t.admin, { name: 'Conv 3' });
    const uuid = await api.visitor(w.embedToken);
    await api.pub(w.embedToken).message({ body: 'one', visitor_uuid: uuid });
    const first = (await api.conversationOf(t.orgId, uuid))!.id;
    await api.pub(w.embedToken).message({ body: 'two', visitor_uuid: uuid });
    expect((await api.conversationOf(t.orgId, uuid))!.id).toBe(first);
    expect(
      await api.count(
        `SELECT count(*)::int AS n FROM conversations WHERE org_id = $1 AND routing_meta ->> 'visitor_uuid' = $2`,
        [t.orgId, uuid],
      ),
    ).toBe(1);
  });

  it('WD-WGT-015 rule 1: if the conversation was deleted a new one is created and the visitor is pointed at it', async () => {
    const w = await api.widget(t.admin, { name: 'Conv 4' });
    const uuid = await api.visitor(w.embedToken);
    await api.pub(w.embedToken).message({ body: 'one', visitor_uuid: uuid });
    const old = (await api.conversationOf(t.orgId, uuid))!.id;
    await h.owner.query(`DELETE FROM conversations WHERE org_id = $1 AND id = $2`, [t.orgId, old]);
    const res = await api.pub(w.embedToken).message({ body: 'two', visitor_uuid: uuid });
    expect(res.status).toBe(200);
    expect((await api.conversationOf(t.orgId, uuid))!.id).not.toBe(old);
  });

  it('WD-WGT-015 / WD-WGT-009: the opening line is a message of the thread, so agents see it first and a reload repaints it', async () => {
    const w = await api.widget(t.admin, { name: 'Conv 5', welcomeMessage: 'Welcome aboard' });
    const uuid = await api.visitor(w.embedToken);
    await api.pub(w.embedToken).message({ body: 'hi', visitor_uuid: uuid });
    const thread = await api.thread(t.orgId, uuid);
    expect(thread.map((m) => `${m.direction}:${m.body}`)).toEqual(['out:Welcome aboard', 'in:hi']);
    expect(thread[0]!.meta).toMatchObject({ source: 'welcome' });
  });

  it('WD-WGT-015 #4: with no phone a contact keyed by the widget channel and the visitor uuid is created once per visitor', async () => {
    const w = await api.widget(t.admin, { name: 'Contact 1' });
    const uuid = await api.visitor(w.embedToken);
    await api
      .pub(w.embedToken)
      .message({ body: 'one', name: 'Asha', email: 'asha@contact.test', visitor_uuid: uuid });
    await api.pub(w.embedToken).message({ body: 'two', visitor_uuid: uuid });
    const rows = await h.owner.query(
      `SELECT id, name, first_name, email, owner_id FROM contacts WHERE org_id = $1 AND channel = 'chatbot_widget' AND channel_uid = $2`,
      [t.orgId, uuid],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({
      name: 'Asha',
      first_name: 'Asha',
      email: 'asha@contact.test',
    });
    expect(Number(rows.rows[0].owner_id)).toBe(t.adminUserId);
    const conv = await api.conversationOf(t.orgId, uuid);
    expect(Number(conv!.contact_id)).toBe(Number(rows.rows[0].id));
  });

  it('WD-WGT-015 #3: a visitor phone that matches an existing contact links to it and leaves its filled fields alone', async () => {
    const [existing] = await api.seedContacts(t, [
      { name: 'Existing Person', phone: '+91 98765 43211', email: null },
    ]);
    const w = await api.widget(t.admin, { name: 'Contact 2' });
    const uuid = await api.visitor(w.embedToken);
    await api
      .pub(w.embedToken)
      .message({
        body: 'hi',
        name: 'Someone Else',
        email: 'new@contact.test',
        phone: '919876543211',
        visitor_uuid: uuid,
      });
    const conv = await api.conversationOf(t.orgId, uuid);
    const linked = await h.owner.query(
      `SELECT uuid, name, email, channel FROM contacts WHERE org_id = $1 AND id = $2`,
      [t.orgId, conv!.contact_id],
    );
    expect(linked.rows[0].uuid).toBe(existing);
    expect(linked.rows[0].name).toBe('Existing Person');
    expect(linked.rows[0].email).toBe('new@contact.test');
    expect(linked.rows[0].channel).toBeNull();
    expect(
      await api.count(
        `SELECT count(*)::int AS n FROM contacts WHERE org_id = $1 AND channel = 'chatbot_widget' AND channel_uid = $2`,
        [t.orgId, uuid],
      ),
    ).toBe(0);
  });

  it('WD-WGT-015 / WD-WGT-019 #3: the widget thread stays separate from the WhatsApp thread of the same phone', async () => {
    const w = await api.widget(t.admin, { name: 'Contact 3' });
    const uuid = await api.visitor(w.embedToken);
    const wa = await h.owner.query(
      `INSERT INTO conversations (org_id, raw_jid, title, channel, contact_digits) VALUES ($1, '919876540000@s.whatsapp.net', 'WA thread', 'whatsapp', '919876540000') RETURNING id`,
      [t.orgId],
    );
    await api.pub(w.embedToken).message({ body: 'hi', phone: '919876540000', visitor_uuid: uuid });
    const conv = await api.conversationOf(t.orgId, uuid);
    expect(Number(conv!.id)).not.toBe(Number(wa.rows[0].id));
    expect(conv!.channel).toBe('chatbot_widget');
  });

  it('WD-WGT-019 #1/#4/#5/#6: the thread is an ordinary inbox thread: visible without a connected engine, unassigned, no SLA, no routing', async () => {
    const w = await api.widget(t.admin, { name: 'Inbox 1' });
    const uuid = await api.visitor(w.embedToken);
    await api.pub(w.embedToken).message({ body: 'hi', visitor_uuid: uuid });
    const conv = await api.conversationOf(t.orgId, uuid);
    expect(conv).toMatchObject({ archived: false, is_spam: false, sla_breached: false });
    expect(conv!.assignee_user_id).toBeNull();
    expect(conv!.assignee_team_id).toBeNull();
    expect(conv!.sla_first_response_due).toBeNull();
    expect(conv!.first_response_at).toBeNull();
    // Inbound lines carry the provider of the thread, as the inbox stamps them.
    const inbound = (await api.thread(t.orgId, uuid)).find((m) => m.direction === 'in')!;
    expect(inbound.provider).toBe(conv!.provider);
  });

  it('WD-WGT-016 #4 (whatsapp mode): the widget stores the line and answers nothing', async () => {
    const w = await api.widget(t.admin, { name: 'Quiet' });
    const uuid = await api.visitor(w.embedToken);
    const res = await api.pub(w.embedToken).message({ body: 'anyone?', visitor_uuid: uuid });
    expect(res.body.reply).toBeNull();
    expect(
      (await api.thread(t.orgId, uuid)).filter(
        (m) => m.direction === 'out' && m.meta.source !== 'welcome',
      ),
    ).toEqual([]);
  });

  it('WD-WGT-014: a hostile body is stored and returned as plain text, never interpreted', async () => {
    const w = await api.widget(t.admin, { name: 'Xss' });
    const uuid = await api.visitor(w.embedToken);
    const evil = `<script>alert(1)</script> ' OR 1=1; --`;
    expect((await api.pub(w.embedToken).message({ body: evil, visitor_uuid: uuid })).status).toBe(
      200,
    );
    const cfg = await api.pub(w.embedToken).config(uuid);
    expect(cfg.body.transcript.some((m: { body: string }) => m.body === evil)).toBe(true);
    expect(cfg.headers['content-type']).toMatch(/json/);
  });
});

describe('AI assistant reply (WD-WGT-016, 017)', () => {
  it('WD-WGT-016 #1: with an assistant and a ready source the reply is the model text and is stored as an assistant line', async () => {
    const { w, a } = await aiWidget(
      { name: 'AI 1' },
      { name: 'Shoe bot', systemPrompt: 'You sell shoes.', tone: 'warm' },
    );
    await api.source(t, { assistantId: a.id, label: 'Shipping', content: 'Free over 50 dollars' });
    await api.source(t, { assistantId: null, label: 'Company', content: 'We are open daily' });
    await api.source(t, {
      assistantId: a.id,
      label: 'Draft',
      content: 'Not ready yet',
      status: 'pending',
    });
    const uuid = await api.visitor(w.embedToken);
    ai.next = 'We ship free over 50 dollars.';
    ai.calls.length = 0;
    const res = await api
      .pub(w.embedToken)
      .message({ body: 'How much is shipping?', visitor_uuid: uuid });
    expect(res.status).toBe(200);
    expect(res.body.reply.body).toBe('We ship free over 50 dollars.');
    expect(typeof res.body.reply.id).toBe('number');
    const call = ai.calls[0]!;
    expect(call.system).toContain('You sell shoes.');
    expect(call.system).toContain('Speak in a warm tone');
    expect(call.system).toContain('[Shipping]\nFree over 50 dollars');
    expect(call.system).toContain('[Company]\nWe are open daily');
    expect(call.system).not.toContain('Not ready yet');
    expect(call.user).toContain('Visitor just said:\nHow much is shipping?');
    expect(call.max_tokens).toBe(400);
    expect(call.temperature).toBeCloseTo(0.7);
    const out = (await api.thread(t.orgId, uuid)).find(
      (m) => m.meta?.source === 'ai_chat_assistant',
    )!;
    expect(out).toMatchObject({
      direction: 'out',
      status: 'sent',
      body: 'We ship free over 50 dollars.',
      to_number: uuid,
    });
    expect(out.meta).toMatchObject({ assistant_id: a.uuid, channel: 'chatbot_widget' });
    const conv = await api.conversationOf(t.orgId, uuid);
    expect(conv!.last_outbound_at).toBeTruthy();
    expect(conv!.preview).toBe('We ship free over 50 dollars.');
  });

  it("WD-WGT-016 rule 4 / WD-WGT-017 #2: the visitor's new line is not repeated as history, and the bot answers every message while no person has", async () => {
    const { w } = await aiWidget({ name: 'AI 2' });
    const uuid = await api.visitor(w.embedToken);
    ai.calls.length = 0;
    ai.next = 'reply one';
    const r1 = await api.pub(w.embedToken).message({ body: 'first question', visitor_uuid: uuid });
    ai.next = 'reply two';
    const r2 = await api.pub(w.embedToken).message({ body: 'second question', visitor_uuid: uuid });
    ai.next = 'reply three';
    const r3 = await api.pub(w.embedToken).message({ body: 'third question', visitor_uuid: uuid });
    expect([r1.body.reply.body, r2.body.reply.body, r3.body.reply.body]).toEqual([
      'reply one',
      'reply two',
      'reply three',
    ]);
    const second = ai.calls[1]!.user;
    expect(second).toContain('Conversation so far:');
    expect(second).toContain('Visitor: first question');
    expect(second).toContain('Assistant: reply one');
    expect(second.indexOf('second question')).toBe(second.lastIndexOf('second question'));
    expect(second).toContain('Visitor just said:\nsecond question');
    // The opening line is part of the history as the assistant's first words.
    expect(ai.calls[0]!.user).toContain('Assistant: Hi! How can we help today?');
  });

  it('WD-WGT-017 #1/#3: once a person replied in the inbox the bot stays silent for the rest of the thread', async () => {
    const { w } = await aiWidget({ name: 'AI 3' });
    const uuid = await api.visitor(w.embedToken);
    ai.next = 'bot one';
    expect(
      (await api.pub(w.embedToken).message({ body: 'hello', visitor_uuid: uuid })).body.reply.body,
    ).toBe('bot one');
    await api.agentReply(t.orgId, uuid, 'I am a person');
    ai.calls.length = 0;
    const after = await api
      .pub(w.embedToken)
      .message({ body: 'are you a bot?', visitor_uuid: uuid });
    expect(after.status).toBe(200);
    expect(after.body.reply).toBeNull();
    const later = await api.pub(w.embedToken).message({ body: 'hello?', visitor_uuid: uuid });
    expect(later.body.reply).toBeNull();
    expect(ai.calls).toHaveLength(0);
    // The visitor's lines are still stored.
    expect((await api.thread(t.orgId, uuid)).map((m) => m.body)).toEqual(
      expect.arrayContaining(['are you a bot?', 'hello?']),
    );
  });

  it('WD-WGT-017: a reply with no sender number (the inbox leaves it null) counts as a person too', async () => {
    const { w } = await aiWidget({ name: 'AI 4' });
    const uuid = await api.visitor(w.embedToken);
    await api.pub(w.embedToken).message({ body: 'hello', visitor_uuid: uuid });
    await api.agentReply(t.orgId, uuid, 'null sender', null);
    ai.calls.length = 0;
    expect(
      (await api.pub(w.embedToken).message({ body: 'again', visitor_uuid: uuid })).body.reply,
    ).toBeNull();
    expect(ai.calls).toHaveLength(0);
  });

  it("WD-WGT-016 #2 (empty): a blank model answer becomes the assistant's fallback message, stored like any reply", async () => {
    const { w } = await aiWidget({ name: 'AI 5' }, { fallback: 'Please email us.' });
    const uuid = await api.visitor(w.embedToken);
    ai.next = 'empty';
    const res = await api.pub(w.embedToken).message({ body: 'hello', visitor_uuid: uuid });
    expect(res.body.reply.body).toBe('Please email us.');
    expect((await api.thread(t.orgId, uuid)).some((m) => m.body === 'Please email us.')).toBe(true);
  });

  it('WD-WGT-016 #2 (empty, no fallback set): the built-in line is used', async () => {
    const { w } = await aiWidget({ name: 'AI 6' });
    const uuid = await api.visitor(w.embedToken);
    ai.next = 'empty';
    const res = await api.pub(w.embedToken).message({ body: 'hello', visitor_uuid: uuid });
    expect(res.body.reply.body).toBe(
      "Sorry, I couldn't generate a reply right now. A team member will follow up shortly.",
    );
  });

  it('WD-WGT-016 #3: when the vendor call fails the request still returns 200 with the fallback', async () => {
    const { w } = await aiWidget({ name: 'AI 7' }, { fallback: 'Back soon.' });
    const uuid = await api.visitor(w.embedToken);
    ai.next = 'error';
    const res = await api.pub(w.embedToken).message({ body: 'hello', visitor_uuid: uuid });
    expect(res.status).toBe(200);
    expect(res.body.reply.body).toBe('Back soon.');
    const { w: w2 } = await aiWidget({ name: 'AI 8' });
    const u2 = await api.visitor(w2.embedToken);
    ai.next = 'error';
    expect(
      (await api.pub(w2.embedToken).message({ body: 'hello', visitor_uuid: u2 })).body.reply.body,
    ).toBe("Sorry, I'm having trouble right now. A team member will follow up shortly.");
  });

  it("WD-WGT-016 rule 5: the assistant's token cap, temperature and model reach the vendor", async () => {
    const a = await api.assistant(t, { name: 'Tuned', model: 'gpt-test' });
    await h.owner.query(
      `UPDATE ai_chat_assistants SET reply_max_tokens = 123, temperature = 0.25 WHERE org_id = $1 AND id = $2`,
      [t.orgId, a.id],
    );
    const w = await api.widget(t.admin, { name: 'AI 9', mode: 'ai', assistantId: a.uuid });
    const uuid = await api.visitor(w.embedToken);
    ai.next = 'ok';
    ai.calls.length = 0;
    await api.pub(w.embedToken).message({ body: 'hello', visitor_uuid: uuid });
    expect(ai.calls[0]).toMatchObject({ max_tokens: 123, model: 'gpt-test' });
    expect(ai.calls[0]!.temperature).toBeCloseTo(0.25);
  });

  it('WD-WGT-016 rule 2: the handoff hint is in the prompt only when the assistant has a keyword', async () => {
    const { w } = await aiWidget({ name: 'AI 10' }, { handoffKeyword: 'agent' });
    const uuid = await api.visitor(w.embedToken);
    ai.next = 'ok';
    ai.calls.length = 0;
    await api.pub(w.embedToken).message({ body: 'hello', visitor_uuid: uuid });
    expect(ai.calls[0]!.system).toContain('says "agent"');
    expect(ai.calls[0]!.system).toContain('A team member will join shortly.');
  });

  it('WD-WGT-016 #1 (both): a widget in both mode answers too, and the WhatsApp link is still offered', async () => {
    const { w } = await aiWidget({ name: 'AI 11', mode: 'both' });
    const uuid = await api.visitor(w.embedToken);
    ai.next = 'both works';
    expect(
      (await api.pub(w.embedToken).message({ body: 'hello', visitor_uuid: uuid })).body.reply.body,
    ).toBe('both works');
    expect((await api.pub(w.embedToken).config(uuid)).body.widget.whatsapp_url).toContain('wa.me');
  });

  it('WD-WGT-003 rule 6: if the assistant is deleted the widget keeps saving lines and answers nothing, without an error', async () => {
    const a = await api.assistant(t, { name: 'Soon gone' });
    const w = await api.widget(t.admin, { name: 'AI 12', mode: 'ai', assistantId: a.uuid });
    const uuid = await api.visitor(w.embedToken);
    await h.owner.query(`DELETE FROM ai_chat_assistants WHERE org_id = $1 AND id = $2`, [
      t.orgId,
      a.id,
    ]);
    ai.calls.length = 0;
    const res = await api.pub(w.embedToken).message({ body: 'hello', visitor_uuid: uuid });
    expect(res.status).toBe(200);
    expect(res.body.reply).toBeNull();
    expect(ai.calls).toHaveLength(0);
  });

  it('WD-WGT-016: the vendor is never called while a database transaction is open on the visitor message (no lock held across the call)', async () => {
    const { w } = await aiWidget({ name: 'AI 13' });
    const uuid = await api.visitor(w.embedToken);
    ai.next = 'ok';
    await api.pub(w.embedToken).message({ body: 'hello', visitor_uuid: uuid });
    const open = await h.owner.query(
      `SELECT count(*)::int AS n FROM pg_stat_activity WHERE state = 'idle in transaction'`,
    );
    expect(open.rows[0].n).toBe(0);
  });
});

describe('agent replies reach the visitor by polling (WD-WGT-018)', () => {
  it('WD-WGT-018 #1/#3: a reply typed in the inbox shows up in the poll once; with `since` at its id nothing more comes', async () => {
    const w = await api.widget(t.admin, { name: 'Poll 1' });
    const uuid = await api.visitor(w.embedToken);
    await api.pub(w.embedToken).message({ body: 'hi', visitor_uuid: uuid });
    const first = await api.pub(w.embedToken).history(uuid, 0);
    // Only the opening line so far; the visitor's own line is inbound and never comes back.
    expect(first.body.messages.map((m: { body: string }) => m.body)).toEqual([
      'Hi! How can we help today?',
    ]);
    const since = first.body.messages.at(-1).id as number;
    const id = await api.agentReply(t.orgId, uuid, 'Hello, how can I help?');
    const poll = await api.pub(w.embedToken).history(uuid, since);
    expect(poll.status).toBe(200);
    expect(poll.body.ok).toBe(true);
    expect(poll.body.messages).toHaveLength(1);
    expect(poll.body.messages[0]).toMatchObject({
      id,
      body: 'Hello, how can I help?',
      from: 'assistant',
    });
    expect(poll.body.messages[0].at).toBeTruthy();
    expect((await api.pub(w.embedToken).history(uuid, id)).body.messages).toEqual([]);
  });

  it('WD-WGT-018: replies come back oldest first and carry who wrote them', async () => {
    const w = await api.widget(t.admin, { name: 'Poll 2', welcomeMessage: '' });
    const uuid = await api.visitor(w.embedToken);
    await api.pub(w.embedToken).message({ body: 'hi', visitor_uuid: uuid });
    await api.agentReply(t.orgId, uuid, 'one');
    await api.agentReply(t.orgId, uuid, 'two');
    const res = await api.pub(w.embedToken).history(uuid, 0);
    expect(res.body.messages.map((m: { body: string }) => m.body)).toEqual(['one', 'two']);
    const ids = res.body.messages.map((m: { id: number }) => m.id);
    expect(ids[0]).toBeLessThan(ids[1]);
  });

  it('WD-WGT-018 #2: a visitor with no conversation gets an empty list, and the poll does not create a visitor', async () => {
    const w = await api.widget(t.admin, { name: 'Poll 3' });
    const uuid = await api.visitor(w.embedToken);
    expect((await api.pub(w.embedToken).history(uuid, 0)).body).toEqual({ ok: true, messages: [] });
    const before = await api.count(
      `SELECT count(*)::int AS n FROM chatbot_widget_visitors WHERE org_id = $1`,
      [t.orgId],
    );
    expect((await api.pub(w.embedToken).history(undefined, 0)).body).toEqual({
      ok: true,
      messages: [],
    });
    expect((await api.pub(w.embedToken).history(crypto.randomUUID(), 0)).body).toEqual({
      ok: true,
      messages: [],
    });
    expect(
      await api.count(`SELECT count(*)::int AS n FROM chatbot_widget_visitors WHERE org_id = $1`, [
        t.orgId,
      ]),
    ).toBe(before);
  });

  it("WD-WGT-018: one visitor's poll never returns another visitor's replies", async () => {
    const w = await api.widget(t.admin, { name: 'Poll 4', welcomeMessage: '' });
    const u1 = await api.visitor(w.embedToken);
    const u2 = await api.visitor(w.embedToken);
    await api.pub(w.embedToken).message({ body: 'hi', visitor_uuid: u1 });
    await api.pub(w.embedToken).message({ body: 'hi', visitor_uuid: u2 });
    await api.agentReply(t.orgId, u1, 'for u1 only');
    expect((await api.pub(w.embedToken).history(u2, 0)).body.messages).toEqual([]);
    expect(
      (await api.pub(w.embedToken).history(u1, 0)).body.messages.map(
        (m: { body: string }) => m.body,
      ),
    ).toEqual(['for u1 only']);
  });

  it('WD-WGT-018 #4: after a rotation the old token is 404, and the visitor continues under the new one', async () => {
    const w = await api.widget(t.admin, { name: 'Poll 5' });
    const uuid = await api.visitor(w.embedToken);
    await api.pub(w.embedToken).message({ body: 'hi', visitor_uuid: uuid });
    const rot = await api.as(t.admin).post(`/v2/widgets/${w.id}/rotate-token`);
    expect((await api.pub(w.embedToken).history(uuid, 0)).status).toBe(404);
    await api.agentReply(t.orgId, uuid, 'still here');
    const res = await api.pub(rot.body.embedToken).history(uuid, 0);
    expect(res.body.messages.map((m: { body: string }) => m.body)).toContain('still here');
  });

  it('WD-WGT-019 #2: the full hand-off: visitor writes, an agent answers in the inbox, the visitor sees it, the bot stays quiet', async () => {
    const { w } = await aiWidget({ name: 'Handoff' });
    const uuid = await api.visitor(w.embedToken);
    ai.next = 'bot greeting';
    const r1 = await api.pub(w.embedToken).message({ body: 'I need help', visitor_uuid: uuid });
    expect(r1.body.reply.body).toBe('bot greeting');
    const conv = await api.conversationOf(t.orgId, uuid);
    expect(conv).toMatchObject({ channel: 'chatbot_widget', unread_count: 1 });
    await api.agentReply(t.orgId, uuid, 'A human here');
    const poll = await api.pub(w.embedToken).history(uuid, r1.body.reply.id);
    expect(poll.body.messages.map((m: { body: string }) => m.body)).toEqual(['A human here']);
    const r2 = await api.pub(w.embedToken).message({ body: 'thanks', visitor_uuid: uuid });
    expect(r2.body.reply).toBeNull();
  });
});

describe('allowed domains (WD-WGT-020, 021)', () => {
  it('WD-WGT-020 #1: an empty allow-list processes any origin and echoes it back with credentials allowed', async () => {
    const w = await api.widget(t.admin, { name: 'Cors 1' });
    const res = await api
      .pub(w.embedToken)
      .config(undefined, { origin: 'https://anything.example' });
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('https://anything.example');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers['access-control-allow-methods']).toBe('GET, POST, OPTIONS');
    expect(res.headers['access-control-max-age']).toBe('3600');
    expect(String(res.headers.vary)).toContain('Origin');
  });

  it('WD-WGT-020 #2: with ["acme.com"], https://Acme.com is allowed and https://www.acme.com is 403 cors_origin_denied', async () => {
    const w = await api.widget(t.admin, { name: 'Cors 2', allowedDomains: ['acme.com'] });
    const ok = await api.pub(w.embedToken).config(undefined, { origin: 'https://Acme.com' });
    expect(ok.status).toBe(200);
    expect(ok.headers['access-control-allow-origin']).toBe('https://Acme.com');
    const denied = await api
      .pub(w.embedToken)
      .config(undefined, { origin: 'https://www.acme.com' });
    expect(denied.status).toBe(403);
    expect(denied.body).toEqual({
      ok: false,
      error: 'cors_origin_denied',
      message:
        "This widget isn't allowed to load from https://www.acme.com. Add the domain to the widget's allow-list.",
    });
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('WD-WGT-020: the check covers config, message and history alike, and a denied message is not stored', async () => {
    const w = await api.widget(t.admin, { name: 'Cors 3', allowedDomains: ['acme.com'] });
    const uuid = await api.visitor(w.embedToken);
    const evil = { origin: 'https://evil.example' };
    expect((await api.pub(w.embedToken).history(uuid, 0, evil)).status).toBe(403);
    const msg = await api.pub(w.embedToken).message({ body: 'blocked', visitor_uuid: uuid }, evil);
    expect(msg.status).toBe(403);
    expect(await api.thread(t.orgId, uuid)).toEqual([]);
    const good = await api
      .pub(w.embedToken)
      .message({ body: 'allowed', visitor_uuid: uuid }, { origin: 'https://acme.com' });
    expect(good.status).toBe(200);
    expect(good.headers['access-control-allow-origin']).toBe('https://acme.com');
  });

  it('WD-WGT-020 #4: with no Origin header the request is handled without CORS headers, whatever the list says', async () => {
    const w = await api.widget(t.admin, { name: 'Cors 4', allowedDomains: ['acme.com'] });
    const res = await api.pub(w.embedToken).config();
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it("WD-WGT-020 rule 7: the widget's own host is always allowed, so the chat page can post from its own origin", async () => {
    const w = await api.widget(t.admin, { name: 'Cors 5', allowedDomains: ['acme.com'] });
    const uuid = await api.visitor(w.embedToken);
    // The chat page is served from the widget's host, so its own posts carry that host as their Origin.
    const res = await api
      .pub(w.embedToken)
      .message(
        { body: 'from my own page', visitor_uuid: uuid },
        { origin: 'https://widgets.crm.test', host: 'widgets.crm.test' },
      );
    expect(res.status).toBe(200);
  });

  it('WD-WGT-020 #5: an unknown token with an Origin header is 404 widget_not_found, never 403', async () => {
    const res = await api.pub('k'.repeat(48)).config(undefined, { origin: 'https://acme.com' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ ok: false, error: 'widget_not_found' });
  });

  it('WD-WGT-020 rule 6: ports must match exactly', async () => {
    const w = await api.widget(t.admin, { name: 'Cors 6', allowedDomains: ['localhost:8080'] });
    expect(
      (await api.pub(w.embedToken).config(undefined, { origin: 'http://localhost:8080' })).status,
    ).toBe(200);
    expect(
      (await api.pub(w.embedToken).config(undefined, { origin: 'http://localhost:9090' })).status,
    ).toBe(403);
    expect(
      (await api.pub(w.embedToken).config(undefined, { origin: 'http://localhost' })).status,
    ).toBe(403);
  });
});

describe('public hardening (WD-WGT-022)', () => {
  it('WD-WGT-022 #2: the 61st message in a minute from one address to one widget is 429; another widget is unaffected', async () => {
    const w = await api.widget(t.admin, { name: 'Throttle 1' });
    const other = await api.widget(t.admin, { name: 'Throttle 2' });
    const uuid = await api.visitor(w.embedToken);
    const ok: number[] = [];
    for (let i = 0; i < 60; i++)
      ok.push((await api.pub(w.embedToken).message({ body: `m${i}`, visitor_uuid: uuid })).status);
    expect(new Set(ok)).toEqual(new Set([200]));
    const limited = await api
      .pub(w.embedToken)
      .message({ body: 'one too many', visitor_uuid: uuid });
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBe('60');
    expect(limited.body.message).toBe('Too Many Attempts.');
    expect(
      (
        await api
          .pub(other.embedToken)
          .message({ body: 'fine', visitor_uuid: await api.visitor(other.embedToken) })
      ).status,
    ).toBe(200);
  });

  it('WD-WGT-022 #3: the message route does not need a CSRF token or a session', async () => {
    const w = await api.widget(t.admin, { name: 'Csrf' });
    const uuid = await api.visitor(w.embedToken);
    const res = await api
      .http()
      .post(`/widget/${w.embedToken}/api/message`)
      .send({ body: 'no csrf', visitor_uuid: uuid });
    expect(res.status).toBe(200);
  });

  it('WD-WGT-022: the history poll is limited to 120 a minute and shares the message counter', async () => {
    const w = await api.widget(t.admin, { name: 'Throttle 3' });
    const uuid = await api.visitor(w.embedToken);
    for (let i = 0; i < 120; i++) await api.pub(w.embedToken).history(uuid, 0);
    expect((await api.pub(w.embedToken).history(uuid, 0)).status).toBe(429);
    // The shared counter is already past the message limit too.
    expect((await api.pub(w.embedToken).message({ body: 'x', visitor_uuid: uuid })).status).toBe(
      429,
    );
  });
});

describe('tenant isolation of the public path (WD-WGT-010, 014)', () => {
  it("a visitor of one workspace's widget never reaches another workspace's rows, and every write lands in the widget's own org", async () => {
    const other = await api.signup('wgpub2');
    const mine = await api.widget(t.admin, { name: 'Iso mine' });
    const theirs = await api.widget(other.admin, { name: 'Iso theirs' });
    const u1 = await api.visitor(mine.embedToken);
    const u2 = await api.visitor(theirs.embedToken);
    await api.pub(mine.embedToken).message({ body: 'mine', name: 'Mine', visitor_uuid: u1 });
    await api.pub(theirs.embedToken).message({ body: 'theirs', name: 'Theirs', visitor_uuid: u2 });
    expect((await api.thread(t.orgId, u1)).map((m) => m.body)).toContain('mine');
    expect(await api.thread(t.orgId, u2)).toEqual([]);
    expect((await api.thread(other.orgId, u2)).map((m) => m.body)).toContain('theirs');
    const crossed = await h.owner.query(
      `SELECT count(*)::int AS n FROM conversations c JOIN chatbot_widget_visitors v ON v.conversation_id = c.id AND v.org_id <> c.org_id`,
    );
    expect(crossed.rows[0].n).toBe(0);
    const cfg = await api.pub(mine.embedToken).config(u2);
    expect(cfg.body.visitor.uuid).not.toBe(u2);
  });
});
