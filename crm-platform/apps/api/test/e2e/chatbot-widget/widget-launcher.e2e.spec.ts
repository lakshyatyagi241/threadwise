import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WidgetApi, startHarness, widgetBody, type Harness, type Tenant } from './support';

/**
 * WD-WGT-028: the WhatsApp widget's look and placement, one `launcher` object (user-requested Interakt reference): stored
 * as one jsonb value, validated on every write, resolved into the public config and drawn by the embed script.
 */
let h: Harness;
let api: WidgetApi;
let t: Tenant;

beforeAll(async () => {
  h = await startHarness();
  api = new WidgetApi(h);
  t = await api.signup('wgl');
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

const DEFAULTS = {
  buttonType: 'pill',
  colour: 'original',
  avatar: 'preset:support',
  greeting: 'HI THERE!',
  introMessage: 'We are here to help you! Chat with us on WhatsApp for any queries.',
  desktop: { side: 'right', sideSpacing: 10, bottomSpacing: 10 },
  mobile: { side: 'right', sideSpacing: 10, bottomSpacing: 60 },
};
const launcher = (over: Record<string, unknown> = {}) => ({ ...DEFAULTS, ...over });

describe('the stored config', () => {
  it('a widget saved without a launcher starts from the defaults (pill, the original green, HI THERE!, 10/10 and 10/60)', async () => {
    const w = await api.widget(t.admin, { name: 'Defaults' });
    expect(w.launcher).toEqual(DEFAULTS);
    const row = await h.owner.query(
      `SELECT launcher FROM chatbot_widgets WHERE org_id = $1 AND uuid = $2`,
      [t.orgId, w.id],
    );
    expect(row.rows[0].launcher).toEqual({});
  });

  it('round-trips through create, read and update, and is stored as one object', async () => {
    const custom = launcher({
      buttonType: 'icon',
      colour: 'blue-lagoon',
      avatar: 'preset:store',
      greeting: 'Hello!',
      introMessage: 'Ask us anything.',
      desktop: { side: 'left', sideSpacing: 24, bottomSpacing: 32 },
      mobile: { side: 'left', sideSpacing: 4, bottomSpacing: 80 },
    });
    const w = await api.widget(t.admin, { name: 'Round trip', launcher: custom });
    expect(w.launcher).toEqual(custom);
    const got = await api.as(t.admin).get(`/v2/widgets/${w.id}`);
    expect(got.body.launcher).toEqual(custom);
    const row = await h.owner.query(
      `SELECT launcher FROM chatbot_widgets WHERE org_id = $1 AND uuid = $2`,
      [t.orgId, w.id],
    );
    expect(row.rows[0].launcher).toEqual(custom);

    const next = launcher({ greeting: 'Hey you', colour: '#336699' });
    const upd = await api
      .as(t.admin)
      .patch(`/v2/widgets/${w.id}`)
      .send({ ...widgetBody({ name: 'Round trip', launcher: next }), rowVersion: w.rowVersion });
    expect(upd.status, JSON.stringify(upd.body)).toBe(200);
    expect(upd.body.launcher).toEqual(next);
  });

  it('an update that does not send a launcher leaves the stored one alone', async () => {
    const custom = launcher({ greeting: 'Keep me', colour: 'dark-night' });
    const w = await api.widget(t.admin, { name: 'Keeps', launcher: custom });
    const upd = await api
      .as(t.admin)
      .patch(`/v2/widgets/${w.id}`)
      .send({ ...widgetBody({ name: 'Keeps renamed' }), rowVersion: w.rowVersion });
    expect(upd.status).toBe(200);
    expect(upd.body.launcher).toEqual(custom);
  });

  it('an omitted key of a partial launcher takes its default', async () => {
    const w = await api.widget(t.admin, {
      name: 'Partial',
      launcher: { greeting: 'Only this', mobile: { bottomSpacing: 100 } },
    });
    expect(w.launcher).toEqual(
      launcher({
        greeting: 'Only this',
        mobile: { side: 'right', sideSpacing: 10, bottomSpacing: 100 },
      }),
    );
  });

  it('a row whose stored launcher is partial reads the defaults for the missing keys (a key added later needs no migration)', async () => {
    const w = await api.widget(t.admin, { name: 'Old row' });
    await h.owner.query(
      `UPDATE chatbot_widgets SET launcher = '{"greeting":"Stored"}'::jsonb WHERE org_id = $1 AND uuid = $2`,
      [t.orgId, w.id],
    );
    const got = await api.as(t.admin).get(`/v2/widgets/${w.id}`);
    expect(got.body.launcher).toEqual(launcher({ greeting: 'Stored' }));
  });

  it('the database only accepts an object (a list or a scalar is refused by the check)', async () => {
    const w = await api.widget(t.admin, { name: 'Shape' });
    await expect(
      h.owner.query(
        `UPDATE chatbot_widgets SET launcher = '[]'::jsonb WHERE org_id = $1 AND uuid = $2`,
        [t.orgId, w.id],
      ),
    ).rejects.toThrow(/chk_chatbot_widgets_launcher_object/);
  });

  it('a write that changes the launcher is audited with it', async () => {
    const w = await api.widget(t.admin, { name: 'Audited launcher' });
    await api
      .as(t.admin)
      .patch(`/v2/widgets/${w.id}`)
      .send({
        ...widgetBody({ name: 'Audited launcher', launcher: launcher({ greeting: 'Changed' }) }),
        rowVersion: w.rowVersion,
      });
    const res = await h.owner.query(
      `SELECT delta FROM audit_log WHERE org_id = $1 AND module = 'chatbot_widgets' AND action = 'update' ORDER BY id DESC LIMIT 1`,
      [t.orgId],
    );
    expect(res.rows[0].delta.launcher.new.greeting).toBe('Changed');
    expect(res.rows[0].delta.launcher.old.greeting).toBe('HI THERE!');
  });

  it('a duplicate carries the launcher', async () => {
    const custom = launcher({ greeting: 'Copy me', colour: 'purple-velvet' });
    const w = await api.widget(t.admin, { name: 'Original', launcher: custom });
    const copy = await api.as(t.admin).post(`/v2/widgets/${w.id}/duplicate`).send({});
    expect(copy.status, JSON.stringify(copy.body)).toBe(201);
    expect(copy.body.launcher).toEqual(custom);
  });
});

describe('validation', () => {
  const bad = async (over: Record<string, unknown>, path: string) => {
    const res = await api
      .as(t.admin)
      .post('/v2/widgets')
      .send(widgetBody({ launcher: over }));
    expect(res.status, path).toBe(422);
    expect(res.body.code, path).toBe('VALIDATION_FAILED');
    expect(
      res.body.errors.some((e: { path: string }) => e.path === path),
      `${path}: ${JSON.stringify(res.body.errors)}`,
    ).toBe(true);
  };

  it('refuses spacing that is negative, over 500, fractional or not a number', async () => {
    await bad({ desktop: { sideSpacing: -1 } }, 'launcher.desktop.sideSpacing');
    await bad({ desktop: { bottomSpacing: 501 } }, 'launcher.desktop.bottomSpacing');
    await bad({ mobile: { sideSpacing: 10.5 } }, 'launcher.mobile.sideSpacing');
    await bad({ mobile: { bottomSpacing: 'ten' } }, 'launcher.mobile.bottomSpacing');
  });

  it('refuses an unknown side, button type, colour or image', async () => {
    await bad({ desktop: { side: 'top' } }, 'launcher.desktop.side');
    await bad({ buttonType: 'square' }, 'launcher.buttonType');
    await bad({ colour: 'not-a-colour' }, 'launcher.colour');
    await bad({ colour: '#12' }, 'launcher.colour');
    await bad({ avatar: 'javascript:alert(1)' }, 'launcher.avatar');
    await bad({ avatar: 'preset:nope' }, 'launcher.avatar');
  });

  it('refuses an empty or over-long greeting and intro message', async () => {
    await bad({ greeting: '' }, 'launcher.greeting');
    await bad({ greeting: 'x'.repeat(61) }, 'launcher.greeting');
    await bad({ introMessage: '   ' }, 'launcher.introMessage');
    await bad({ introMessage: 'x'.repeat(501) }, 'launcher.introMessage');
  });

  it('accepts the edges: 0 and 500 px, a three-digit hex colour and an https image address', async () => {
    const w = await api.widget(t.admin, {
      name: 'Edges',
      launcher: launcher({
        colour: '#abc',
        avatar: 'https://cdn.example.com/logo.png',
        desktop: { side: 'right', sideSpacing: 0, bottomSpacing: 500 },
      }),
    });
    expect(w.launcher).toMatchObject({
      colour: '#abc',
      avatar: 'https://cdn.example.com/logo.png',
      desktop: { sideSpacing: 0, bottomSpacing: 500 },
    });
  });
});

describe('the public side', () => {
  it('the public config carries the resolved launcher: gradient ends, an image the page can show, the texts and both placements', async () => {
    const w = await api.widget(t.admin, {
      name: 'Public config',
      launcher: launcher({
        colour: 'teal-deal',
        greeting: 'Welcome in',
        introMessage: 'Line one\nLine two',
        desktop: { side: 'left', sideSpacing: 12, bottomSpacing: 14 },
      }),
    });
    const res = await api.pub(w.embedToken).config();
    expect(res.status).toBe(200);
    const l = res.body.widget.launcher;
    expect(l.button_type).toBe('pill');
    expect(l.colour).toEqual({ key: 'teal-deal', from: '#2DD4BF', to: '#0F766E' });
    expect(l.avatar_url).toMatch(/^data:image\/svg\+xml/);
    expect(l.greeting).toBe('Welcome in');
    expect(l.intro_message).toBe('Line one\nLine two');
    expect(l.desktop).toEqual({ side: 'left', side_spacing: 12, bottom_spacing: 14 });
    expect(l.mobile).toEqual({ side: 'right', side_spacing: 10, bottom_spacing: 60 });
  });

  it('a custom hex colour resolves to itself and a darker end', async () => {
    const w = await api.widget(t.admin, {
      name: 'Custom colour',
      launcher: launcher({ colour: '#336699' }),
    });
    const l = (await api.pub(w.embedToken).config()).body.widget.launcher;
    expect(l.colour.key).toBeNull();
    expect(l.colour.from).toBe('#336699');
    expect(l.colour.to).toMatch(/^#[0-9A-F]{6}$/);
    expect(l.colour.to).not.toBe('#336699');
  });

  it('the embed script of a WhatsApp widget draws the launcher and the panel (no frame); Start Conversation opens wa.me with the pre-filled message', async () => {
    const w = await api.widget(t.admin, {
      name: 'Acme Shop',
      targetWhatsappCc: '+91',
      targetWhatsappNumber: '9876543210',
      prefilledMessage: 'Hi there, I need help',
      launcher: launcher({
        greeting: 'Namaste!',
        introMessage: 'We reply fast.',
        desktop: { side: 'left', sideSpacing: 20, bottomSpacing: 30 },
      }),
    });
    const res = await api.pub(w.embedToken).embed();
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('iframe');
    expect(res.text).toContain('Namaste!');
    expect(res.text).toContain('We reply fast.');
    expect(res.text).toContain('Acme Shop');
    expect(res.text).toContain('Typically replies within 5 mins');
    expect(res.text).toContain('Start Conversation');
    expect(res.text).toContain('https://wa.me/919876543210?text=Hi+there%2C+I+need+help');
    expect(res.text).toContain('"side":"left","s":20,"b":30');
    expect(res.text).toContain('(max-width: 768px)');
    // it is a complete program
    expect(() => new Function(res.text)).not.toThrow();
  });

  it('a WhatsApp widget with no number still draws, with Start Conversation disabled (no link)', async () => {
    const w = await api.widget(t.admin, {
      name: 'No number',
      targetWhatsappCc: null,
      targetWhatsappNumber: null,
    });
    const res = await api.pub(w.embedToken).embed();
    expect(res.text).toContain('"wa":null');
  });

  it('AI and Both widgets keep the frame loader (the panel is the WhatsApp widget only)', async () => {
    const a = await api.assistant(t);
    const w = await api.widget(t.admin, { name: 'AI loader', mode: 'ai', assistantId: a.uuid });
    const res = await api.pub(w.embedToken).embed();
    expect(res.text).toContain("createElement('iframe')");
    expect(res.text).not.toContain('Start Conversation');
  });

  it('saved text cannot break out of the script or the page: markup and script endings stay inert', async () => {
    const evil = '</script><img src=x onerror=alert(1)>';
    const w = await api.widget(t.admin, {
      name: evil,
      launcher: launcher({ greeting: evil, introMessage: evil }),
    });
    const res = await api.pub(w.embedToken).embed();
    expect(res.text).not.toContain('</script>');
    expect(res.text).not.toContain('<img');
    expect(res.text).toContain('\\u003c/script>');
    expect(() => new Function(res.text)).not.toThrow();
  });
});
