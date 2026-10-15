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
    const ig = await bot('instagram', 'Instagram bot');
    expect((await api.as(t.admin).get(`/v2/flows/${ig}/widget`)).status).toBe(422);
    expect((await api.as(t.admin).put(`/v2/flows/${ig}/widget`).send(look())).status).toBe(422);
    const missing = '00000000-0000-4000-8000-000000000000';
    expect((await api.as(t.admin).get(`/v2/flows/${missing}/widget`)).status).toBe(404);
  });

  it("gives a WhatsApp bot its website button: the bot's number and message, mode whatsapp, a deep link in the embed script", async () => {
    const wa = await bot('chat', 'WhatsApp bot');
    expect((await api.as(t.admin).get(`/v2/flows/${wa}/widget`)).body).toEqual({ widget: null });

    const noNumber = await api.as(t.admin).put(`/v2/flows/${wa}/widget`).send(look());
    expect(noNumber.status, JSON.stringify(noNumber.body)).toBe(422);

    const saved = await api
      .as(t.admin)
      .put(`/v2/flows/${wa}/widget`)
      .send(
        look({
          targetWhatsappCc: '+91',
          targetWhatsappNumber: '9876543210',
          prefilledMessage: 'hello',
        }),
      );
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body).toMatchObject({
      name: 'WhatsApp bot',
      mode: 'whatsapp',
      flowId: wa,
      targetWhatsappCc: '+91',
      targetWhatsappNumber: '9876543210',
      prefilledMessage: 'hello',
    });
    expect(saved.body.customizedAt).toEqual(expect.any(String));

    // The embed script a site loads carries the deep link, and the bot has no website chat channel.
    const script = await api.pub(saved.body.embedToken as string).embed();
    expect(script.status).toBe(200);
    expect(script.text).toContain('wa.me/919876543210');
    const channels = await h.owner.query(
      `SELECT 1 FROM channels WHERE org_id = $1 AND kind = 'webchat' AND external_id = $2`,
      [t.orgId, saved.body.id],
    );
    expect(channels.rowCount).toBe(0);

    // A later save carries the row version, as for a website bot.
    const again = await api
      .as(t.admin)
      .put(`/v2/flows/${wa}/widget`)
      .send(
        look({
          targetWhatsappCc: '+91',
          targetWhatsappNumber: '9876543210',
          rowVersion: saved.body.rowVersion,
        }),
      );
    expect(again.status, JSON.stringify(again.body)).toBe(200);
  });

  it("keeps a WhatsApp bot's button pictures: uploads a logo and a popup picture, serves them publicly, and removes them", async () => {
    const wa = await bot('chat', 'WhatsApp pictures');
    // A 1x1 PNG.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const up = await api
      .as(t.admin)
      .post(`/v2/flows/${wa}/widget/assets/logo`)
      .attach('file', png, { filename: 'logo.png', contentType: 'image/png' });
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    expect(up.body.url).toMatch(new RegExp(`/widget-assets/${wa}/logo\\?v=[0-9a-f]{16}$`));

    // The public address answers with the picture, without any sign-in, cacheable and embeddable by any site.
    const path = new URL(up.body.url as string).pathname;
    const served = await api.http().get(path);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toContain('image/png');
    expect(served.headers['cache-control']).toContain('immutable');
    expect(served.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(Buffer.compare(served.body as Buffer, png)).toBe(0);

    // A second upload replaces the first in place.
    const again = await api
      .as(t.admin)
      .post(`/v2/flows/${wa}/widget/assets/popup`)
      .attach('file', png, { filename: 'popup.png', contentType: 'image/png' });
    expect(again.status).toBe(201);
    const rows = await h.owner.query(
      `SELECT slot FROM flow_widget_assets a JOIN flows f ON f.org_id = a.org_id AND f.id = a.flow_id WHERE f.uuid = $1 ORDER BY slot`,
      [wa],
    );
    expect(rows.rows.map((r: { slot: string }) => r.slot)).toEqual(['logo', 'popup']);

    const del = await api.as(t.admin).delete(`/v2/flows/${wa}/widget/assets/logo`);
    expect(del.status).toBe(204);
    expect((await api.http().get(path)).status).toBe(404);
  });

  it('refuses a picture that is not an image, is an unsafe SVG, is too large, or is for another kind of bot', async () => {
    const wa = await bot('chat', 'WhatsApp refusals');
    const post = (slot: string, buf: Buffer, name: string, flow = wa) =>
      api.as(t.admin).post(`/v2/flows/${flow}/widget/assets/${slot}`).attach('file', buf, name);
    expect((await post('logo', Buffer.from('hello'), 'logo.png')).status).toBe(422);
    expect(
      (
        await post(
          'logo',
          Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
          'logo.svg',
        )
      ).status,
    ).toBe(422);
    expect((await post('logo', Buffer.alloc(1_100_000, 1), 'big.png')).status).toBe(422);
    expect((await post('banner', Buffer.from('x'), 'a.png')).status).toBe(404);
    const web = await bot('web', 'Web no pictures');
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    // A WhatsApp bot has no chat window to put a bot picture or a background in.
    expect((await post('avatar', png, 'a.png')).status).toBe(422);
    expect((await post('background', png, 'b.png')).status).toBe(422);
    expect((await post('logo', png, 'logo.png', web)).status).toBe(201);
    const none = await api.member(t, 'nopics', [['flb.flows.read']]);
    const denied = await api
      .as(none.token)
      .post(`/v2/flows/${wa}/widget/assets/logo`)
      .attach('file', png, 'logo.png');
    expect(denied.status).toBe(403);
    expect((await api.http().get(`/widget-assets/${wa}/logo`)).status).toBe(404);
  });

  it("keeps a website bot's logo, bot picture and background, takes a safe SVG and serves it locked down", async () => {
    const web = await bot('web', 'Web pictures');
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#5B4DDB"/></svg>',
    );
    const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
    const put = (slot: string, buf: Buffer, name: string, type: string) =>
      api
        .as(t.admin)
        .post(`/v2/flows/${web}/widget/assets/${slot}`)
        .attach('file', buf, { filename: name, contentType: type });
    const logo = await put('logo', svg, 'logo.svg', 'image/svg+xml');
    expect(logo.status, JSON.stringify(logo.body)).toBe(201);
    expect((await put('avatar', gif, 'bot.gif', 'image/gif')).status).toBe(201);
    expect((await put('background', svg, 'bg.svg', 'image/svg+xml')).status).toBe(201);
    const served = await api.http().get(new URL(logo.body.url as string).pathname);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toContain('image/svg+xml');
    expect(served.headers['content-security-policy']).toContain("default-src 'none'");
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    const bad = await put(
      'logo',
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="x()"/>'),
      'x.svg',
      'image/svg+xml',
    );
    expect(bad.status).toBe(422);
  });

  it('saves the new button options with the widget: bot name, sub-header, button text, popup and animation', async () => {
    const wa = await bot('chat', 'WhatsApp options');
    const launcher = {
      botName: 'Acme help',
      subHeader: 'We reply fast',
      ctaText: 'Chat now',
      popup: { enabled: true, position: 'side', text: 'Need a hand?', image: '' },
      animation: 'ripple',
    };
    const saved = await api
      .as(t.admin)
      .put(`/v2/flows/${wa}/widget`)
      .send(look({ targetWhatsappCc: '+91', targetWhatsappNumber: '9876543210', launcher }));
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.launcher).toMatchObject(launcher);
    // Too long for the limits is refused.
    const bad = await api
      .as(t.admin)
      .put(`/v2/flows/${wa}/widget`)
      .send(
        look({
          targetWhatsappCc: '+91',
          targetWhatsappNumber: '9876543210',
          rowVersion: saved.body.rowVersion,
          launcher: { ...launcher, botName: 'x'.repeat(25) },
        }),
      );
    expect(bad.status).toBe(422);
    // The script a site loads draws them.
    const script = await api.pub(saved.body.embedToken as string).embed();
    expect(script.text).toContain('Acme help');
    expect(script.text).toContain('Need a hand?');
    expect(script.text).toContain('Chat now');
    expect(script.text).toContain('ripple');
  });

  it('does not hold back publishing a WhatsApp bot through the API (the builders ask for the button, imports and automation do not)', async () => {
    const wa = await bot('chat', 'WhatsApp no button');
    const live = await api.as(t.admin).post(`/v2/flows/${wa}/publish`).send({});
    expect(live.status, JSON.stringify(live.body)).toBe(200);
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

  it('serves the two previews the Customize tab frames, for a website chat bot only', async () => {
    const web = await bot('web', 'Preview bot');
    const chatPage = await api.as(t.admin).get(`/v2/flows/${web}/widget/preview-page`);
    expect(chatPage.status).toBe(200);
    expect(chatPage.body.html).toContain('var PREVIEW = true;');
    expect(chatPage.body.html).toContain('var FLOW = true;');

    const closed = await api
      .as(t.admin)
      .post(`/v2/flows/${web}/widget/preview-embed`)
      .send({
        launcher: {
          popup: { enabled: true, style: 'pill', text: 'Need </script><b>help</b>?' },
          animation: 'ripple',
        },
        buttonColor: '#123456',
        position: 'bottom_left',
      });
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    const html = closed.body.html as string;
    // The author's text rides as data inside the script and can never close it.
    expect(html).not.toContain('Need </script>');
    expect(html).toContain('wgtRipple');
    expect(html).toContain('#123456');
    expect((html.match(/<script>/g) ?? []).length).toBe(1);

    // A WhatsApp bot has no chat window to preview.
    const wa = await bot('chat', 'Preview WhatsApp bot');
    expect((await api.as(t.admin).get(`/v2/flows/${wa}/widget/preview-page`)).status).toBe(200);
  });

  it("saves a website bot's notification cards, quick menu, banner and appearance extras, and the public config carries them", async () => {
    const web = await bot('web', 'Conversation tools');
    const chat = {
      notice: {
        enabled: true,
        icon: 2,
        items: [
          {
            title: 'Sale',
            description: 'Ends Friday',
            buttonTitle: 'Shop',
            buttonUrl: 'https://example.com/sale',
            footer: 'T&C',
          },
        ],
      },
      quickMenu: {
        enabled: true,
        view: 'blocks',
        items: [
          { title: 'Track order', url: '' },
          { title: 'Mail us', url: 'mailto:help@example.com' },
        ],
      },
      banners: {
        enabled: true,
        items: [{ kind: 'video', video: 'https://www.youtube.com/embed/dQw4w9WgXcQ' }],
      },
      fontSize: 16,
      hoverBg: '#aabbcc',
      soundVolume: 40,
      speak: true,
      devices: { desktop: true, tablet: false, mobile: true },
      autoOpen: 5,
    };
    const saved = await api
      .as(t.admin)
      .put(`/v2/flows/${web}/widget`)
      .send(look({ launcher: { chat } }));
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.launcher.chat).toMatchObject(chat);

    // The websites the chat may show on are kept, normalised, and a save that leaves them out keeps them.
    const restricted = await api
      .as(t.admin)
      .put(`/v2/flows/${web}/widget`)
      .send(
        look({
          rowVersion: saved.body.rowVersion,
          launcher: { chat },
          allowedDomains: ['Example.COM/path', 'shop.example.com'],
        }),
      );
    expect(restricted.status, JSON.stringify(restricted.body)).toBe(200);
    expect(restricted.body.allowedDomains).toEqual(['example.com', 'shop.example.com']);
    const kept = await api
      .as(t.admin)
      .put(`/v2/flows/${web}/widget`)
      .send(look({ rowVersion: restricted.body.rowVersion, launcher: { chat } }));
    expect(kept.body.allowedDomains).toEqual(['example.com', 'shop.example.com']);
    const cleared = await api
      .as(t.admin)
      .put(`/v2/flows/${web}/widget`)
      .send(look({ rowVersion: kept.body.rowVersion, launcher: { chat }, allowedDomains: [] }));
    expect(cleared.body.allowedDomains).toEqual([]);

    const bad = await api
      .as(t.admin)
      .put(`/v2/flows/${web}/widget`)
      .send(
        look({
          rowVersion: cleared.body.rowVersion,
          launcher: {
            chat: {
              notice: {
                items: [{ title: 'a', description: 'b', buttonUrl: 'javascript:alert(1)' }],
              },
            },
          },
        }),
      );
    expect(bad.status).toBe(422);

    const pub = api.pub(saved.body.embedToken as string);
    const cfg = await pub.config();
    expect(cfg.status).toBe(200);
    expect(cfg.body.widget.launcher.chat).toMatchObject(chat);

    // The loader keeps the widget off a tablet and opens the window by itself after the delay.
    const script = await pub.embed();
    expect(script.text).toContain('"tablet":false');
    expect(script.text).toContain('5000');
  });
});
