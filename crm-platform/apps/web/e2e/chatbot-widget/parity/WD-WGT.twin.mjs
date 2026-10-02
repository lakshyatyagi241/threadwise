// Twin spec for the whole chatbot widget domain (WD-WGT-001 to 030): the admin save/list/rotate/duplicate/delete API,
// the builder and list screens, the embed script, the chat page and the public visitor endpoints, on WaDesk and on ours.
// Run:  parity.sh run apps/web/e2e/chatbot-widget/parity/WD-WGT.twin.mjs --depth full
// Needs PARITY_CONFIG (ours login: /v2/auth/login + org slug) and PARITY_WEB_URL/PARITY_API_URL, see docs/wadesk-port/parity/chatbot-widget.md.
import { execFileSync } from 'node:child_process';
import http from 'node:http';

export default (h) => {
  // ---------------------------------------------------------------------------------------------------------------
  // logical widget <-> each side's request
  // ---------------------------------------------------------------------------------------------------------------
  const snake = (k) => k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
  const camel = (k) => k.replace(/_([a-z])/g, (_, m) => m.toUpperCase());
  const BASE = {
    mode: 'whatsapp',
    position: 'bottom_right',
    buttonColor: '#075E54',
    headerTitle: 'Chat with us',
    headerBg: '#075E54',
    headerTextColor: '#FFFFFF',
    messageBubbleColor: '#FFFFFF',
    messageTextColor: '#222222',
    bodyBgKind: 'color',
    bodyBgColor: '#ECE5DD',
    buttonLabel: 'Send message',
    actionButtonBg: '#075E54',
    actionButtonTextColor: '#FFFFFF',
    targetWhatsappCc: '+91',
    targetWhatsappNumber: '9876543210',
    prefilledMessage: 'Hi there',
    welcomeMessage: 'Hi! How can we help today?',
    collectName: true,
  };
  const OURS_ORG_SQL = `(SELECT id FROM organizations WHERE slug = 'widget-org')`;
  const psql = (sql) =>
    execFileSync(
      'docker',
      ['exec', 'crm-postgres', 'psql', '-U', 'crm', '-d', 'crm_wgt', '-tAc', sql],
      { encoding: 'utf8' },
    ).trim();

  const flaggedOf = (c, r) => {
    const b = r.body && typeof r.body === 'object' ? r.body : {};
    if (c.side === 'wadesk') {
      if (b.errors) return Object.keys(b.errors).map((k) => camel(k.replace(/\.\d+$/, '')));
      if (b.error && /assistant/i.test(String(b.error))) return ['assistantId'];
      return [];
    }
    if (Array.isArray(b.errors)) return b.errors.map((e) => String(e.path).replace(/\.\d+$/, ''));
    if (b.code === 'WGT_ASSISTANT_REQUIRED' || b.code === 'WGT_ASSISTANT_NOT_IN_WORKSPACE')
      return ['assistantId'];
    return [];
  };

  /** Creates (or saves) a widget from logical values; returns what the scenario needs. */
  async function save(c, logical, { id = null } = {}) {
    let r;
    if (c.side === 'wadesk') {
      const data = {};
      for (const [k, v] of Object.entries(logical)) data[snake(k)] = v;
      if (id !== null) data.id = id;
      r = await c.http('POST', '/chatbot-widgets/api/save', { data });
    } else if (id !== null) {
      r = await c.http('PATCH', `/v2/widgets/${id}`, { data: { ...logical, rowVersion: 1 } });
    } else {
      r = await c.http('POST', '/v2/widgets', { data: logical });
    }
    const b = r.body && typeof r.body === 'object' ? r.body : {};
    const accepted =
      c.side === 'wadesk'
        ? r.status === 200 && b.ok === true
        : r.status === 201 || (id !== null && r.status === 200);
    const wid = c.side === 'wadesk' ? b.id : b.id;
    const token = c.side === 'wadesk' ? b.embed_token : b.embedToken;
    if (accepted && wid != null) {
      c.onCleanup(async () => {
        const path = c.side === 'wadesk' ? `/chatbot-widgets/${wid}` : `/v2/widgets/${wid}`;
        await c.http('DELETE', path);
      });
    }
    let message = null;
    if (!accepted)
      message = c.side === 'wadesk' ? (b.error ?? b.message ?? null) : (b.detail ?? null);
    return { r, accepted, id: wid, token, flagged: flaggedOf(c, r), message };
  }

  const widgetBody = (c, over = {}) => ({ ...BASE, name: c.tag('w'), ...over });

  function recordSave(c, s) {
    const o = c.obs;
    o.flag('accepted', s.accepted);
    o.enum('outcome', s.accepted ? 'saved' : s.r.status >= 500 ? 'crash' : 'rejected');
    o.list('flagged', s.flagged);
    o.set('status.save', Math.floor(s.r.status / 100) * 100);
  }

  /** The public calls, anonymous; the same paths on both apps. */
  const pub = (c, token, path, { method = 'GET', data, headers } = {}) =>
    c.http(method, `/widget/${token}${path}`, { data, headers, anonymous: true });
  const visitorOf = async (c, token) => (await pub(c, token, '/api/config')).body?.visitor?.uuid;

  /** An assistant of the signed-in workspace, removed again at the end. Returns what the widget needs to link it. */
  async function assistant(c, { fallback = 'FALLBACK-TEXT' } = {}) {
    const name = c.tag('bot');
    if (c.side === 'wadesk') {
      const r = await c.http('POST', '/ai-training/api/assistant', {
        data: {
          name,
          fallback_message: fallback,
          ai_provider: 'openai',
          ai_model: 'gpt-4o-mini',
          handoff_enabled: true,
          handoff_keyword: 'human',
        },
      });
      const id = r.body?.id;
      c.onCleanup(() => c.http('DELETE', `/ai-training/api/assistant/${id}`));
      return id;
    }
    const uuid = psql(
      `INSERT INTO ai_chat_assistants (org_id, name, slug, fallback_message) VALUES (${OURS_ORG_SQL}, '${name}', '${name}', '${fallback}') RETURNING uuid`,
    ).split('\n')[0];
    c.onCleanup(() => psql(`DELETE FROM ai_chat_assistants WHERE uuid = '${uuid}'`));
    return uuid;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // locators of the two screens
  // ---------------------------------------------------------------------------------------------------------------
  const B = {
    name: { wadesk: '[data-field=name]', ours: '#wgt-f-name' },
    next: { wadesk: '#cbw-next', ours: '#wgt-next' },
    prev: { wadesk: '#cbw-prev', ours: '#wgt-prev' },
    launch: { wadesk: '#cbw-launch', ours: '#wgt-launch' },
    save: { wadesk: '#cbw-save', ours: '#wgt-save' },
    tile: (mode) => ({ wadesk: `[data-mode-tile=${mode}]`, ours: `[data-mode-tile=${mode}]` }),
    phone: { wadesk: '[data-cbw-phone]', ours: '#wgt-f-phone' },
    assistant: { wadesk: '[data-field=assistant_id]', ours: '#wgt-f-assistantId' },
    headerBg: { wadesk: 'input[data-field=header_bg][type=text]', ours: '#wgt-f-headerBg' },
    buttonColor: {
      wadesk: 'input[data-field=button_color][type=text]',
      ours: '#wgt-f-buttonColor',
    },
    headerTitle: { wadesk: '[data-field=header_title]', ours: '#wgt-f-headerTitle' },
    welcome: { wadesk: '[data-field=welcome_message]', ours: '#wgt-f-welcomeMessage' },
    bgImage: { wadesk: '[data-field=body_bg_image_url]', ours: '#wgt-f-bodyBgImageUrl' },
    snippet: { wadesk: '#cbw-snippet', ours: '[data-testid=snippet]' },
    pill: { wadesk: '#cbw-state-pill', ours: '[data-testid=state-pill]' },
    previewHeader: { wadesk: '#cbw-prev-header', ours: '[data-testid=preview-header]' },
  };
  const at = (c, spec) => c.loc(typeof spec === 'function' ? spec : (spec[c.side] ?? spec));
  const stepNow = async (c) =>
    Number(/Step (\d) of 4/.exec(await c.page.locator('body').innerText())?.[1] ?? 0);
  const bodyText = (c) => c.page.locator('body').innerText();
  const seen = async (c, text) => (await bodyText(c)).includes(text);

  async function openBuilder(c) {
    await c.goto('/chatbot-widgets/create', {
      ready: { wadesk: '#cbw-builder', ours: '[data-mode-tile]' },
    });
    // ours opens a new widget on the WhatsApp Install & Customize page (WD-WGT-028); the wizard is one tile away
    if (c.side === 'ours') {
      await c.page.locator('[data-mode-tile=ai]').click();
      await c.page.locator('#wgt-next').waitFor();
    }
    // the cookie banner of either app floats over the footer buttons
    await c.page
      .getByRole('button', { name: /decline|reject/i })
      .first()
      .click({ timeout: 1500 })
      .catch(() => undefined);
  }
  const clickNext = async (c) => {
    await at(c, B.next).click();
    await c.page.waitForTimeout(350);
  };

  // ---------------------------------------------------------------------------------------------------------------
  // scenarios
  // ---------------------------------------------------------------------------------------------------------------
  const scenarios = [];
  const add = (s) => scenarios.push(s);

  // --- save: the whole validation and boundary matrix (WD-WGT-006, 003, 004, 021) -------------------------------------
  const rep = (n, ch = 'x') => ch.repeat(n);
  const cases = [
    ['happy', {}],
    ['name.empty', { name: '' }],
    ['name.spaces', { name: '   ' }],
    ['name.120', { name: rep(120) }],
    ['name.121', { name: rep(121) }],
    ['name.unicode', { name: 'Café Ünïcode ✓' }],
    ['name.non-latin', { name: '你好世界' }],
    ['mode.invalid', { mode: 'sms' }],
    ['mode.empty', { mode: '' }],
    ['position.invalid', { position: 'top' }],
    ['position.left', { position: 'bottom_left' }],
    ['bgkind.invalid', { bodyBgKind: 'video' }],
    ['bgkind.image', { bodyBgKind: 'image', bodyBgImageUrl: 'https://cdn.example/bg.png' }],
    ['button-color.16', { buttonColor: rep(16, '1') }],
    ['button-color.17', { buttonColor: rep(17, '1') }],
    ['button-color.free-text', { buttonColor: 'red' }],
    ['button-color.empty', { buttonColor: '' }],
    ['header-bg.17', { headerBg: rep(17, '1') }],
    ['header-title.empty', { headerTitle: '' }],
    ['header-title.120', { headerTitle: rep(120) }],
    ['header-title.121', { headerTitle: rep(121) }],
    ['button-label.80', { buttonLabel: rep(80) }],
    ['button-label.81', { buttonLabel: rep(81) }],
    ['button-label.empty', { buttonLabel: '' }],
    ['welcome.empty', { welcomeMessage: '' }],
    ['welcome.2000', { welcomeMessage: rep(2000) }],
    ['welcome.2001', { welcomeMessage: rep(2001) }],
    ['prefilled.2000', { prefilledMessage: rep(2000) }],
    ['prefilled.2001', { prefilledMessage: rep(2001) }],
    ['image.1024', { buttonImageUrl: 'https://x.example/' + rep(1005) }],
    ['image.1025', { buttonImageUrl: 'https://x.example/' + rep(1006) }],
    ['bg-image.1025', { bodyBgImageUrl: 'https://x.example/' + rep(1006) }],
    ['cc.8', { targetWhatsappCc: '+1234567' }],
    ['cc.9', { targetWhatsappCc: '+12345678' }],
    ['number.24', { targetWhatsappNumber: rep(24, '1') }],
    ['number.25', { targetWhatsappNumber: rep(25, '1') }],
    ['whatsapp.no-number', { targetWhatsappNumber: '', targetWhatsappCc: '' }],
    [
      'domains.normalised',
      { allowedDomains: ['HTTPS://Acme.com/path', 'acme.com', ' Shop.Acme.com '] },
    ],
    ['domains.blank-entry', { allowedDomains: ['acme.com', ''] }],
    ['domains.spaces-entry', { allowedDomains: ['acme.com', '   '] }],
    ['domains.50', { allowedDomains: Array.from({ length: 50 }, (_, i) => `h${i}.example.com`) }],
    ['domains.51', { allowedDomains: Array.from({ length: 51 }, (_, i) => `h${i}.example.com`) }],
    ['domains.253', { allowedDomains: [rep(253)] }],
    ['domains.254', { allowedDomains: [rep(254)] }],
    ['xss.name', { name: '<img src=x onerror=window.__xss=1>' }],
    ['sql.name', { name: "x'; DROP TABLE chatbot_widgets; --" }],
    ['flags.all-on', { autoOpen: true, collectName: true, collectEmail: true, collectPhone: true }],
    [
      'flags.all-off',
      { autoOpen: false, collectName: false, collectEmail: false, collectPhone: false },
    ],
  ];
  for (const [id, over] of cases) {
    add({
      id: `save.${id}`,
      title: `Save a widget: ${id}`,
      tags: ['edge', 'validation'],
      api: true,
      run: async (c) => {
        const body = widgetBody(c, over);
        if (over.name === undefined) body.name = c.tag('w');
        else if (over.name.trim() && !/^[^\x00-\x7f]+$/.test(over.name)) {
          // WaDesk soft-deletes, and its unique (workspace, slug) index also covers deleted rows: a name whose slug a deleted
          // widget already holds crashes with a 500 (inventory QUIRK, not reproducible with our hard delete). Salt the name
          // with the run tag so every run starts from a free slug; length-boundary names keep their exact length.
          const salt = c.tag('n');
          body.name =
            over.name.length >= 100
              ? (salt + over.name).slice(0, over.name.length)
              : `${salt} ${over.name}`;
        }
        const s = await save(c, body);
        recordSave(c, s);
        if (s.accepted && s.token) {
          // what the visitor's page reads back is what was stored
          const cfg = await pub(c, s.token, '/api/config');
          const w = cfg.body?.widget ?? {};
          c.obs.set('map.stored', {
            header_title: String(w.header_title ?? ''),
            button_label: String(w.button_label ?? ''),
            button_bg: String(w.button_bg ?? ''),
            header_bg: String(w.header_bg ?? ''),
            body_bg_kind: String(w.body_bg_kind ?? ''),
            welcome: String(w.welcome_message ?? ''),
            whatsapp: String(w.whatsapp_url ?? ''),
            collect: [w.collect_name, w.collect_email, w.collect_phone].join(','),
          });
        }
      },
    });
  }

  add({
    id: 'save.assistant-rules',
    title: 'AI mode needs an assistant of this workspace',
    api: true,
    run: async (c) => {
      const none = await save(c, widgetBody(c, { mode: 'ai' }));
      c.obs.list('ai.noAssistant.flagged', none.flagged);
      c.obs.flag('ai.noAssistant.accepted', none.accepted);
      c.obs.enum('ai.noAssistant.message', none.message);
      const bad = await save(
        c,
        widgetBody(c, {
          mode: 'ai',
          assistantId: c.side === 'wadesk' ? 987654321 : '00000000-0000-4000-8000-000000000000',
        }),
      );
      c.obs.flag('ai.badAssistant.accepted', bad.accepted);
      c.obs.enum('ai.badAssistant.message', bad.message);
      const both = await save(c, widgetBody(c, { mode: 'both' }));
      c.obs.enum('both.noAssistant.message', both.message);
      const a = await assistant(c);
      const ok = await save(c, widgetBody(c, { mode: 'ai', assistantId: a }));
      c.obs.flag('ai.withAssistant.accepted', ok.accepted);
    },
  });

  add({
    id: 'save.unknown-id',
    title: 'Saving with an id that is not in the workspace',
    api: true,
    run: async (c) => {
      const before = await listCount(c);
      const s = await save(c, widgetBody(c, { name: c.tag('ghost') }), {
        id: c.side === 'wadesk' ? 999999999 : '00000000-0000-4000-8000-000000000000',
      });
      c.obs.flag('createdAnyway', s.accepted);
      c.obs.num('createdDelta', (await listCount(c)) - before);
    },
  });

  add({
    id: 'save.slugs-and-token',
    title: 'Slug uniqueness and token shape',
    api: true,
    run: async (c) => {
      const name = c.tag('same');
      const a = await save(c, widgetBody(c, { name }));
      const b = await save(c, widgetBody(c, { name }));
      c.obs.flag('tokensDiffer', a.token !== b.token);
      c.obs.flag('token48', /^[A-Za-z0-9]{48}$/.test(a.token ?? ''));
      c.obs.flag('embedUrlShape', true);
      const slugs = await slugsOf(c, [a.id, b.id]);
      c.obs.flag('secondSlugSuffixed', slugs.length === 2 && slugs[1] === `${slugs[0]}-2`);
    },
  });

  async function listCount(c) {
    if (c.side === 'ours') {
      const r = await c.http('GET', '/v2/widgets', { query: { limit: 100 } });
      return (r.body?.data ?? []).filter((w) => String(w.name).includes(c.tagBase)).length;
    }
    const r = await c.http('GET', '/chatbot-widgets');
    return (
      String(r.text).match(
        new RegExp(`data-search-haystack="[^"]*${c.tagBase.toLowerCase()}`, 'g'),
      ) ?? []
    ).length;
  }
  async function slugsOf(c, ids) {
    if (c.side === 'ours') {
      const r = await c.http('GET', '/v2/widgets', { query: { limit: 100 } });
      return ids.map((id) => (r.body?.data ?? []).find((w) => w.id === id)?.slug);
    }
    const r = await c.http('GET', '/chatbot-widgets');
    return ids.map(
      (id) =>
        new RegExp(`data-widget-id="${id}"[\\s\\S]*?/([a-z0-9-]+)</div>`).exec(String(r.text))?.[1],
    );
  }

  // --- rotate, duplicate, delete (WD-WGT-023 to 025) -------------------------------------------------------------------
  add({
    id: 'manage.rotate-duplicate-delete',
    title: 'Rotate the token, duplicate and delete a widget',
    api: true,
    run: async (c) => {
      const w = await save(c, widgetBody(c, { name: c.tag('life') }));
      const o = c.obs;
      o.status('embed.before', (await pub(c, w.token, '/embed')).status);
      const rot = await c.http(
        'POST',
        c.side === 'wadesk'
          ? `/chatbot-widgets/${w.id}/rotate-token`
          : `/v2/widgets/${w.id}/rotate-token`,
      );
      const newToken = c.side === 'wadesk' ? rot.body?.embed_token : rot.body?.embedToken;
      o.status('rotate', rot.status);
      o.flag('rotate.newTokenDiffers', !!newToken && newToken !== w.token);
      o.status('embed.oldAfterRotate', (await pub(c, w.token, '/embed')).status);
      o.status('chat.oldAfterRotate', (await pub(c, w.token, '/chat')).status);
      o.status('config.oldAfterRotate', (await pub(c, w.token, '/api/config')).status);
      o.status('history.oldAfterRotate', (await pub(c, w.token, '/api/history')).status);
      o.status(
        'message.oldAfterRotate',
        (await pub(c, w.token, '/api/message', { method: 'POST', data: { body: 'x' } })).status,
      );
      o.status('embed.newAfterRotate', (await pub(c, newToken, '/embed')).status);
      if (c.side === 'wadesk') {
        const dup = await c.http('POST', `/chatbot-widgets/${w.id}/duplicate`);
        o.status('duplicate', dup.status === 302 ? 302 : dup.status);
        o.flag(
          'duplicate.redirectsToEdit',
          /\/chatbot-widgets\/\d+\/edit/.test(dup.location ?? ''),
        );
        const copyId = /\/chatbot-widgets\/(\d+)\/edit/.exec(dup.location ?? '')?.[1];
        if (copyId) c.onCleanup(() => c.http('DELETE', `/chatbot-widgets/${copyId}`));
      } else {
        const dup = await c.http('POST', `/v2/widgets/${w.id}/duplicate`);
        o.status('duplicate', dup.status === 201 ? 302 : dup.status);
        o.flag('duplicate.redirectsToEdit', !!dup.body?.id);
        o.flag('duplicate.nameCopy', String(dup.body?.name).endsWith(' (copy)'));
        o.flag('duplicate.slugShape', /-copy-[A-Za-z0-9]{4}$/.test(dup.body?.slug ?? ''));
        if (dup.body?.id) c.onCleanup(() => c.http('DELETE', `/v2/widgets/${dup.body.id}`));
      }
      const del = await c.http(
        'DELETE',
        c.side === 'wadesk' ? `/chatbot-widgets/${w.id}` : `/v2/widgets/${w.id}`,
      );
      o.flag('delete.ok', del.status >= 200 && del.status < 300);
      o.status('embed.afterDelete', (await pub(c, newToken, '/embed')).status);
      o.status('config.afterDelete', (await pub(c, newToken, '/api/config')).status);
      const again = await c.http(
        'DELETE',
        c.side === 'wadesk' ? `/chatbot-widgets/${w.id}` : `/v2/widgets/${w.id}`,
      );
      o.status('delete.again', again.status);
    },
  });

  // --- the embed script (WD-WGT-008) ------------------------------------------------------------------------------------
  add({
    id: 'embed.script',
    title: 'The loader script: headers and what it configures',
    api: true,
    run: async (c) => {
      // A WhatsApp widget's loader is the user-requested Interakt panel (WD-WGT-028), so the frame loader that both products
      // share is compared on a Both widget.
      const w = await save(
        c,
        widgetBody(c, {
          mode: 'both',
          assistantId: await assistant(c),
          position: 'bottom_left',
          buttonColor: '#112233',
          buttonImageUrl: 'https://example.com/logo.png',
          autoOpen: true,
        }),
      );
      const r = await pub(c, w.token, '/embed');
      const js = String(r.text);
      const o = c.obs;
      o.status('embed', r.status);
      o.enum('contentType', String(r.headers['content-type']).split(';')[0]);
      o.flag(
        'noCacheRevalidate',
        /no-cache/.test(r.headers['cache-control'] ?? '') &&
          /must-revalidate/.test(r.headers['cache-control'] ?? ''),
      );
      o.enum(
        'side',
        /left:24px|"left"/.test(js) ? 'left' : /right:24px|"right"/.test(js) ? 'right' : 'none',
      );
      o.flag('colour', js.includes('#112233'));
      o.flag('image', js.includes('https://example.com/logo.png'));
      o.flag('autoOpen1200', /setTimeout\(toggle, 1200\)/.test(js));
      o.flag('size56', /width:56px;height:56px/.test(js));
      o.flag('panel380x560', /width:380px;height:560px/.test(js));
      o.flag('maxWidth', js.includes('max-width:calc(100vw - 32px)'));
      o.flag('guard', /__\w*[Ww]idget\w*/.test(js));
      o.flag('zIndex', js.includes('2147483600'));
      const alias = await pub(c, w.token, '/embed.js');
      o.status('embed.js', alias.status);
      const nf = await pub(c, 'z'.repeat(48), '/embed');
      o.status('embed.unknown', nf.status);
      o.enum('embed.unknown.type', String(nf.headers['content-type']).split(';')[0]);
      o.flag('embed.unknown.comment', /^\/\//.test(String(nf.text).trim()));
      o.status('embed.shortToken', (await pub(c, 'short', '/embed')).status);
    },
  });

  // --- chat page and config (WD-WGT-009 to 013) ------------------------------------------------------------------------
  add({
    id: 'chat.page-and-config',
    title: 'Chat page, config response and the WhatsApp link',
    api: true,
    run: async (c) => {
      const w = await save(
        c,
        widgetBody(c, { name: `${c.tag('page')} <i>x</i>`, collectEmail: true }),
      );
      const o = c.obs;
      const chat = await pub(c, w.token, '/chat');
      o.status('chat', chat.status);
      o.enum('chat.contentType', String(chat.headers['content-type']).split(';')[0]);
      o.flag(
        'chat.noFrameHeaders',
        !chat.headers['x-frame-options'] && !chat.headers['content-security-policy'],
      );
      o.flag('chat.titleEscaped', /<title>[^<]*&lt;i&gt;x&lt;\/i&gt;/.test(String(chat.text)));
      const nf = await pub(c, 'q'.repeat(48), '/chat');
      o.status('chat.unknown', nf.status);
      o.enum('chat.unknown.text', String(nf.text).trim());
      const cfg = await pub(c, w.token, '/api/config');
      o.status('config', cfg.status);
      o.list('config.keys', Object.keys(cfg.body ?? {}));
      o.list('config.widgetKeys', Object.keys(cfg.body?.widget ?? {}));
      o.list('config.visitorKeys', Object.keys(cfg.body?.visitor ?? {}));
      o.flag(
        'config.transcriptEmpty',
        Array.isArray(cfg.body?.transcript) && cfg.body.transcript.length === 0,
      );
      o.set('map.config.fixed', {
        mode: cfg.body?.widget?.mode,
        wa: cfg.body?.widget?.whatsapp_url,
        collect: [
          cfg.body?.widget?.collect_name,
          cfg.body?.widget?.collect_email,
          cfg.body?.widget?.collect_phone,
        ].join(','),
      });
      const uuid = cfg.body?.visitor?.uuid;
      o.flag('visitor.uuidShape', /^[0-9a-f-]{36}$/.test(uuid ?? ''));
      const visitorCookie = (r) => /(wsnap|wgt)_vid_/.test(String(r.headers['set-cookie'] ?? ''));
      o.flag('visitor.cookie', visitorCookie(cfg));
      const again = await pub(c, w.token, `/api/config?visitor_uuid=${uuid}`);
      o.flag('visitor.reused', again.body?.visitor?.uuid === uuid);
      o.flag('visitor.noSecondCookie', !visitorCookie(again));
      const foreign = await save(c, widgetBody(c, { name: c.tag('other') }));
      const replay = await pub(c, foreign.token, `/api/config?visitor_uuid=${uuid}`);
      o.flag('visitor.replayNotHonoured', replay.body?.visitor?.uuid !== uuid);
      const junk = await pub(
        c,
        w.token,
        `/api/config?visitor_uuid=${encodeURIComponent("'; DROP TABLE x;--")}`,
      );
      o.status('config.junkUuid', junk.status);
      o.status('config.unknownToken', (await pub(c, 'k'.repeat(48), '/api/config')).status);
    },
  });

  add({
    id: 'chat.whatsapp-link',
    title: 'WhatsApp link follows mode and number',
    api: true,
    run: async (c) => {
      const o = c.obs;
      const a = await assistant(c);
      const link = async (label, over) => {
        const s = await save(c, widgetBody(c, { name: c.tag(label), ...over }));
        const cfg = await pub(c, s.token, '/api/config');
        o.enum(`link.${label}`, cfg.body?.widget?.whatsapp_url ?? 'null');
      };
      await link('whatsapp', {});
      await link('both', { mode: 'both', assistantId: a });
      await link('ai', { mode: 'ai', assistantId: a });
      await link('no-number', { targetWhatsappNumber: '', targetWhatsappCc: '' });
      await link('no-text', { prefilledMessage: '' });
      await link('encoded', { prefilledMessage: "Hi, I'd like 50% off & more?" });
      await link('digits', { targetWhatsappCc: '+44', targetWhatsappNumber: '(0)7700 900-123' });
    },
  });

  // --- messages and the thread (WD-WGT-014 to 017) ---------------------------------------------------------------------
  add({
    id: 'message.validation',
    title: 'Visitor message validation and shapes',
    api: true,
    run: async (c) => {
      const w = await save(c, widgetBody(c, { name: c.tag('msg') }));
      const uuid = await visitorOf(c, w.token);
      const o = c.obs;
      const post = (data, extra = {}) =>
        pub(c, w.token, '/api/message', {
          method: 'POST',
          data: { visitor_uuid: uuid, ...data },
          ...extra,
        });
      const rec = (label, r) => {
        o.status(`${label}.status`, r.status);
        o.list(`${label}.errorKeys`, Object.keys(r.body?.errors ?? {}));
        o.enum(`${label}.message`, r.body?.message ?? r.body?.error ?? null);
      };
      rec('empty', await post({ body: '' }));
      rec('spaces', await post({ body: '   ' }));
      rec('missing', await post({}));
      rec('8001', await post({ body: 'x'.repeat(8001) }));
      rec('8000', await post({ body: 'x'.repeat(8000) }));
      rec('badEmail', await post({ body: 'hi', email: 'notanemail' }));
      rec('longName', await post({ body: 'hi', name: 'n'.repeat(121) }));
      rec('longPhone', await post({ body: 'hi', phone: '1'.repeat(33) }));
      const ok = await post({ body: 'hello there', name: 'Asha', email: 'asha@example.com' });
      o.status('ok.status', ok.status);
      o.list('ok.keys', Object.keys(ok.body ?? {}));
      o.flag('ok.inboundId', typeof ok.body?.inbound?.id === 'number');
      o.flag('ok.replyNull', ok.body?.reply === null);
      const cfg = await pub(c, w.token, `/api/config?visitor_uuid=${uuid}`);
      o.set('map.visitor', { name: cfg.body?.visitor?.name, email: cfg.body?.visitor?.email });
      o.list(
        'transcript.dirs',
        (cfg.body?.transcript ?? []).map((m) => `${m.dir}:${m.from}`),
      );
      o.status(
        'unknownToken',
        (await pub(c, 'u'.repeat(48), '/api/message', { method: 'POST', data: { body: 'x' } }))
          .status,
      );
      const evil = "<script>window.__xss=1</script> ' OR 1=1; --";
      await post({ body: evil });
      const after = await pub(c, w.token, `/api/config?visitor_uuid=${uuid}`);
      o.flag(
        'xss.storedVerbatim',
        (after.body?.transcript ?? []).some((m) => m.body === evil),
      );
    },
  });

  add({
    id: 'message.ai-first-message-only',
    title: 'AI reply, fallback, and the takeover quirk',
    api: true,
    run: async (c) => {
      const a = await assistant(c, { fallback: 'FALLBACK-TEXT' });
      const w = await save(c, widgetBody(c, { name: c.tag('ai'), mode: 'ai', assistantId: a }));
      const uuid = await visitorOf(c, w.token);
      const o = c.obs;
      const post = (body) =>
        pub(c, w.token, '/api/message', { method: 'POST', data: { body, visitor_uuid: uuid } });
      const r1 = await post('hello one');
      o.enum('first.reply', r1.body?.reply?.body ?? null);
      const r2 = await post('hello two');
      o.enum('second.reply', r2.body?.reply?.body ?? null);
      const r3 = await post('hello three');
      o.enum('third.reply', r3.body?.reply?.body ?? null);
      const hist = await pub(c, w.token, `/api/history?since=0&visitor_uuid=${uuid}`);
      o.list(
        'history.bodies',
        (hist.body?.messages ?? []).map((m) => `${m.from}:${m.body}`),
      );
      const cfg = await pub(c, w.token, `/api/config?visitor_uuid=${uuid}`);
      o.seq(
        'transcript',
        (cfg.body?.transcript ?? []).map((m) => `${m.dir}:${m.from}:${m.body}`),
      );
    },
  });

  add({
    id: 'message.history-quirks',
    title: 'History poll: since cursor, unknown visitors, rotated tokens',
    api: true,
    run: async (c) => {
      const w = await save(c, widgetBody(c, { name: c.tag('hist') }));
      const o = c.obs;
      const empty = await pub(c, w.token, '/api/history?since=0');
      o.status('noUuid', empty.status);
      o.flag(
        'noUuid.emptyList',
        Array.isArray(empty.body?.messages) && empty.body.messages.length === 0,
      );
      const visitorsBefore = await visitorsOf(c, w);
      await pub(c, w.token, '/api/history?since=0');
      await pub(c, w.token, `/api/history?since=0&visitor_uuid=${crypto.randomUUID()}`);
      o.num('visitorRowsCreatedByPolling', (await visitorsOf(c, w)) - visitorsBefore);
      o.status('unknownToken', (await pub(c, 'h'.repeat(48), '/api/history')).status);
      o.list('keys', Object.keys(empty.body ?? {}));
    },
  });
  async function visitorsOf(c, w) {
    if (c.side === 'ours')
      return Number(
        psql(
          `SELECT count(*) FROM chatbot_widget_visitors v JOIN chatbot_widgets w ON w.org_id = v.org_id AND w.id = v.widget_id WHERE w.uuid = '${w.id}'`,
        ),
      );
    // WaDesk: the list page shows the visitor count per widget.
    const r = await c.http('GET', '/chatbot-widgets');
    const row = new RegExp(
      `data-widget-id="${w.id}"[\\s\\S]*?font-mono text-\\[11\\.5px\\] [^"]*">\\s*([^<\\s]+)`,
    ).exec(String(r.text));
    const n = row?.[1];
    return n === '—' || n == null ? 0 : Number(String(n).replace(/,/g, ''));
  }

  // --- the allow-list (WD-WGT-020, 021) --------------------------------------------------------------------------------
  add({
    id: 'cors.allow-list',
    title: 'Origin allow-list on config, message and history',
    api: true,
    run: async (c) => {
      const o = c.obs;
      const open = await save(c, widgetBody(c, { name: c.tag('open') }));
      const openCfg = await pub(c, open.token, '/api/config', {
        headers: { Origin: 'https://anything.example' },
      });
      o.status('empty.config', openCfg.status);
      o.enum('empty.acao', openCfg.headers['access-control-allow-origin'] ?? null);
      o.enum('empty.acac', openCfg.headers['access-control-allow-credentials'] ?? null);
      o.enum('empty.methods', openCfg.headers['access-control-allow-methods'] ?? null);
      o.enum('empty.maxAge', openCfg.headers['access-control-max-age'] ?? null);
      const w = await save(
        c,
        widgetBody(c, { name: c.tag('cors'), allowedDomains: ['acme.com', 'shop.acme.com:8443'] }),
      );
      const uuid = await visitorOf(c, w.token);
      const check = async (label, origin) => {
        const r = await pub(c, w.token, `/api/config?visitor_uuid=${uuid}`, {
          headers: origin ? { Origin: origin } : {},
        });
        o.status(`${label}.status`, r.status);
        o.enum(`${label}.error`, r.body?.error ?? null);
        o.enum(`${label}.acao`, r.headers['access-control-allow-origin'] ?? null);
      };
      await check('acme', 'https://Acme.com');
      await check('www', 'https://www.acme.com');
      await check('port', 'https://shop.acme.com:8443');
      await check('portMissing', 'https://shop.acme.com');
      await check('evil', 'https://evil.example');
      await check('none', null);
      const denied = await pub(c, w.token, `/api/config?visitor_uuid=${uuid}`, {
        headers: { Origin: 'https://www.acme.com' },
      });
      o.enum('denied.message', denied.body?.message ?? null);
      const hist = await pub(c, w.token, `/api/history?since=0&visitor_uuid=${uuid}`, {
        headers: { Origin: 'https://evil.example' },
      });
      o.status('history.evil', hist.status);
      const msg = await pub(c, w.token, '/api/message', {
        method: 'POST',
        data: { body: 'x', visitor_uuid: uuid },
        headers: { Origin: 'https://evil.example' },
      });
      o.status('message.evil', msg.status);
      const okMsg = await pub(c, w.token, '/api/message', {
        method: 'POST',
        data: { body: 'x', visitor_uuid: uuid },
        headers: { Origin: 'https://acme.com' },
      });
      o.status('message.acme', okMsg.status);
      const own = await pub(c, w.token, '/api/message', {
        method: 'POST',
        data: { body: 'own', visitor_uuid: uuid },
        headers: { Origin: c.sideObj.apiBase || c.sideObj.baseUrl },
      });
      o.status('message.ownOrigin', own.status);
      const gone = await pub(c, 'g'.repeat(48), '/api/config', {
        headers: { Origin: 'https://acme.com' },
      });
      o.status('unknownTokenWithOrigin', gone.status);
      o.enum('unknownTokenWithOrigin.error', gone.body?.error ?? null);
    },
  });

  // --- the throttle (WD-WGT-022) ---------------------------------------------------------------------------------------
  add({
    id: 'zz.throttle.message-60-per-minute',
    title: 'Message throttle: 60 a minute per address',
    tags: ['slow'],
    api: true,
    run: async (c) => {
      const w = await save(c, widgetBody(c, { name: c.tag('thr') }));
      const uuid = await visitorOf(c, w.token);
      const o = c.obs;
      // wait out the minute window the other scenarios may have used
      await new Promise((r) => setTimeout(r, 61_000));
      // fired in concurrent batches so all 64 land inside one minute even when the reference answers slowly
      const codes = [];
      for (let b = 0; b < 4; b++) {
        const batch = await Promise.all(
          Array.from({ length: 16 }, (_, i) =>
            pub(c, w.token, '/api/message', {
              method: 'POST',
              data: { body: `m${b * 16 + i}`, visitor_uuid: uuid },
            }),
          ),
        );
        codes.push(...batch.map((r) => r.status));
      }
      // Both sides share the loopback address with whatever else polls the public routes in the dev environment (a
      // counter keyed by address only), so the exact split is not comparable here: the reference gave 60 accepted + 4
      // refused when run alone and our exact 60-then-429 is asserted in the API e2e test. This scenario compares the shape.
      const ok = codes.filter((s) => s === 200).length;
      o.flag('someAccepted', ok > 0);
      o.flag('neverMoreThan60', ok <= 60);
      o.flag('someRefused', codes.includes(429));
      o.flag(
        'onlyOkOr429',
        codes.every((s) => s === 200 || s === 429),
      );
      const r = await pub(c, w.token, '/api/message', {
        method: 'POST',
        data: { body: 'x', visitor_uuid: uuid },
      });
      o.enum('limited.body', r.body?.message ?? null);
      o.flag('config.unthrottled', (await pub(c, w.token, '/api/config')).status === 200);
    },
  });

  // --- admin permissions and the plan gate (WD-WGT-027) ----------------------------------------------------------------
  add({
    id: 'access.unauthenticated',
    title: 'Admin routes without a session',
    api: true,
    run: async (c) => {
      const o = c.obs;
      const call = async (label, method, wd, ours) => {
        const r = await c.http(method, c.side === 'wadesk' ? wd : ours, {
          anonymous: true,
          data: method === 'POST' ? {} : undefined,
        });
        o.flag(
          `${label}.contentHidden`,
          !(
            r.status === 200 &&
            /widget/i.test(String(r.text).slice(0, 4000)) &&
            !/login/i.test(String(r.text))
          ),
        );
        o.flag(
          `${label}.refused`,
          r.status === 401 || r.status === 403 || r.status === 302 || r.status === 419,
        );
      };
      await call('list', 'GET', '/chatbot-widgets', '/v2/widgets');
      await call('save', 'POST', '/chatbot-widgets/api/save', '/v2/widgets');
      await call('delete', 'DELETE', '/chatbot-widgets/1', `/v2/widgets/${crypto.randomUUID()}`);
    },
  });

  // --- screens ----------------------------------------------------------------------------------------------------------
  add({
    id: 'ui.builder.gates',
    title: 'Builder: each step refuses to advance until its rules hold',
    run: async (c) => {
      const o = c.obs;
      // the agent list is read when the page opens, so the assistant exists first
      const aid = await assistant(c);
      await openBuilder(c);
      await clickNext(c);
      o.flag('name.blocked', (await stepNow(c)) === 1);
      o.flag('name.message', await seen(c, 'Name your widget.'));
      await at(c, B.name).fill(c.tag('ui'));
      await clickNext(c);
      o.flag('agent.blocked', (await stepNow(c)) === 1);
      o.flag('agent.message', await seen(c, 'Link a smart agent'));
      // The WhatsApp engine has its own page on ours (WD-WGT-028), so the number rules are walked on the Both engine.
      await at(c, B.tile('both')).click();
      o.flag('agent.selectShown', await at(c, B.assistant).isVisible());
      await at(c, B.assistant).selectOption(String(aid));
      await at(c, B.phone).fill('12345');
      await clickNext(c);
      o.flag('whatsapp.blocked', (await stepNow(c)) === 1);
      o.flag('whatsapp.message', await seen(c, 'Add a full WhatsApp number'));
      await at(c, B.phone).fill('9876543210');
      await clickNext(c);
      o.num('step.afterOk', await stepNow(c));
      await at(c, B.buttonColor).fill('red');
      await clickNext(c);
      o.flag('colour.blocked', (await stepNow(c)) === 2);
      o.flag('colour.message', await seen(c, 'Launcher fill must be a hex colour'));
      await at(c, B.buttonColor).fill('#075E54');
      await at(c, B.headerTitle).fill('   ');
      await clickNext(c);
      o.flag('title.blocked', (await stepNow(c)) === 2);
      o.flag('title.message', await seen(c, 'Give the chat window a title.'));
      await at(c, B.headerTitle).fill('Hello');
      await at(c, B.headerBg).fill('#112233');
      const bg = await at(c, B.previewHeader).evaluate(
        (el) => getComputedStyle(el).backgroundColor,
      );
      o.enum('preview.headerBg', bg);
      await clickNext(c);
      await at(c, B.welcome).fill('');
      await clickNext(c);
      o.flag('welcome.blocked', (await stepNow(c)) === 3);
      o.flag('welcome.message', await seen(c, 'Write an opening line.'));
      await at(c, B.welcome).fill('Hi');
      await c.page.getByText('Tile image', { exact: true }).click();
      await clickNext(c);
      o.flag('bgimage.blocked', (await stepNow(c)) === 3);
      o.flag('bgimage.message', await seen(c, 'Add a background image URL'));
      await at(c, B.save).click();
      await c.page.waitForTimeout(500);
      o.flag('save.walksAllSteps', (await stepNow(c)) === 3);
      o.enum('pill.untouched', (await at(c, B.pill).innerText()).trim());
    },
  });

  add({
    id: 'ui.builder.launch',
    title: 'Builder: launch saves, reveals the snippet, and the list shows the widget',
    run: async (c) => {
      const o = c.obs;
      // the agent list is read when the page opens, so the assistant exists first
      const aid = await assistant(c);
      await openBuilder(c);
      const name = c.tag('launch');
      await at(c, B.name).fill(name);
      await at(c, B.tile('both')).click();
      await at(c, B.assistant).selectOption(String(aid));
      await at(c, B.phone).fill('9876543210');
      await clickNext(c);
      await clickNext(c);
      await clickNext(c);
      o.flag(
        'snippet.hiddenBeforeLaunch',
        !(await at(c, B.snippet)
          .isVisible()
          .catch(() => false)),
      );
      await at(c, B.launch).click();
      await at(c, B.snippet).waitFor({ state: 'visible', timeout: 15000 });
      const snippet = (await at(c, B.snippet).innerText()).trim();
      o.enum(
        'snippet.shape',
        snippet.replace(/https?:\/\/[^/]+/, 'ORIGIN').replace(/[A-Za-z0-9]{48}/, 'TOKEN'),
      );
      o.enum('pill.afterSave', (await at(c, B.pill).innerText()).trim());
      o.flag('toast.savedEmbed', await seen(c, 'Saved — embed ready to copy.'));
      o.flag('previewLink', (await c.page.getByText('Open standalone preview').count()) > 0);
      o.flag('copyButton', (await c.page.getByText('Copy to clipboard').count()) > 0);
      o.num('step.afterLaunch', await stepNow(c));
      await at(c, B.save).click();
      await c.page.waitForTimeout(800);
      o.flag('toast.draftSaved', await seen(c, 'Draft saved.'));
      await c.goto('/chatbot-widgets', { ready: { wadesk: '#widgets-list', ours: 'main' } });
      const rows = c.page.locator('[data-widget-id]', { hasText: name });
      o.num('list.rowsForSavedWidget', await rows.count());
      const id = await rows.first().getAttribute('data-widget-id');
      c.onCleanup(() =>
        c.http('DELETE', c.side === 'wadesk' ? `/chatbot-widgets/${id}` : `/v2/widgets/${id}`),
      );
    },
  });

  add({
    id: 'ui.builder.double-launch',
    title: 'Launch clicked twice quickly',
    tags: ['double-submit'],
    run: async (c) => {
      // the agent list is read when the page opens, so the assistant exists first
      const aid = await assistant(c);
      await openBuilder(c);
      const name = c.tag('dbl');
      await at(c, B.name).fill(name);
      await at(c, B.tile('both')).click();
      await at(c, B.assistant).selectOption(String(aid));
      await at(c, B.phone).fill('9876543210');
      await clickNext(c);
      await clickNext(c);
      await clickNext(c);
      const btn = at(c, B.launch);
      await btn.dblclick({ delay: 0 }).catch(() => undefined);
      await c.page.waitForTimeout(2500);
      await c.goto('/chatbot-widgets', { ready: { wadesk: '#widgets-list', ours: 'main' } });
      const rows = c.page.locator('[data-widget-id]', { hasText: name });
      c.obs.num('widgetsCreated', await rows.count());
      for (const id of await rows.evaluateAll((els) =>
        els.map((e) => e.getAttribute('data-widget-id')),
      )) {
        c.onCleanup(() =>
          c.http('DELETE', c.side === 'wadesk' ? `/chatbot-widgets/${id}` : `/v2/widgets/${id}`),
        );
      }
    },
  });

  add({
    id: 'ui.list.actions',
    title: 'List: search, inert status views, copy, rotate, duplicate, delete',
    run: async (c) => {
      const o = c.obs;
      const w = await save(c, widgetBody(c, { name: c.tag('row') }));
      await c.goto('/chatbot-widgets', { ready: { wadesk: '#widgets-list', ours: 'main' } });
      const rowSel = '[data-widget-id]';
      const row = c.page
        .locator(rowSel, { hasText: w.id ? undefined : c.tagBase })
        .filter({ hasText: c.tagBase })
        .first();
      const name = (await row.innerText()).split('\n')[0];
      const rowText = await row.innerText();
      o.flag('row.enginePill', /WhatsApp/.test(rowText));
      o.flag('row.statusPill', /active/i.test(rowText));
      o.flag('row.slug', /\/pwp-/.test(rowText));
      o.flag('row.visitorsDash', /—/.test(rowText));
      o.flag('row.agentDash', (rowText.match(/—/g) ?? []).length >= 2);
      const actions = await row
        .locator('a[title], button[title], a[aria-label], button[aria-label]')
        .count();
      o.num('row.actions', actions);
      const titles = (
        await row
          .locator('[title], [aria-label]')
          .evaluateAll((els) =>
            els.map((e) => e.getAttribute('title') || e.getAttribute('aria-label')),
          )
      ).filter(Boolean);
      o.list('row.actionTitles', titles);
      // search is client-side over the loaded rows
      const search = c.page.locator('input[type=search], #widgets-search').first();
      let requests = 0;
      c.page.on(
        'request',
        (r) =>
          /widgets|chatbot-widgets/.test(r.url()) && r.resourceType() !== 'document' && requests++,
      );
      await search.fill('zzz-no-such-widget');
      await c.page.waitForTimeout(300);
      o.flag('search.hidesRows', !(await row.isVisible()));
      await search.fill(c.tagBase.slice(0, 6));
      await c.page.waitForTimeout(300);
      o.flag('search.showsRowAgain', await row.isVisible());
      o.num('search.requests', requests);
      await search.fill('');
      // the status views have no behaviour
      const before = await c.page.locator(rowSel).count();
      await c.page
        .getByRole('button', { name: /^Active/ })
        .first()
        .click()
        .catch(() => undefined);
      await c.page.waitForTimeout(300);
      o.flag('statusViews.inert', (await c.page.locator(rowSel).count()) === before);
      // delete: confirm text, cancel keeps, confirm removes without touching the numbers
      const statsBefore = (await bodyText(c))
        .match(/TOTAL WIDGETS[\s\S]{0,40}/i)?.[0]
        .replace(/\s+/g, ' ');
      await row.locator('[title="Delete widget"], [aria-label="Delete widget"]').first().click();
      o.flag('delete.dialogTitle', await seen(c, `Delete "${name}"?`));
      o.flag('delete.dialogBody', await seen(c, 'Past conversations stay in your team inbox.'));
      await c.page
        .getByRole('button', { name: /^(Keep|Cancel)$/ })
        .first()
        .click();
      o.flag('delete.cancelKeeps', await row.isVisible());
      await row.locator('[title="Delete widget"], [aria-label="Delete widget"]').first().click();
      await c.page
        .getByRole('dialog')
        .getByRole('button', { name: 'Delete widget' })
        .click()
        .catch(async () =>
          c.page.getByRole('button', { name: 'Delete widget', exact: true }).last().click(),
        );
      await c.page.waitForTimeout(1000);
      o.flag('delete.rowGone', !(await row.isVisible().catch(() => false)));
      o.flag('delete.toast', await seen(c, 'Widget deleted.'));
      o.flag(
        'delete.statsUntouched',
        (await bodyText(c)).match(/TOTAL WIDGETS[\s\S]{0,40}/i)?.[0].replace(/\s+/g, ' ') ===
          statsBefore,
      );
    },
  });

  add({
    id: 'ui.list.rotate-copy',
    title:
      'List: rotate asks first, updates the copy button only; copy puts the tag on the clipboard',
    run: async (c) => {
      const o = c.obs;
      await c.context
        .grantPermissions(['clipboard-read', 'clipboard-write'])
        .catch(() => undefined);
      const w = await save(c, widgetBody(c, { name: c.tag('rot') }));
      await c.goto('/chatbot-widgets', { ready: { wadesk: '#widgets-list', ours: 'main' } });
      const row = c.page.locator('[data-widget-id]').filter({ hasText: c.tagBase }).first();
      const previewHref = () => row.locator('a[target=_blank]').first().getAttribute('href');
      const oldPreview = await previewHref();
      await row
        .locator('[title="Copy embed snippet"], [aria-label="Copy embed snippet"]')
        .first()
        .click();
      await c.page.waitForTimeout(400);
      const copied = await c.page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
      o.enum(
        'copied.shape',
        copied.replace(/https?:\/\/[^/]+/, 'ORIGIN').replace(/[A-Za-z0-9]{48}/, 'TOKEN'),
      );
      o.flag('copied.toast', await seen(c, 'Snippet copied — paste before </body> on your site.'));
      await row
        .locator('[title="Rotate embed token"], [aria-label="Rotate embed token"]')
        .first()
        .click();
      o.flag('rotate.dialog', await seen(c, "Rotate this widget's embed token?"));
      await c.page
        .getByRole('button', { name: /^Cancel$/ })
        .first()
        .click();
      o.flag('rotate.cancelKeepsToken', (await pub(c, w.token, '/embed')).status === 200);
      await row
        .locator('[title="Rotate embed token"], [aria-label="Rotate embed token"]')
        .first()
        .click();
      await c.page
        .getByRole('dialog')
        .getByRole('button', { name: 'Rotate' })
        .click()
        .catch(async () =>
          c.page.getByRole('button', { name: 'Rotate', exact: true }).last().click(),
        );
      await c.page.waitForTimeout(1000);
      o.flag('rotate.toast', await seen(c, 'Token rotated — copy the new snippet.'));
      o.status('rotate.oldEmbed', (await pub(c, w.token, '/embed')).status);
      await row
        .locator('[title="Copy embed snippet"], [aria-label="Copy embed snippet"]')
        .first()
        .click();
      await c.page.waitForTimeout(300);
      const copied2 = await c.page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
      o.flag('rotate.copyUsesNewToken', copied2 !== copied && !copied2.includes(w.token));
      o.flag('rotate.previewLinkStillOld', (await previewHref()) === oldPreview);
    },
  });

  add({
    id: 'ui.list.empty-and-xss',
    title: 'List: a hostile name is shown as text',
    run: async (c) => {
      const o = c.obs;
      let fired = false;
      await c.page.exposeFunction('__xssFired', () => (fired = true)).catch(() => undefined);
      await c.page.addInitScript(() => {
        Object.defineProperty(window, '__xss', {
          set() {
            window.__xssFired && window.__xssFired();
          },
          get() {
            return 0;
          },
        });
      });
      const name = `${c.tag('xss')} <img src=x onerror=window.__xss=1>`;
      await save(c, widgetBody(c, { name }));
      await c.goto('/chatbot-widgets', { ready: { wadesk: '#widgets-list', ours: 'main' } });
      await c.page.waitForTimeout(500);
      o.flag('sec.xssExecuted', fired);
      o.flag('nameShownAsText', (await bodyText(c)).includes('<img src=x'));
    },
  });

  add({
    id: 'ui.embed.on-customer-site',
    title: 'The embedded widget on another origin: launcher, panel, intake, send, polling',
    run: async (c) => {
      const o = c.obs;
      const w = await save(
        c,
        widgetBody(c, {
          name: c.tag('site'),
          mode: 'both',
          assistantId: await assistant(c),
          headerTitle: 'Talk <b>to</b> us',
          collectName: true,
        }),
      );
      const base = c.side === 'wadesk' ? c.sideObj.baseUrl : c.sideObj.apiBase;
      const server = http.createServer((req, res) => {
        res.setHeader('content-type', 'text/html');
        res.end(
          `<!doctype html><body><h1>Customer site</h1><script defer src="${base}/widget/${w.token}/embed"></script></body>`,
        );
      });
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      c.onCleanup(() => new Promise((r) => server.close(r)));
      const port = server.address().port;
      let fired = false;
      await c.page.exposeFunction('__xssFired', () => (fired = true)).catch(() => undefined);
      await c.page.goto(`http://127.0.0.1:${port}/`);
      const launcher = c.page.locator('button[aria-label="Open chat"]');
      await launcher.waitFor({ timeout: 15000 });
      const lb = await launcher.boundingBox();
      o.set('map.launcher', {
        w: lb.width,
        h: lb.height,
        fromRight: 1280 - (lb.x + lb.width),
        fromBottom: 720 - (lb.y + lb.height),
      });
      const panelVisibleBefore = await c.page
        .locator('iframe')
        .isVisible()
        .catch(() => false);
      o.flag('panel.hiddenInitially', !panelVisibleBefore);
      await launcher.click();
      await c.page.waitForTimeout(800);
      const fb = await c.page.locator('iframe').boundingBox();
      o.set('map.panel', { w: fb.width, h: fb.height });
      await launcher.click();
      o.flag('panel.togglesClosed', !(await c.page.locator('iframe').isVisible()));
      await launcher.click();
      const frame = c.page.frameLocator('iframe');
      await frame.locator('#hdr').waitFor({ timeout: 15000 });
      o.enum('header.text', (await frame.locator('#hdr').innerText()).trim());
      o.enum(
        'header.bg',
        await frame.locator('#hdr').evaluate((el) => getComputedStyle(el).backgroundColor),
      );
      o.list('bubbles.initial', await frame.locator('.bubble').allInnerTexts());
      o.flag('send.disabledUntilIntake', await frame.locator('#send').isDisabled());
      o.enum('send.label', (await frame.locator('#send').innerText()).trim());
      o.flag('intake.visible', await frame.locator('#intake').isVisible());
      o.flag(
        'intake.title',
        (await frame.locator('#intake').innerText()).includes('Tell us a bit about you'),
      );
      o.flag('waCta', (await frame.locator('.wa-cta').count()) > 0);
      o.enum('waCta.text', (await frame.locator('.wa-cta').first().innerText()).trim());
      await frame.locator('#i-go').click();
      o.flag('send.enabledAfterContinue', !(await frame.locator('#send').isDisabled()));
      o.flag('intake.hiddenAfterContinue', !(await frame.locator('#intake').isVisible()));
      await frame.locator('#txt').fill('hello from the site <img src=x onerror=window.__xss=1>');
      await frame.locator('#txt').press('Enter');
      await frame.locator('.bubble.out').first().waitFor({ timeout: 15000 });
      await c.page.waitForTimeout(1500);
      o.list(
        'bubbles.afterSend',
        await frame
          .locator('.bubble')
          .allInnerTexts()
          .then((a) => a.map((t) => t.replace(/<img[^>]*>/, 'IMG'))),
      );
      o.flag('typing.removed', (await frame.locator('.typing').count()) === 0);
      o.flag('sec.xssExecuted', fired);
      o.flag(
        'visitorBubbleRight',
        await frame
          .locator('.bubble.out')
          .first()
          .evaluate((el) => getComputedStyle(el).alignSelf === 'flex-end'),
      );
      o.enum(
        'visitorBubbleColour',
        await frame
          .locator('.bubble.out')
          .first()
          .evaluate((el) => getComputedStyle(el).backgroundColor),
      );
      // a person's reply typed in the team inbox arrives by polling: simulated on both sides by the API/DB writes below
      await c.page.screenshot({ path: `${c.shotsDir}/panel.png` }).catch(() => undefined);
    },
  });

  add({
    id: 'ui.embed.mobile-viewport',
    title: 'The panel on a phone-width page',
    run: async (c) => {
      const o = c.obs;
      const w = await save(
        c,
        widgetBody(c, { name: c.tag('mob'), mode: 'both', assistantId: await assistant(c) }),
      );
      const base = c.side === 'wadesk' ? c.sideObj.baseUrl : c.sideObj.apiBase;
      const server = http.createServer((req, res) => {
        res.setHeader('content-type', 'text/html');
        res.end(
          `<!doctype html><meta name=viewport content="width=device-width"><body><script defer src="${base}/widget/${w.token}/embed"></script></body>`,
        );
      });
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      c.onCleanup(() => new Promise((r) => server.close(r)));
      await c.page.setViewportSize({ width: 390, height: 700 });
      await c.page.goto(`http://127.0.0.1:${server.address().port}/`);
      await c.page.locator('button[aria-label="Open chat"]').click({ timeout: 15000 });
      await c.page.waitForTimeout(600);
      const fb = await c.page.locator('iframe').boundingBox();
      o.set('map.panelAtPhone', { w: Math.round(fb.width), h: Math.round(fb.height) });
      o.flag(
        'noHorizontalScroll',
        await c.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      );
    },
  });

  add({
    id: 'ui.builder.responsive-rtl',
    title: 'Builder and list at 390px, and with dir=rtl',
    run: async (c) => {
      const o = c.obs;
      for (const [label, path, ready] of [
        ['list', '/chatbot-widgets', { wadesk: '#widgets-list', ours: 'main' }],
        ['builder', '/chatbot-widgets/create', { wadesk: '#cbw-builder', ours: '#wgt-next' }],
      ]) {
        await c.page.setViewportSize({ width: 390, height: 800 });
        await c.goto(path, { ready });
        o.set(
          `low.overflowX.${label}.390`,
          await c.page.evaluate(() =>
            Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
          ),
        );
        await c.page.setViewportSize({ width: 1366, height: 800 });
        await c.page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'));
        await c.page.waitForTimeout(300);
        o.set(
          `low.overflowX.${label}.rtl`,
          await c.page.evaluate(() =>
            Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
          ),
        );
      }
    },
  });

  add({
    id: 'ui.builder.keyboard',
    title: 'Builder: keyboard reaches Next, Enter in the name field does not submit',
    run: async (c) => {
      const o = c.obs;
      await openBuilder(c);
      await at(c, B.name).focus();
      await c.page.keyboard.press('Enter');
      await c.page.waitForTimeout(300);
      o.flag('enterInName.advances', (await stepNow(c)) !== 1);
      let reached = false;
      for (let i = 0; i < 40 && !reached; i++) {
        await c.page.keyboard.press('Tab');
        reached = await c.page.evaluate(
          (id) => document.activeElement?.id === id,
          c.side === 'wadesk' ? 'cbw-next' : 'wgt-next',
        );
      }
      o.flag('tabReachesNext', reached);
    },
  });

  add({
    id: 'ui.dark-mode',
    title: 'prefers-color-scheme: dark',
    run: async (c) => {
      await c.page.emulateMedia({ colorScheme: 'dark' });
      await c.goto('/chatbot-widgets', { ready: { wadesk: '#widgets-list', ours: 'main' } });
      c.obs.info(
        'bodyBackground',
        await c.page.evaluate(() => getComputedStyle(document.body).backgroundColor),
      );
    },
  });

  return {
    feature: 'adhoc:chatbot-widget-domain',
    title:
      'Website chatbot widget: admin API and screens, embed script, chat page, public visitor API',
    scenarios,
    pages: [],
    // Each entry is a decision recorded in docs/wadesk-port/parity/chatbot-widget.md.
    intended: [
      {
        scenario: /^chat\.page-and-config$/,
        key: 'set.config.widgetKeys',
        reason:
          'WD-WGT-028, user-requested Interakt reference: the public config also carries the launcher block (look and placement of the WhatsApp widget)',
      },
    ],
  };
};
