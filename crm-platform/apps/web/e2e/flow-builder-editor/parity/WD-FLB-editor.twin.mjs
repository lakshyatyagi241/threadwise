// Twin spec for the flow BUILDER (editor) side of the flow domain: WD-FLB-014..027 and the node inspectors 030..067, on WaDesk
// and on ours. Real mouse drags on the canvas, wiring, the inspector of every node type available on both sides, the pre-save
// popup, save / publish through the UI with the persisted graph read back through each side's API, the test panel, the AI
// generator modal, the webhook / media / AI endpoints, import / export and the API save validation.
// Run:  parity.sh run apps/web/e2e/flow-builder-editor/parity/WD-FLB-editor.twin.mjs --depth full
// Needs PARITY_WEB_URL / PARITY_API_URL / PARITY_CONFIG (see prepare-org.mjs) and the WaDesk reference on :8000.
// Every flow this spec makes is named `zz-flb-ed-<run tag>-...` and is deleted by id (and swept by that prefix at the end).

export default (h) => {
  const NAME = 'zz-flb-ed-';
  const idem = () => ({ 'Idempotency-Key': crypto.randomUUID() });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const scenarios = [];
  const add = (s) => scenarios.push(s);
  const rep = (n, ch = 'x') => ch.repeat(n);

  // ---------------------------------------------------------------------------------------------------------------
  // API: one logical flow, two backends
  // ---------------------------------------------------------------------------------------------------------------
  const flowName = (c, label = 'f') => {
    c._flbNames ??= {};
    return (c._flbNames[label] ??= `${NAME}${c.tag(label)}`);
  };
  const delPath = (c, id) => (c.side === 'wadesk' ? `/flows/${id}` : `/v2/flows/${id}`);

  /** The graph as both sides store it: {flowNodes, flowEdges, vars}. */
  const G = (nodes, edges = [], vars = []) => ({ flowNodes: nodes, flowEdges: edges, vars });
  const N = (id, type, x, y, data = {}, isStart = false) => ({
    id,
    type,
    x,
    y,
    data,
    ...(isStart ? { isStart } : {}),
  });
  const E = (id, source, sourceHandle, target) => ({ id, source, sourceHandle, target });
  const miniGraph = (text = 'Hello there') =>
    G(
      [
        N(
          'n_t00001',
          'trigger',
          100,
          100,
          { kind: 'keyword', keywordMode: 'keywords', keywords: 'hello' },
          true,
        ),
        N('n_m00001', 'message', 460, 100, { text }),
        N('n_e00001', 'end', 820, 100, {}),
      ],
      [E('e_a00001', 'n_t00001', 'out', 'n_m00001'), E('e_b00001', 'n_m00001', 'out', 'n_e00001')],
    );

  /** Save through each side's API. Returns {r, accepted, id, message, flagged}. */
  async function apiSave(c, { id = null, name, graph, type, category, raw } = {}) {
    let r;
    if (c.side === 'wadesk') {
      const data = raw ?? { flow_name: name, flow_data: graph };
      if (!raw) {
        if (type !== undefined) data.flow_type = type;
        if (category !== undefined) data.category = category;
      }
      if (id != null) data.flow_id = id;
      r = await c.http('POST', '/flows/api/save', { data });
    } else if (id == null) {
      const data = raw ?? { name, graph };
      if (!raw) {
        if (type !== undefined) data.flowType = type;
        if (category !== undefined) data.category = category;
      }
      r = await c.http('POST', '/v2/flows', { data, headers: idem() });
    } else {
      const cur = await c.http('GET', `/v2/flows/${id}`);
      const data = raw ?? { name, graph, rowVersion: cur.body?.rowVersion ?? 1 };
      if (!raw) {
        if (type !== undefined) data.flowType = type;
        if (category !== undefined) data.category = category;
      }
      r = await c.http('PUT', `/v2/flows/${id}`, { data, headers: idem() });
    }
    const b = r.body && typeof r.body === 'object' ? r.body : {};
    const accepted =
      c.side === 'wadesk'
        ? r.status === 200 && b.success === true
        : r.status === 200 || r.status === 201;
    const fid = c.side === 'wadesk' ? b.data?.flow_id : b.id;
    if (accepted && fid != null && id == null)
      c.onCleanup(() =>
        c.http('DELETE', delPath(c, fid), { headers: c.side === 'ours' ? idem() : {} }),
      );
    let message = null;
    if (!accepted)
      message = c.side === 'wadesk' ? (b.message ?? null) : (b.detail ?? b.title ?? null);
    let flagged = [];
    if (!accepted) {
      if (c.side === 'wadesk' && b.errors)
        flagged = Object.keys(b.errors).map((k) => k.replace(/^flow_/, '').replace(/\..*$/, ''));
      if (c.side === 'ours' && Array.isArray(b.errors))
        flagged = b.errors.map((e) =>
          String(e.path)
            .split('.')[0]
            .replace(/^graph$/, 'data')
            .replace(/^flowType$/, 'type'),
        );
    }
    return { r, accepted, id: fid, message, flagged, code: b.code ?? null };
  }

  const statusClass = (s) =>
    s >= 500
      ? 'crash'
      : s === 401
        ? 'unauthenticated'
        : s === 403
          ? 'forbidden'
          : s === 404
            ? 'not-found'
            : s === 409
              ? 'conflict'
              : s === 429
                ? 'throttled'
                : s >= 400
                  ? 'rejected'
                  : 'ok';

  /** The stored flow, side-neutral: {name, type, category, published, active, graph}. */
  async function apiGet(c, id) {
    const r = await c.http('GET', c.side === 'wadesk' ? `/flows/api/${id}` : `/v2/flows/${id}`);
    const b = r.body && typeof r.body === 'object' ? r.body : {};
    if (c.side === 'wadesk') {
      const f = b.data?.flow ?? {};
      return {
        status: r.status,
        name: f.flow_name,
        type: f.flow_type,
        category: f.category,
        published: !!f.is_published,
        active: !!f.is_active,
        graph: b.data?.flow_data,
        kind: f.trigger_kind,
        raw: b,
      };
    }
    return {
      status: r.status,
      name: b.name,
      type: b.flowType,
      category: b.category,
      published: !!b.isPublished,
      active: !!b.isActive,
      graph: b.graph,
      kind: b.triggerKind,
      raw: b,
    };
  }

  /** Flows of THIS scenario (its tag carries the scenario hash) on this side: [{id, name}]. */
  async function myFlows(c) {
    const all = await runFlows(c);
    return all.filter((f) => String(f.name).includes(`-${c.sid}-`));
  }
  /** Imports without a usable name become "Imported flow (imported)": the ones THIS scenario made carry its tag in the graph. */
  async function strays(c) {
    const all = await runFlowsAnyName(c);
    const out = [];
    for (const f of all.filter((x) => /^Imported flow/.test(String(x.name)))) {
      const g = (await apiGet(c, f.id)).graph;
      if (JSON.stringify(g ?? {}).includes(c.tagBase)) out.push(f);
    }
    return out;
  }
  async function runFlowsAnyName(c) {
    if (c.side === 'wadesk') {
      const r = await c.http('GET', '/flows/api/list');
      return (r.body?.data ?? []).map((f) => ({ id: f.id, name: f.flow_name }));
    }
    const r = await c.http('GET', '/v2/flows', { query: { limit: 100 } });
    return (r.body?.data ?? r.body?.items ?? []).map((f) => ({ id: f.id, name: f.name }));
  }
  /** Flows of this whole run (by tag). */
  async function runFlows(c) {
    if (c.side === 'wadesk') {
      const r = await c.http('GET', '/flows/api/list');
      return (r.body?.data ?? [])
        .filter((f) => String(f.flow_name).includes(c.tagBase))
        .map((f) => ({ id: f.id, name: f.flow_name }));
    }
    const r = await c.http('GET', '/v2/flows', { query: { q: c.tagBase, limit: 100 } });
    return (r.body?.data ?? r.body?.items ?? [])
      .filter((f) => String(f.name).includes(c.tagBase))
      .map((f) => ({ id: f.id, name: f.name }));
  }

  /** Graph shape that does not depend on random node ids: node types (start marked), edges as `type.handle>type`. */
  function shapeOf(graph) {
    const nodes = graph?.flowNodes ?? [];
    const edges = graph?.flowEdges ?? [];
    const typeOf = new Map(nodes.map((n) => [n.id, n.type]));
    return {
      nodes: nodes.map((n) => `${n.type}${n.isStart ? '*' : ''}`).sort(),
      edges: edges
        .map((e) => `${typeOf.get(e.source)}.${e.sourceHandle}>${typeOf.get(e.target)}`)
        .sort(),
      vars: (graph?.vars ?? []).map((v) => `${v.name}`),
    };
  }
  const recordShape = (o, prefix, graph) => {
    const s = shapeOf(graph);
    o.set(`map.${prefix}.shape`, {
      nodes: s.nodes.join(','),
      edges: s.edges.join(','),
      vars: s.vars.join(','),
    });
  };

  /** Creates a flow through the API and returns its id (cleaned up at the end). */
  async function seed(c, graph, over = {}) {
    const s = await apiSave(c, {
      name: flowName(c, over.label ?? 'seed'),
      graph,
      type: over.type ?? 'chat',
      category: over.category,
    });
    if (!s.accepted)
      throw new Error(`seed failed ${s.r.status} ${JSON.stringify(s.r.body).slice(0, 200)}`);
    return s.id;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // UI helpers (both builders share their classes, data-node-id and data-port hooks)
  // ---------------------------------------------------------------------------------------------------------------
  const SEL = {
    canvas: '.canvas-dots, [data-testid=canvas]',
    nameInput: { wadesk: 'input.font-serif', ours: 'input[aria-label="Flow name"]' },
    save: { wadesk: '.flow-save-btn', ours: { role: 'button', name: /^Save/ } },
    publish: { role: 'button', name: /^Publish/ },
    test: { wadesk: '.flow-test-btn', ours: '.flow-test-btn' },
    ai: { role: 'button', name: /Generate with AI/ },
    pill: '.flow-status',
    search: { css: 'input[placeholder^="Search nodes"]' },
    testPanel: {
      wadesk: 'div.fixed.bottom-6.right-6',
      ours: '[role=dialog][aria-label="Test runner"]',
    },
  };
  const at = (c, spec) => c.loc(spec);

  async function openBuilder(c, path = '/flows/builder') {
    await c.goto(path, { ready: '.pal-card' });
    await c.page
      .addStyleTag({ content: 'nextjs-portal{display:none!important}' })
      .catch(() => undefined);
    await c.page
      .getByRole('button', { name: /^decline$/i })
      .first()
      .click({ timeout: 1200 })
      .catch(() => undefined);
    await c.page.waitForFunction(() => document.fonts.status === 'loaded').catch(() => undefined);
    await sleep(900);
  }
  const builderPath = (c, id) => `/flows/builder/${id}`;
  async function openFlow(c, id) {
    await openBuilder(c, builderPath(c, id));
    await c.page
      .locator('[data-node-id]')
      .first()
      .waitFor({ timeout: 8000 })
      .catch(() => undefined);
  }

  const nodeCards = (c) =>
    c.page.evaluate(() =>
      [...document.querySelectorAll('[data-node-id]')].map((e) => ({
        id: e.getAttribute('data-node-id'),
        label: e.querySelector('.chip-icon + div > div')?.textContent?.trim() ?? '',
        start: (e.textContent || '').startsWith('START'),
        selected: e.classList.contains('selected'),
        invalid:
          e.classList.contains('node-invalid') ||
          /ring-coral|border-red|node-error|invalid/.test(e.className) ||
          getComputedStyle(e).outlineColor.includes('239'),
        x: Math.round(parseFloat(e.style.left)),
        y: Math.round(parseFloat(e.style.top)),
        ports: [...e.querySelectorAll('[data-port]')].map((p) =>
          p
            .getAttribute('data-port')
            .split(':')
            .slice(0, 1)
            .concat(p.getAttribute('data-port').split(':')[2] ?? '')
            .join(':'),
        ),
      })),
    );
  const edgeCount = (c) => c.page.locator('path.edge-hit').count();
  const countOf = async (c, label) => (await nodeCards(c)).filter((n) => n.label === label).length;
  const idOf = async (c, label, nth = 0) =>
    (await nodeCards(c)).filter((n) => n.label === label)[nth]?.id;

  /** Real HTML5 drag from a palette card onto the canvas (the first drag after boot can be lost, so retried). */
  async function dragCard(c, label, x, y) {
    const before = (await nodeCards(c)).length;
    for (let i = 0; i < 3; i++) {
      await c.page
        .locator('.pal-card', { hasText: label })
        .first()
        .dragTo(c.page.locator(SEL.canvas).first(), { targetPosition: { x, y } });
      await sleep(260);
      if ((await nodeCards(c)).length > before) return true;
    }
    return false;
  }
  const portCenter = async (c, sel) => {
    const bb = await c.page.locator(sel).first().boundingBox();
    return bb ? { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 } : null;
  };
  async function wireTo(c, srcSel, target, { drop = true } = {}) {
    const a = await portCenter(c, srcSel);
    if (!a || !target) return false;
    await c.page.mouse.move(a.x, a.y);
    await c.page.mouse.down();
    await c.page.mouse.move((a.x + target.x) / 2, (a.y + target.y) / 2, { steps: 5 });
    await c.page.mouse.move(target.x, target.y, { steps: 5 });
    if (drop) await c.page.mouse.up();
    await sleep(170);
    return true;
  }
  const wire = async (c, srcSel, tgtSel) => wireTo(c, srcSel, await portCenter(c, tgtSel));
  const outPort = (id, handle = 'out') => `[data-port="out:${id}:${handle}"]`;
  const inPort = (id) => `[data-port="in:${id}"]`;
  const nodeTitle = (c, id) =>
    c.page.locator(`[data-node-id="${id}"] .chip-icon + div > div`).first();
  const selectNode = async (c, id) => {
    await c.page.keyboard.press('Escape');
    await clickEmpty(c);
    await nodeTitle(c, id).click({ force: true });
    await sleep(120);
  };
  const pillText = async (c) =>
    (
      await c.page
        .locator(SEL.pill)
        .first()
        .innerText()
        .catch(() => '')
    ).trim();
  const bodyText = (c) => c.page.locator('body').innerText();
  const seen = async (c, re) => re.test(await bodyText(c));
  const zoomText = (c) =>
    c.page.evaluate(() => {
      const el = [...document.querySelectorAll('div,span')].find(
        (e) => e.children.length === 0 && /^\d+%$/.test(e.textContent.trim()),
      );
      return el ? el.textContent.trim() : '';
    });
  const canvasBox = (c) => c.page.locator(SEL.canvas).first().boundingBox();
  const worldTransform = (c) =>
    c.page.evaluate(() => {
      const cv = document.querySelector('.canvas-dots, [data-testid=canvas]');
      const w = cv?.firstElementChild;
      return w?.style.transform || '';
    });
  const clickEmpty = async (c) => {
    const bb = await canvasBox(c);
    await c.page.mouse.click(bb.x + 40, bb.y + bb.height - 60);
    await sleep(100);
  };
  const toastTexts = (c) => c.page.evaluate(() => (window.__flbSeen ?? []).slice());
  async function watchToasts(c) {
    await c.page.evaluate(() => {
      window.__flbSeen = [];
      const mo = new MutationObserver((ms) => {
        for (const m of ms)
          for (const n of m.addedNodes) {
            if (n.nodeType !== 1) continue;
            const t = (n.innerText || '').trim().replace(/\s+/g, ' ');
            if (t && t.length < 400) window.__flbSeen.push(t);
          }
      });
      mo.observe(document.body, { childList: true, subtree: true });
    });
  }
  /** Single-line texts of the transient messages that matched /re/ since watchToasts. */
  async function toastsMatching(c, re) {
    return [...new Set((await toastTexts(c)).filter((t) => re.test(t)))];
  }

  /** The pre-save popup: heading, bullet reasons, footer. */
  async function popupOf(c) {
    return c.page.evaluate(() => {
      const hs = [...document.querySelectorAll('div')].filter(
        (d) =>
          /^Can.t (save|publish)/.test((d.textContent || '').trim()) && d.children.length === 0,
      );
      const h = hs[0];
      if (!h) return null;
      let box = h;
      for (let i = 0; i < 6 && box && !/outlined in red/.test(box.innerText || ''); i++)
        box = box.parentElement;
      const lines = (box?.innerText || '')
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      return { heading: h.textContent.trim(), lines };
    });
  }

  // inspector ---------------------------------------------------------------------------------------------------------
  const ENUM = () => {
    const root = document.querySelector('aside.ins-panel');
    if (!root) return null;
    const rows = [];
    const labelOf = (el) => {
      const lf = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lf) return lf.textContent.trim();
      const wrap = el.closest('label');
      if (wrap) return wrap.textContent.trim().slice(0, 60);
      let p = el.parentElement;
      for (let i = 0; i < 4 && p && p !== root; i++, p = p.parentElement) {
        const l = [...p.children].find(
          (cc) =>
            cc !== el &&
            !cc.contains(el) &&
            /^(LABEL|DIV|SPAN)$/.test(cc.tagName) &&
            cc.children.length < 2 &&
            cc.textContent.trim() &&
            cc.textContent.trim().length < 50,
        );
        if (l) return l.textContent.trim();
      }
      return '';
    };
    for (const el of root.querySelectorAll(
      'input,select,textarea,[role=switch],[role=combobox],[role=radio]',
    )) {
      if (el.offsetParent === null && el.type !== 'file') continue;
      const tag = el.tagName.toLowerCase();
      const kind = tag === 'input' ? el.type : el.getAttribute('role') || tag;
      const row = { label: labelOf(el), kind };
      if (tag === 'select') {
        row.options = [...el.options].map((o) => o.textContent.trim());
        row.value = el.options[el.selectedIndex]?.textContent.trim() ?? '';
      } else if (kind === 'checkbox' || kind === 'radio' || el.getAttribute('role') === 'switch') {
        row.value = String(el.checked ?? el.getAttribute('aria-checked'));
      } else if (kind !== 'file') row.value = el.value;
      if (el.maxLength > 0) row.max = el.maxLength;
      for (const a of ['min', 'max', 'step', 'placeholder', 'accept', 'rows'])
        if (el.getAttribute(a)) row[a] = el.getAttribute(a);
      rows.push(row);
    }
    const norm = (t) => (/^(×|✕|Remove|)$/.test(t) ? '×' : t);
    const buttons = [...root.querySelectorAll('button')]
      .filter((b) => b.offsetParent)
      .map((b) =>
        norm(
          (b.innerText || b.title || b.getAttribute('aria-label') || '')
            .trim()
            .replace(/\s+/g, ' '),
        ),
      );
    const heads = [...root.querySelectorAll('div,span')]
      .filter(
        (e) =>
          e.children.length === 0 &&
          /^[A-Z][^.]{2,40}$/.test(e.textContent.trim()) &&
          getComputedStyle(e).textTransform !== 'none',
      )
      .map((e) => e.textContent.trim())
      .slice(0, 1);
    return {
      title: root.querySelector('.font-serif, h2')?.textContent.trim(),
      rows,
      buttons,
      heads,
    };
  };
  async function openInspector(c, id) {
    await selectNode(c, id);
    await c.page.locator('.node-actions button[title^="Edit"]').click();
    await sleep(1800); // the pickers (stores, forms, services, templates) are fetched when the inspector opens
  }
  // Option lists that come from the workspace's own data (tags, flows, agents, templates...) differ between the two
  // datasets: a list that starts with a placeholder ("— pick ... —") or an empty-state line ("No ... yet") is compared by its
  // placeholder kind only; static lists (modes, units, kinds) are compared in full.
  const isDataPlaceholder = (t = '') =>
    /^—|^No |^Loading /.test(t) && !/^— workspace default/.test(t);
  const optsKey = (opts = []) => {
    if (!opts.length) return '';
    if (isDataPlaceholder(opts[0])) return opts.length === 1 ? '<data:empty>' : '<data>';
    return opts.join('/');
  };
  const rowKey = (r) =>
    [
      r.label,
      r.kind,
      isDataPlaceholder(r.value ?? '') && isDataPlaceholder((r.options ?? [''])[0])
        ? '<placeholder>'
        : (r.value ?? ''),
      optsKey(r.options),
      r.max ?? '',
      r.min ?? '',
      r.step ?? '',
      (r.placeholder ?? '').replace(/\\n/g, '\n'),
      r.accept ?? '',
    ].join('|');

  // ---------------------------------------------------------------------------------------------------------------
  // palette / shell
  // ---------------------------------------------------------------------------------------------------------------
  const paletteOf = (c) =>
    c.page.evaluate(() => {
      const pal = document.querySelector('.pal-card').closest('aside');
      return {
        cards: [...document.querySelectorAll('.pal-card')].map((e) =>
          e.innerText.replace(/\s*\n\s*/g, ' | '),
        ),
        groups: [...pal.querySelectorAll('div,span')]
          .filter(
            (e) =>
              e.children.length === 0 &&
              getComputedStyle(e).textTransform === 'uppercase' &&
              e.textContent.trim().length > 2 &&
              e.textContent.trim().length < 20,
          )
          .map((e) => e.textContent.trim()),
        head: (pal.innerText || '').split('\n').slice(0, 4).join(' | '),
        tip:
          [...pal.querySelectorAll('div')]
            .filter((d) => /^Tip/.test(d.textContent.trim()) && d.children.length < 4)
            .map((d) => d.textContent.trim().replace(/\s+/g, ' '))[0] ?? '',
      };
    });

  for (const mode of ['chat', 'call']) {
    add({
      id: `ui.palette.${mode}`,
      title: `Palette (${mode} flow): header, count, groups, cards in order, tip`,
      run: async (c) => {
        const o = c.obs;
        await openBuilder(c, mode === 'call' ? '/flows/builder?type=call' : '/flows/builder');
        const p = await paletteOf(c);
        o.num('count', p.cards.length);
        o.seq('cards', p.cards);
        o.seq('groups', p.groups);
        o.enum('head', p.head);
        o.enum('tip', p.tip);
        o.flag('channelSelectHiddenOnEmptyTrigger', (await c.page.locator('select').count()) === 0);
        await c.shot('palette');
      },
    });
  }

  add({
    id: 'ui.palette.search',
    title: 'Palette search: label, description, group, case, spaces, empty result',
    run: async (c) => {
      const o = c.obs;
      await openBuilder(c);
      const s = at(c, SEL.search).first();
      const queries = [
        'sheet',
        'SHEET',
        '  sheet  ',
        'tap-to-pick',
        'logic',
        'engage',
        'zzzz',
        'a',
        'send',
        'webhook',
        'ig',
        'Where',
        '%',
        '<b>',
        "'; drop",
        'é',
        'whatsapp',
        'start',
      ];
      for (const q of queries) {
        await s.fill(q);
        await sleep(160);
        const cards = await c.page
          .locator('.pal-card')
          .evaluateAll((els) => els.map((e) => e.innerText.split('\n')[0]));
        o.seq(
          `q.${q.trim() || 'blank'}.${q === q.toUpperCase() && /[A-Z]/.test(q) ? 'upper' : q.startsWith(' ') ? 'padded' : 'plain'}`,
          cards,
        );
        if (!cards.length) o.flag(`q.${q.trim()}.emptyMessage`, await seen(c, /No nodes match\./));
      }
      await s.fill('');
      o.num('afterClear', await c.page.locator('.pal-card').count());
      await s.fill(rep(500));
      o.num('long.count', await c.page.locator('.pal-card').count());
    },
  });

  add({
    id: 'ui.palette.collapse',
    title: 'Palette collapse handle hides and shows the panel',
    run: async (c) => {
      const o = c.obs;
      await openBuilder(c);
      await c.page.locator('button[title="Hide sidebar"]').click();
      await sleep(250);
      o.flag(
        'hidden',
        (await c.page.locator('.pal-card').count()) === 0 ||
          !(await c.page.locator('.pal-card').first().isVisible()),
      );
      await c.page.locator('button[title="Show sidebar"]').first().click();
      await sleep(250);
      o.flag('shown', await c.page.locator('.pal-card').first().isVisible());
    },
  });

  add({
    id: 'ui.shell.chat',
    title: 'Builder shell: toolbar controls, default name, pill, zoom, undo/redo disabled, minimap',
    run: async (c) => {
      const o = c.obs;
      await openBuilder(c);
      o.enum('name', await at(c, SEL.nameInput).first().inputValue());
      o.enum('pill', await pillText(c));
      o.enum('zoom', await zoomText(c));
      o.flag('backToFlows', (await c.page.locator('a[href="/flows"]').count()) > 0);
      o.flag('aiButton', await c.visible(SEL.ai));
      o.flag('testButton', await c.visible(SEL.test));
      o.flag('saveButton', await c.visible(SEL.save));
      o.flag('publishButton', await c.visible(SEL.publish));
      o.enum('saveLabel', ((await at(c, SEL.save).first().innerText()) || '').trim());
      o.flag('undo.disabled', await c.page.locator('button[title^="Undo"]').isDisabled());
      o.flag('redo.disabled', await c.page.locator('button[title^="Redo"]').isDisabled());
      o.flag('minimap', (await c.page.locator('.minimap').count()) > 0);
      o.flag('inspectorHidden', (await c.page.locator('aside.ins-panel').count()) === 0);
      o.flag(
        'canvasEmptyHint',
        (await c.page.locator('.canvas-empty').count()) > 0 ||
          (await seen(c, /drag|double-click/i)),
      );
      o.num('nodes', (await nodeCards(c)).length);
      o.set('info.title', await c.page.title());
      const nameMax = await at(c, SEL.nameInput).first().getAttribute('maxlength');
      o.enum('nameMaxlength', nameMax);
      await c.shot('shell');
    },
  });

  // ---------------------------------------------------------------------------------------------------------------
  // canvas: drag, wire, delete, start, duplicate, history, zoom, minimap, shortcuts
  // ---------------------------------------------------------------------------------------------------------------
  add({
    id: 'ui.canvas.drag-wire',
    title:
      'Canvas: drag nodes, first is START, trigger is a singleton, dbl-click adds at centre, wire, self-connection, edge popup',
    run: async (c) => {
      const o = c.obs;
      await openBuilder(c);
      await watchToasts(c);
      await dragCard(c, 'Send message', 480, 110);
      let ns = await nodeCards(c);
      o.num('afterFirstDrop', ns.length);
      o.flag('firstIsStart', ns[0]?.start === true);
      o.enum('pillAfterDrop', await pillText(c));
      o.flag('undoEnabled', !(await c.page.locator('button[title^="Undo"]').isDisabled()));
      await dragCard(c, 'Trigger', 200, 110);
      o.num('triggers', await countOf(c, 'Trigger'));
      const before = (await nodeCards(c)).length;
      await c.page
        .locator('.pal-card', { hasText: 'Trigger' })
        .first()
        .dragTo(c.page.locator(SEL.canvas).first(), { targetPosition: { x: 200, y: 330 } });
      await sleep(300);
      o.flag('secondTriggerRefused', (await nodeCards(c)).length === before);
      o.list('toast.trigger', await toastsMatching(c, /Trigger can only exist once/));
      await c.page.locator('.pal-card', { hasText: 'Condition' }).first().dblclick();
      await sleep(300);
      ns = await nodeCards(c);
      const cond = ns.find((n) => n.label === 'Condition');
      const cb = await canvasBox(c);
      const bb = cond ? await c.page.locator(`[data-node-id="${cond.id}"]`).boundingBox() : null;
      o.flag('dblclickAdded', !!cond);
      o.flag('dblclickCentred', !!bb && Math.abs(bb.x + bb.width / 2 - (cb.x + cb.width / 2)) < 14);
      await dragCard(c, 'Quick replies', 900, 150);
      await dragCard(c, 'End', 1000, 600);
      ns = await nodeCards(c);
      o.seq('labels', ns.map((n) => n.label).sort());
      o.num('starts', ns.filter((n) => n.start).length);
      const [t, m, q, cn, e] = await Promise.all(
        ['Trigger', 'Send message', 'Quick replies', 'Condition', 'End'].map((l) => idOf(c, l)),
      );
      o.flag('trigger.noInput', (await c.page.locator(inPort(t)).count()) === 0);
      o.seq('ports.condition', ns.find((n) => n.id === cn)?.ports ?? []);
      o.seq('ports.buttons', ns.find((n) => n.id === q)?.ports ?? []);
      o.seq('ports.end', ns.find((n) => n.id === e)?.ports ?? []);
      await wire(c, `[data-port^="out:${t}:"]`, inPort(m));
      await wire(c, `[data-port^="out:${m}:"]`, inPort(q));
      await wire(c, outPort(q, 'p0'), inPort(cn));
      const tb = await nodeTitle(c, e).boundingBox();
      await wireTo(c, outPort(cn, 'yes'), { x: tb.x + 8, y: tb.y + 4 }); // released over the card body
      await wire(c, outPort(cn, 'no'), inPort(e));
      o.num('edges', await edgeCount(c));
      await wire(c, `[data-port^="out:${m}:"]`, inPort(m));
      o.num('edgesAfterSelf', await edgeCount(c));
      await wire(c, `[data-port^="out:${m}:"]`, inPort(q)); // identical edge replaces itself
      o.num('edgesAfterDuplicateEdge', await edgeCount(c));
      await wire(c, `[data-port^="out:${m}:"]`, inPort(cn)); // fan out
      o.num('edgesAfterFanOut', await edgeCount(c));
      // preview line while dragging, Escape cancels
      const a = await portCenter(c, `[data-port^="out:${m}:"]`);
      await c.page.mouse.move(a.x, a.y);
      await c.page.mouse.down();
      await c.page.mouse.move(a.x + 90, a.y + 70, { steps: 4 });
      o.flag(
        'previewLine',
        (await c.page.locator('path.edge-path.preview, path.preview').count()) > 0,
      );
      await c.page.keyboard.press('Escape');
      await sleep(100);
      o.flag(
        'previewGoneAfterEsc',
        (await c.page.locator('path.edge-path.preview, path.preview').count()) === 0,
      );
      await c.page.mouse.up();
      o.num('edgesAfterEsc', await edgeCount(c));
      // click an edge: Delete popup
      await clickEmpty(c);
      const mid = await c.page
        .locator('path.edge-hit')
        .first()
        .evaluate((el) => {
          const pt = el.getPointAtLength(el.getTotalLength() / 2);
          const mm = el.getScreenCTM();
          return { x: pt.x * mm.a + mm.e, y: pt.y * mm.d + mm.f };
        });
      await c.page.mouse.click(mid.x, mid.y);
      await sleep(200);
      o.flag('edgePopup', (await c.page.locator('.edge-popup').count()) > 0);
      o.enum(
        'edgePopupText',
        (
          (await c.page
            .locator('.edge-popup')
            .first()
            .innerText()
            .catch(() => '')) || ''
        ).trim(),
      );
      const n0 = await edgeCount(c);
      await c.page.locator('.edge-popup').first().click();
      await sleep(150);
      o.num('edgesAfterDelete', await edgeCount(c));
      o.flag('edgeDeleted', (await edgeCount(c)) === n0 - 1);
      await c.page.keyboard.press('Control+z');
      await sleep(150);
      o.num('edgesAfterUndo', await edgeCount(c));
      await c.page.keyboard.press('Control+y');
      await sleep(150);
      o.num('edgesAfterRedo', await edgeCount(c));
      // drag a node: moves, one history entry
      const before2 = (await nodeCards(c)).find((n) => n.id === e);
      const eb = await nodeTitle(c, e).boundingBox();
      await c.page.mouse.move(eb.x + 30, eb.y + 5);
      await c.page.mouse.down();
      await c.page.mouse.move(eb.x - 70, eb.y + 25, { steps: 6 });
      await c.page.mouse.up();
      await sleep(150);
      const after2 = (await nodeCards(c)).find((n) => n.id === e);
      o.num('moved.dx', Math.round((after2.x - before2.x) / 10) * 10);
      o.num('moved.dy', Math.round((after2.y - before2.y) / 10) * 10);
      await c.shot('graph');
    },
  });

  add({
    id: 'ui.canvas.node-actions',
    title:
      'Node action bar: pin START, edit, duplicate (offset, no edges), trigger cannot duplicate, delete removes edges',
    run: async (c) => {
      const o = c.obs;
      await openBuilder(c);
      await watchToasts(c);
      await dragCard(c, 'Trigger', 160, 110);
      await dragCard(c, 'Send message', 520, 110);
      await dragCard(c, 'Quick replies', 880, 110);
      const [t, m, q] = await Promise.all(
        ['Trigger', 'Send message', 'Quick replies'].map((l) => idOf(c, l)),
      );
      await wire(c, `[data-port^="out:${t}:"]`, inPort(m));
      await wire(c, `[data-port^="out:${m}:"]`, inPort(q));
      await selectNode(c, q);
      o.num('actionButtons', await c.page.locator('.node-actions button').count());
      o.seq(
        'actionTitles',
        await c.page.locator('.node-actions button').evaluateAll((b) => b.map((x) => x.title)),
      );
      const orig = (await nodeCards(c)).find((n) => n.id === q);
      await c.page.keyboard.press('Control+d');
      await sleep(250);
      let ns = await nodeCards(c);
      const copy = ns.find((n) => n.label === 'Quick replies' && n.id !== q);
      o.flag('copy.exists', !!copy);
      o.num('copy.dx', copy ? copy.x - orig.x : null);
      o.num('copy.dy', copy ? copy.y - orig.y : null);
      o.flag('copy.notStart', copy ? !copy.start : null);
      o.flag('copy.selected', copy ? copy.selected : null);
      o.num('edgesAfterCopy', await edgeCount(c));
      await c.page.keyboard.press('Backspace');
      await sleep(200);
      o.num('nodesAfterBackspace', (await nodeCards(c)).length);
      // trigger cannot be duplicated
      await selectNode(c, t);
      await c.page.keyboard.press('Control+d');
      await sleep(200);
      o.num('triggersAfterDup', await countOf(c, 'Trigger'));
      o.list('toast.dupTrigger', await toastsMatching(c, /Trigger can only exist once/));
      // action-bar duplicate button
      await selectNode(c, m);
      await c.page.locator('.node-actions button[title^="Duplicate"]').click();
      await sleep(200);
      o.num('messagesAfterButtonDup', await countOf(c, 'Send message'));
      // pin START to the message node and back (clicking the current start unpins)
      await selectNode(c, m);
      await c.page.locator('.node-actions button').first().click();
      await sleep(120);
      ns = await nodeCards(c);
      o.seq(
        'start.afterPin',
        ns.filter((n) => n.start).map((n) => n.label),
      );
      await selectNode(c, m);
      await c.page.locator('.node-actions button').first().click();
      await sleep(120);
      ns = await nodeCards(c);
      o.num('start.afterUnpin', ns.filter((n) => n.start).length);
      // delete a connected node removes its edges
      await selectNode(c, m);
      await c.page.keyboard.press('Delete');
      await sleep(200);
      o.num('edgesAfterDeleteConnected', await edgeCount(c));
      // Escape clears the selection
      const q2 = await idOf(c, 'Quick replies');
      await selectNode(c, q2);
      await c.page.keyboard.press('Escape');
      await sleep(100);
      o.num('selectedAfterEsc', (await nodeCards(c)).filter((n) => n.selected).length);
      // action bar edit opens the inspector, close button hides it
      await selectNode(c, q2);
      await c.page.locator('.node-actions button[title^="Edit"]').click();
      await sleep(250);
      o.flag('inspectorOpen', (await c.page.locator('aside.ins-panel').count()) > 0);
      await c.page
        .locator(
          'aside.ins-panel button[title="Hide panel"], aside.ins-panel button[aria-label="Hide panel"]',
        )
        .first()
        .click()
        .catch(() => undefined);
      await sleep(200);
      o.flag('inspectorClosed', (await c.page.locator('aside.ins-panel').count()) === 0);
    },
  });

  add({
    id: 'ui.canvas.shortcuts',
    title: 'Shortcuts: undo/redo chords, ignored while typing, delete, history stack of 60',
    run: async (c) => {
      const o = c.obs;
      await openBuilder(c);
      for (const [i, l] of ['Send message', 'Send message', 'Send message'].entries())
        await dragCard(c, l, 220 + i * 320, 140 + i * 40);
      o.num('nodes', (await nodeCards(c)).length);
      await c.page.keyboard.press('Control+z');
      await sleep(120);
      o.num('afterCtrlZ', (await nodeCards(c)).length);
      await c.page.keyboard.press('Control+y');
      await sleep(120);
      o.num('afterCtrlY', (await nodeCards(c)).length);
      await c.page.keyboard.press('Control+z');
      await sleep(120);
      await c.page.keyboard.press('Control+Shift+z');
      await sleep(120);
      o.num('afterCtrlShiftZ', (await nodeCards(c)).length);
      await c.page.keyboard.press('Meta+z');
      await sleep(120);
      o.num('afterMetaZ', (await nodeCards(c)).length);
      // typing in the name input: Backspace / Ctrl+Z must not touch the canvas
      const id = await idOf(c, 'Send message');
      await selectNode(c, id);
      const nm = at(c, SEL.nameInput).first();
      await nm.click();
      await nm.fill('abc');
      await c.page.keyboard.press('Backspace');
      await c.page.keyboard.press('Control+z');
      await sleep(150);
      o.num('nodesWhileTyping', (await nodeCards(c)).length);
      o.enum('nameWhileTyping', await nm.inputValue());
      // history cap: add 66 nodes with double-click, then undo 70 times
      await clickEmpty(c);
      const card = c.page.locator('.pal-card', { hasText: 'End' }).first();
      const start = (await nodeCards(c)).length;
      for (let i = 0; i < 66; i++) await card.dblclick();
      await sleep(300);
      const peak = (await nodeCards(c)).length;
      o.num('peakAdded', peak - start);
      await c.page.locator(SEL.canvas).first().hover();
      for (let i = 0; i < 70; i++) await c.page.keyboard.press('Control+z');
      await sleep(300);
      o.num('afterUndoAll', (await nodeCards(c)).length - start);
      o.flag('undoDisabledAtBottom', await c.page.locator('button[title^="Undo"]').isDisabled());
    },
  });

  add({
    id: 'ui.canvas.zoom',
    title:
      'Zoom: button steps and limits, reset, ctrl+wheel around pointer, wheel pans, empty-canvas drag pans',
    run: async (c) => {
      const o = c.obs;
      await openBuilder(c);
      await dragCard(c, 'Send message', 400, 200);
      o.enum('initial', await zoomText(c));
      await c.page.locator('button[title="Zoom in"]').click();
      o.enum('in1', await zoomText(c));
      for (let i = 0; i < 25; i++)
        await c.page.locator('button[title="Zoom in"]').click({ force: true });
      o.enum('maxIn', await zoomText(c));
      o.flag('zoomInDisabledAtMax', await c.page.locator('button[title="Zoom in"]').isDisabled());
      for (let i = 0; i < 40; i++)
        await c.page.locator('button[title="Zoom out"]').click({ force: true });
      o.enum('maxOut', await zoomText(c));
      o.flag('zoomOutDisabledAtMin', await c.page.locator('button[title="Zoom out"]').isDisabled());
      await c.page.locator('button[title="Reset"]').first().click();
      await sleep(150);
      o.enum('afterReset', await zoomText(c));
      o.enum('resetTransform', await worldTransform(c));
      const bb = await canvasBox(c);
      await c.page.mouse.move(bb.x + 500, bb.y + 300);
      const t0 = await worldTransform(c);
      await c.page.mouse.wheel(0, 120);
      await sleep(150);
      o.flag('wheelPans', (await worldTransform(c)) !== t0);
      o.enum('zoomAfterWheel', await zoomText(c));
      await c.page.keyboard.down('Control');
      await c.page.mouse.wheel(0, -200);
      await c.page.keyboard.up('Control');
      await sleep(150);
      o.enum('zoomAfterCtrlWheelUp', await zoomText(c));
      await c.page.keyboard.down('Control');
      for (let i = 0; i < 30; i++) await c.page.mouse.wheel(0, 400);
      await c.page.keyboard.up('Control');
      await sleep(200);
      o.enum('zoomAfterCtrlWheelMany', await zoomText(c));
      await c.page.locator('button[title="Reset"]').first().click();
      const t1 = await worldTransform(c);
      await c.page.mouse.move(bb.x + 600, bb.y + 450);
      await c.page.mouse.down();
      await c.page.mouse.move(bb.x + 700, bb.y + 500, { steps: 5 });
      await c.page.mouse.up();
      await sleep(120);
      o.flag('dragPans', (await worldTransform(c)) !== t1);
      o.enum('zoomUnchangedByPan', await zoomText(c));
    },
  });

  add({
    id: 'ui.canvas.minimap',
    title: 'Minimap: size, shows nodes, viewport rectangle follows pan',
    run: async (c) => {
      const o = c.obs;
      await openBuilder(c);
      await dragCard(c, 'Trigger', 160, 110);
      await dragCard(c, 'Send message', 560, 260);
      const mm = c.page.locator('.minimap').first();
      const box = await mm.boundingBox();
      o.num('width', Math.round(box?.width ?? 0));
      o.num('height', Math.round(box?.height ?? 0));
      o.num('dots', await mm.locator('div, rect, circle').count());
      const shot0 = await mm.innerHTML();
      const bb = await canvasBox(c);
      await c.page.mouse.move(bb.x + 600, bb.y + 450);
      await c.page.mouse.down();
      await c.page.mouse.move(bb.x + 800, bb.y + 520, { steps: 5 });
      await c.page.mouse.up();
      await sleep(150);
      o.flag('minimapChangesOnPan', (await mm.innerHTML()) !== shot0);
      const t0 = await worldTransform(c);
      await c.page.mouse.click(box.x + 10, box.y + 10);
      await sleep(150);
      o.flag('minimapClickMoves', (await worldTransform(c)) !== t0);
    },
  });

  add({
    id: 'ui.canvas.option-removal',
    title:
      'Removing an option deletes its edge and renumbers the higher ports (Quick replies with 3 options wired)',
    run: async (c) => {
      const o = c.obs;
      await openBuilder(c);
      await dragCard(c, 'Trigger', 120, 120);
      await dragCard(c, 'Quick replies', 440, 120);
      for (const [i, y] of [60, 250, 440].entries())
        await dragCard(c, 'End', 900, y + (i ? 40 : 0));
      const [t, q] = await Promise.all(['Trigger', 'Quick replies'].map((l) => idOf(c, l)));
      await wire(c, `[data-port^="out:${t}:"]`, inPort(q));
      await openInspector(c, q);
      const addBtn = c.page
        .locator('aside.ins-panel button', { hasText: /^\s*\+?\s*Add (option|button)/i })
        .first();
      o.flag('addOptionButton', (await addBtn.count()) > 0);
      if (await addBtn.count()) await addBtn.click();
      await sleep(250);
      o.seq('ports.after3', (await nodeCards(c)).find((n) => n.id === q)?.ports ?? []);
      await c.page
        .locator(
          'aside.ins-panel button[title="Hide panel"], aside.ins-panel button[aria-label="Hide panel"]',
        )
        .first()
        .click()
        .catch(() => undefined);
      await sleep(250);
      const ends = (await nodeCards(c)).filter((n) => n.label === 'End').sort((a, b) => a.y - b.y);
      for (const [i, e] of ends.entries()) await wire(c, outPort(q, `p${i}`), inPort(e.id));
      o.num('edges.after3', await edgeCount(c));
      // remove the SECOND option from the inspector
      await openInspector(c, q);
      const rm = c.page
        .locator('aside.ins-panel button[aria-label="Remove"]')
        .or(c.page.locator('aside.ins-panel button').filter({ hasText: /^\s*[×✕]\s*$/ }));
      const nRm = await rm.count();
      o.num('removeButtons', nRm);
      if (nRm >= 2) await rm.nth(1).click();
      await sleep(300);
      o.seq('ports.afterRemove', (await nodeCards(c)).find((n) => n.id === q)?.ports ?? []);
      o.num('edges.afterRemove', await edgeCount(c));
      // which End does each remaining port feed? read through the preview paths is fragile; save and read back
      await at(c, SEL.save).first().click();
      await c.page.getByPlaceholder(/Welcome flow/i).fill(flowName(c, 'optrm'));
      await c.page.getByRole('button', { name: /^Save flow$/ }).click();
      await sleep(1500);
      const mine = await myFlows(c);
      o.num('rows', mine.length);
      for (const f of mine)
        c.onCleanup(() =>
          c.http('DELETE', delPath(c, f.id), { headers: c.side === 'ours' ? idem() : {} }),
        );
      if (mine[0]) {
        const g = (await apiGet(c, mine[0].id)).graph;
        const typeOf = new Map(g.flowNodes.map((n) => [n.id, n]));
        const endsY = g.flowNodes
          .filter((n) => n.type === 'end')
          .sort((a, b) => a.y - b.y)
          .map((n) => n.id);
        o.seq(
          'edges.persisted',
          g.flowEdges
            .filter((e) => typeOf.get(e.source)?.type === 'buttons')
            .map((e) => `${e.sourceHandle}>end#${endsY.indexOf(e.target)}`)
            .sort(),
        );
        o.num(
          'options.persisted',
          typeOf.get(g.flowNodes.find((n) => n.type === 'buttons').id).data.options.length,
        );
      }
    },
  });

  // ---------------------------------------------------------------------------------------------------------------
  // inspector: every node type available on both sides
  // ---------------------------------------------------------------------------------------------------------------
  const CHAT_NODES = [
    'Trigger',
    'End',
    'Send message',
    'Send template',
    'Send media',
    'Copy to number',
    'Send sequence',
    'Quick replies',
    'List message',
    'Ask question',
    'Condition',
    'Wait',
    'Webhook',
    'Run code (JS)',
    'MySQL Query',
    'Run sub-flow',
    'AI assistant',
    'Tag contact',
    'Assign agent',
    'Call to action',
    'Location',
    'Poll',
    'Chatbot',
    'Hand off to Instagram',
    'Book appointment',
    'AI voice call',
    'Google Meet',
    'WhatsApp form',
    'WhatsApp Shop',
    'WooCommerce',
    'Shopify',
    'Google Sheets',
    'Google Docs',
    'Google Form',
    'Create / move deal',
  ];
  const CALL_NODES = [
    'Trigger',
    'End',
    'Say',
    'Listen',
    'AI Respond',
    'AI Assistant',
    'Menu / Branch',
    'Search web',
    'Transfer',
    'Hang up',
    'Condition',
    'Wait',
    'Webhook',
    'Run code (JS)',
  ];
  const slugOf = (s) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

  async function inspectNode(c, label, path) {
    const o = c.obs;
    await openBuilder(c, path);
    const had = await c.page.locator('.pal-card', { hasText: label }).count();
    o.flag('inPalette', had > 0);
    if (!had) return;
    if (!(await dragCard(c, label, 520, 180))) {
      o.flag('added', false);
      return;
    }
    const id = (await nodeCards(c))[0].id;
    const card = (await nodeCards(c))[0];
    o.seq('card.ports', card.ports);
    o.enum(
      'card.text',
      await c.page
        .locator(`[data-node-id="${id}"]`)
        .innerText()
        .then((t) => t.replace(/\s+/g, ' ').replace(/n_[a-z0-9]{6}/, 'n_ID')),
    );
    await openInspector(c, id);
    const e = await c.page.evaluate(ENUM);
    if (!e) {
      o.flag('inspector', false);
      return;
    }
    o.enum('title', e.title);
    o.num('controls', e.rows.length);
    o.seq('rows', e.rows.map(rowKey));
    o.flag(
      'pickerShowsLoadingWhenEmpty',
      e.rows.some((r) => /^Loading /.test(r.value ?? '')),
    );
    o.flag(
      'placeholderShowsBackslashN',
      e.rows.some((r) => /\\n/.test(r.placeholder ?? '')),
    );
    o.seq(
      'buttons',
      e.buttons.filter((b) => !/^Delete|^Hide panel/.test(b)),
    );
    o.seq('heads', e.heads);
    // every select: every option picked once, then the fields the choice shows are enumerated
    const selects = await c.page.locator('aside.ins-panel select').count();
    for (let si = 0; si < Math.min(selects, 4); si++) {
      const sel = c.page.locator('aside.ins-panel select').nth(si);
      const opts = await sel
        .locator('option')
        .evaluateAll((os) => os.map((x) => ({ v: x.value, t: x.textContent.trim() })));
      if (opts.length > 14 || isDataPlaceholder(opts[0]?.t)) continue;
      for (const op of opts.slice(0, 12)) {
        await sel.selectOption(op.v).catch(() => undefined);
        await sleep(150);
        const e2 = await c.page.evaluate(ENUM);
        o.seq(`select${si}.${slugOf(op.t || op.v || 'blank')}`, (e2?.rows ?? []).map(rowKey));
      }
    }
    // text fields: a long value is kept, a script is kept as text
    const text = c.page
      .locator(
        'aside.ins-panel textarea, aside.ins-panel input[type=text], aside.ins-panel input:not([type])',
      )
      .first();
    if (await text.count()) {
      await text.fill(rep(3000)).catch(() => undefined);
      o.num('longText.kept', ((await text.inputValue().catch(() => '')) || '').length);
    }
  }
  for (const label of CHAT_NODES)
    add({
      id: `ui.inspector.chat.${slugOf(label)}`,
      title: `Inspector of "${label}" (WhatsApp flow): fields, kinds, defaults, option lists, limits`,
      tags: ['inspector'],
      run: (c) => inspectNode(c, label, '/flows/builder'),
    });
  for (const label of CALL_NODES.filter(
    (l) => !['Trigger', 'End', 'Condition', 'Wait', 'Webhook', 'Run code (JS)'].includes(l),
  ))
    add({
      id: `ui.inspector.call.${slugOf(label)}`,
      title: `Inspector of "${label}" (call flow)`,
      tags: ['inspector'],
      run: (c) => inspectNode(c, label, '/flows/builder?type=call'),
    });
  add({
    id: 'ui.inspector.call.trigger',
    title: 'Inspector of the Trigger in a call flow',
    tags: ['inspector'],
    run: (c) => inspectNode(c, 'Trigger', '/flows/builder?type=call'),
  });

  // limits of the repeatable rows
  const REPEATERS = [
    ['Quick replies', /Add (option|button)/i],
    ['List message', /Add (item|option|row)/i],
    ['Poll', /Add (option|choice)/i],
    ['Ask question', /Add (answer|expected|option)/i],
    ['Condition', /Add (rule|condition)/i],
    ['Send sequence', /^\s*Text\s*$/],
    ['Webhook', /Add (header)/i],
  ];
  for (const [label, re] of REPEATERS)
    add({
      id: `ui.inspector.limit.${slugOf(label)}`,
      title: `Repeatable rows of "${label}": how many can be added`,
      tags: ['inspector', 'limits'],
      run: async (c) => {
        const o = c.obs;
        await openBuilder(c);
        await dragCard(c, label, 520, 180);
        const id = (await nodeCards(c))[0].id;
        await openInspector(c, id);
        const btn = () => c.page.locator('aside.ins-panel button', { hasText: re }).first();
        o.flag('hasAddButton', (await btn().count()) > 0);
        const rowsNow = async () => (await c.page.evaluate(ENUM)).rows.length;
        const start = await rowsNow();
        let clicks = 0;
        for (let i = 0; i < 40; i++) {
          if (
            !(await btn().count()) ||
            (await btn()
              .isDisabled()
              .catch(() => true))
          )
            break;
          await btn().click();
          clicks += 1;
          await sleep(60);
        }
        o.num('clicksAccepted', clicks);
        o.num('rowsAdded', (await rowsNow()) - start);
        o.num('cardPorts', ((await nodeCards(c))[0]?.ports ?? []).length);
        o.flag(
          'buttonGoneOrDisabledAtEnd',
          !(await btn().count()) ||
            (await btn()
              .isDisabled()
              .catch(() => true)),
        );
      },
    });

  add({
    id: 'ui.inspector.trigger.kinds',
    title: 'Trigger inspector: every kind in the select, the fields each one shows',
    tags: ['inspector'],
    run: async (c) => {
      const o = c.obs;
      await openBuilder(c);
      await dragCard(c, 'Trigger', 300, 160);
      await openInspector(c, (await nodeCards(c))[0].id);
      const sel = c.page.locator('aside.ins-panel select').first();
      const opts = await sel
        .locator('option')
        .evaluateAll((os) => os.map((x) => ({ v: x.value, t: x.textContent.trim() })));
      o.seq(
        'kinds',
        opts.map((x) => `${x.v}=${x.t}`),
      );
      for (const op of opts) {
        await sel.selectOption(op.v).catch(() => undefined);
        await sleep(200);
        const e = await c.page.evaluate(ENUM);
        o.seq(`kind.${op.v}.rows`, (e?.rows ?? []).map(rowKey));
        const card = (await nodeCards(c))[0];
        o.seq(`kind.${op.v}.ports`, card.ports);
        o.enum(
          `kind.${op.v}.card`,
          await c.page
            .locator('[data-node-id]')
            .first()
            .innerText()
            .then((t) => t.replace(/\s+/g, ' ').replace(/n_[a-z0-9]{6}/, 'n_ID')),
        );
      }
      // keyword modes
      const modes = c.page.locator('aside.ins-panel input[type=radio]');
      o.num('radios', await modes.count());
    },
  });

  // ---------------------------------------------------------------------------------------------------------------
  // validation popup
  // ---------------------------------------------------------------------------------------------------------------
  async function buildAndSave(c, build) {
    await openBuilder(c);
    await watchToasts(c);
    await build();
    await at(c, SEL.save).first().click();
    await sleep(600);
  }

  add({
    id: 'ui.validate.dangling',
    title:
      'Pre-save popup: node with no incoming edge, outgoing-only node, leaf allowed, red outline, selection, reset on edge change',
    run: async (c) => {
      const o = c.obs;
      await buildAndSave(c, async () => {
        await dragCard(c, 'Trigger', 140, 110);
        await dragCard(c, 'Send message', 500, 110);
        await dragCard(c, 'Condition', 500, 340);
        await dragCard(c, 'Wait', 880, 340);
        const [t, m, cn, w] = await Promise.all(
          ['Trigger', 'Send message', 'Condition', 'Wait'].map((l) => idOf(c, l)),
        );
        await wire(c, `[data-port^="out:${t}:"]`, inPort(m));
        await wire(c, outPort(cn, 'yes'), inPort(w)); // Condition has an outgoing edge, no incoming one
      });
      const p = await popupOf(c);
      o.flag('popup', !!p);
      o.enum('heading', p?.heading);
      o.seq('lines', (p?.lines ?? []).slice(1));
      const ns = await nodeCards(c);
      o.num('invalidOutlined', ns.filter((n) => n.invalid).length);
      o.seq(
        'selected',
        ns.filter((n) => n.selected).map((n) => n.label),
      );
      o.enum('pill', await pillText(c));
      o.flag('saveModalShown', await seen(c, /Confirm name|Flow name/i));
      // connecting resets the popup
      const [m, cn] = await Promise.all(['Send message', 'Condition'].map((l) => idOf(c, l)));
      await wire(c, `[data-port^="out:${m}:"]`, inPort(cn));
      o.flag('popupGoneAfterEdgeChange', !(await popupOf(c)));
      o.num('invalidAfterEdgeChange', (await nodeCards(c)).filter((n) => n.invalid).length);
      await at(c, SEL.save).first().click();
      await sleep(600);
      o.flag('saveModalAfterFix', await seen(c, /Confirm name|Flow name/i));
      o.num('rowsCreated', (await myFlows(c)).length);
    },
  });

  add({
    id: 'ui.validate.many',
    title: 'Pre-save popup with nine loose nodes of different kinds: six reasons then "and N more"',
    run: async (c) => {
      const o = c.obs;
      await buildAndSave(c, async () => {
        const labels = [
          'Send message',
          'Send template',
          'Send media',
          'Quick replies',
          'List message',
          'Poll',
          'Location',
          'Wait',
          'Tag contact',
        ];
        for (const [i, l] of labels.entries())
          await dragCard(c, l, 140 + (i % 4) * 300, 120 + Math.floor(i / 4) * 200);
      });
      const p = await popupOf(c);
      o.enum('heading', p?.heading);
      o.num('lineCount', p?.lines.length);
      o.seq(
        'lines',
        (p?.lines ?? []).slice(1).map((l) => l.replace(/"[^"]+"/, '"X"')),
      );
    },
  });

  add({
    id: 'ui.validate.empty-and-no-trigger',
    title: 'Empty canvas and a graph without a Trigger are valid: the name modal opens',
    run: async (c) => {
      const o = c.obs;
      await openBuilder(c);
      await at(c, SEL.save).first().click();
      await sleep(500);
      o.flag('emptyCanvas.modal', await seen(c, /Confirm name|Flow name/i));
      o.flag('emptyCanvas.popup', !!(await popupOf(c)));
      await c.page
        .getByRole('button', { name: /^Cancel$/ })
        .first()
        .click()
        .catch(() => undefined);
      await sleep(200);
      await dragCard(c, 'Send message', 400, 160);
      await dragCard(c, 'End', 800, 160);
      const [m, e] = await Promise.all(['Send message', 'End'].map((l) => idOf(c, l)));
      await wire(c, `[data-port^="out:${m}:"]`, inPort(e));
      await at(c, SEL.save).first().click();
      await sleep(500);
      o.flag('noTrigger.modal', await seen(c, /Confirm name|Flow name/i));
      o.flag('noTrigger.popup', !!(await popupOf(c)));
    },
  });

  add({
    id: 'ui.validate.publish-invalid',
    title: 'Publish with an unconnected node: popup, nothing saved or published',
    run: async (c) => {
      const o = c.obs;
      await openBuilder(c);
      await dragCard(c, 'Trigger', 140, 110);
      await dragCard(c, 'Send message', 500, 110);
      await at(c, SEL.publish).first().click();
      await sleep(700);
      const p = await popupOf(c);
      o.enum('heading', p?.heading);
      o.seq('lines', (p?.lines ?? []).slice(1));
      o.flag('nameModal', await seen(c, /Confirm name|Flow name/i));
      o.num('rows', (await myFlows(c)).length);
      o.enum('pill', await pillText(c));
    },
  });

  // ---------------------------------------------------------------------------------------------------------------
  // save through the UI, reload, compare the persisted graph
  // ---------------------------------------------------------------------------------------------------------------
  async function saveNew(c, name, { enter = false } = {}) {
    await at(c, SEL.save).first().click();
    const input = c.page.getByPlaceholder(/Welcome flow/i);
    await input.waitFor({ timeout: 5000 });
    await input.fill(name);
    if (enter) await input.press('Enter');
    else await c.page.getByRole('button', { name: /^Save flow$/ }).click();
    await sleep(1600);
  }
  /** An edit that keeps the graph valid: the Send message text grows. */
  async function touch(c, text = ' edited') {
    await openInspector(c, await idOf(c, 'Send message'));
    const ta = c.page.locator('aside.ins-panel textarea').first();
    await ta.fill((await ta.inputValue()) + text);
    await sleep(100);
  }
  async function buildSmall(c) {
    await dragCard(c, 'Trigger', 140, 110);
    await dragCard(c, 'Send message', 500, 110);
    await dragCard(c, 'Condition', 860, 110);
    await dragCard(c, 'End', 1100, 400);
    const [t, m, cn, e] = await Promise.all(
      ['Trigger', 'Send message', 'Condition', 'End'].map((l) => idOf(c, l)),
    );
    await wire(c, `[data-port^="out:${t}:"]`, inPort(m));
    await wire(c, `[data-port^="out:${m}:"]`, inPort(cn));
    await wire(c, outPort(cn, 'yes'), inPort(e));
    await wire(c, outPort(cn, 'no'), inPort(e));
  }

  add({
    id: 'ui.save.new-flow-modal',
    title:
      'New flow: name modal (copy, blank disables Save, Cancel, Enter), toast, URL, pill, second save updates the same row',
    run: async (c) => {
      const o = c.obs;
      await openBuilder(c);
      await watchToasts(c);
      await buildSmall(c);
      await at(c, SEL.save).first().click();
      const input = c.page.getByPlaceholder(/Welcome flow/i);
      await input.waitFor({ timeout: 5000 });
      o.flag('modal.shown', true);
      o.enum('modal.placeholder', await input.getAttribute('placeholder'));
      o.enum('modal.maxlength', await input.getAttribute('maxlength'));
      o.flag('modal.focused', await input.evaluate((el) => document.activeElement === el));
      const saveBtn = c.page.getByRole('button', { name: /^Save flow$/ });
      o.flag('save.disabledBlank', await saveBtn.isDisabled());
      await input.fill('   ');
      o.flag('save.disabledSpaces', await saveBtn.isDisabled());
      await c.page
        .getByRole('button', { name: /^Cancel$/ })
        .first()
        .click();
      await sleep(200);
      o.flag('cancel.closes', (await c.page.getByPlaceholder(/Welcome flow/i).count()) === 0);
      o.num('rowsAfterCancel', (await myFlows(c)).length);
      o.enum('pillAfterCancel', await pillText(c));
      const name = flowName(c, 'new');
      await saveNew(c, name, { enter: true });
      o.num('rowsAfterEnter', (await myFlows(c)).length);
      o.list(
        'toast.saved',
        (await toastsMatching(c, /Flow saved/)).map((t) => t.replace(name, '<name>')),
      );
      o.enum('pillAfterSave', await pillText(c));
      o.flag('urlHasId', /\/flows\/builder\/[0-9a-f-]+$/.test(c.page.url()));
      o.enum('saveLabelAfter', ((await at(c, SEL.save).first().innerText()) || '').trim());
      o.enum('nameInput', await at(c, SEL.nameInput).first().inputValue());
      const mine = await myFlows(c);
      for (const f of mine)
        c.onCleanup(() =>
          c.http('DELETE', delPath(c, f.id), { headers: c.side === 'ours' ? idem() : {} }),
        );
      // second save updates the same row (no modal)
      await touch(c, ' v1');
      await at(c, SEL.save).first().click();
      await sleep(1200);
      o.flag('secondSave.noModal', (await c.page.getByPlaceholder(/Welcome flow/i).count()) === 0);
      o.num('rowsAfterSecondSave', (await myFlows(c)).length);
      if (mine[0]) {
        const f = await apiGet(c, mine[0].id);
        o.enum('stored.name', f.name === name ? 'same' : f.name);
        o.enum('stored.type', f.type);
        o.flag('stored.draft', !f.published && f.active);
        o.enum('stored.triggerKind', f.kind);
        recordShape(o, 'stored', f.graph);
        o.num('stored.nodes', f.graph?.flowNodes?.length);
        o.set('map.stored.starts', {
          n: (f.graph?.flowNodes ?? []).filter((n) => n.isStart).length,
        });
        o.seq(
          'stored.vars',
          (f.graph?.vars ?? []).map((v) => `${v.name}|${v.desc ?? ''}|${v.default ?? ''}`),
        );
        const msg = (f.graph?.flowNodes ?? []).find((n) => n.type === 'message');
        o.enum('stored.messageData', JSON.stringify(msg?.data));
        const trig = (f.graph?.flowNodes ?? []).find((n) => n.type === 'trigger');
        o.enum(
          'stored.triggerData',
          JSON.stringify(Object.fromEntries(Object.entries(trig?.data ?? {}).sort())),
        );
        const cnd = (f.graph?.flowNodes ?? []).find((n) => n.type === 'condition');
        o.enum('stored.conditionData', JSON.stringify(cnd?.data));
        o.flag(
          'stored.coordsAreNumbers',
          (f.graph?.flowNodes ?? []).every((n) => Number.isFinite(n.x) && Number.isFinite(n.y)),
        );
        // reload: the builder shows the same graph
        await c.page.reload();
        await c.page
          .locator('[data-node-id]')
          .first()
          .waitFor({ timeout: 10000 })
          .catch(() => undefined);
        await sleep(900);
        o.num('reload.nodes', (await nodeCards(c)).length);
        o.num('reload.edges', await edgeCount(c));
        o.enum('reload.pill', await pillText(c));
        o.enum('reload.name', await at(c, SEL.nameInput).first().inputValue());
        o.seq(
          'reload.starts',
          (await nodeCards(c)).filter((n) => n.start).map((n) => n.label),
        );
      }
    },
  });

  add({
    id: 'ui.save.update-reload',
    title:
      'Open a saved flow, edit (move, add, rename in the toolbar), save, reload: persisted graph and name',
    run: async (c) => {
      const o = c.obs;
      const id = await seed(c, miniGraph('Hello there'), { label: 'upd' });
      await openFlow(c, id);
      await watchToasts(c);
      o.num('loaded.nodes', (await nodeCards(c)).length);
      o.num('loaded.edges', await edgeCount(c));
      o.enum('loaded.pill', await pillText(c));
      o.enum('loaded.saveLabel', ((await at(c, SEL.save).first().innerText()) || '').trim());
      o.seq(
        'loaded.starts',
        (await nodeCards(c)).filter((n) => n.start).map((n) => n.label),
      );
      const m = await idOf(c, 'Send message');
      const nm = at(c, SEL.nameInput).first();
      const newName = flowName(c, 'renamed');
      await nm.fill(newName);
      o.enum('pill.afterRename', await pillText(c));
      const tb = await nodeTitle(c, m).boundingBox();
      await c.page.mouse.move(tb.x + 40, tb.y + 4);
      await c.page.mouse.down();
      await c.page.mouse.move(tb.x + 100, tb.y + 80, { steps: 6 });
      await c.page.mouse.up();
      await sleep(150);
      o.enum('pill.afterMove', await pillText(c));

      await openInspector(c, await idOf(c, 'Send message'));
      const ta = c.page.locator('aside.ins-panel textarea').first();
      await ta.fill('Edited text {{name}}');
      await sleep(100);
      await at(c, SEL.save).first().click();
      await sleep(1500);
      o.list(
        'toast.saved',
        (await toastsMatching(c, /Flow saved/)).map((t) => t.replace(newName, '<name>')),
      );
      o.enum('pill.afterSave', await pillText(c));
      const f = await apiGet(c, id);
      o.enum(
        'stored.name',
        f.name === newName ? 'renamed' : f.name === flowName(c, 'upd') ? 'old' : 'other',
      );
      recordShape(o, 'stored', f.graph);
      const msg = (f.graph?.flowNodes ?? []).find((n) => n.type === 'message');
      o.enum('stored.messageText', msg?.data?.text);
      o.flag('stored.messageMoved', !!msg && (msg.x !== 460 || msg.y !== 100));
      o.num('rows', (await myFlows(c)).length);
      await c.page.reload();
      await c.page
        .locator('[data-node-id]')
        .first()
        .waitFor({ timeout: 10000 })
        .catch(() => undefined);
      await sleep(900);
      o.num('reload.nodes', (await nodeCards(c)).length);
      o.enum(
        'reload.name',
        (await at(c, SEL.nameInput).first().inputValue()) === newName ? 'renamed' : 'other',
      );
      o.enum('reload.pill', await pillText(c));
    },
  });

  add({
    id: 'ui.save.failure',
    title: 'Save request fails (500): error toast, pill stays Unsaved, nothing stored, retry works',
    run: async (c) => {
      const o = c.obs;
      const id = await seed(c, miniGraph('before'), { label: 'fail' });
      await openFlow(c, id);
      await watchToasts(c);
      await touch(c, ' v1');
      const off = await c.failRequests(
        (r) =>
          ['POST', 'PUT'].includes(r.method()) &&
          /flows(\/api\/save|\/[0-9a-f-]+)?$/.test(
            new URL(r.url()).pathname.replace(/^\/api\/v2/, ''),
          ),
        500,
      );
      await at(c, SEL.save).first().click();
      await sleep(1200);
      o.list(
        'toast.failed',
        (await toastsMatching(c, /Save failed/i)).map((t) => t.replace(/:.*/, ':')),
      );
      o.enum('pill', await pillText(c));
      o.flag('saveUsable', !(await at(c, SEL.save).first().isDisabled()));
      await off();
      const f1 = await apiGet(c, id);
      o.num('stored.nodesAfterFail', f1.graph?.flowNodes?.length);
      await at(c, SEL.save).first().click();
      await sleep(1300);
      const f2 = await apiGet(c, id);
      o.num('stored.nodesAfterRetry', f2.graph?.flowNodes?.length);
      o.enum('pill.afterRetry', await pillText(c));
    },
  });

  add({
    id: 'ui.save.keyword-too-long',
    title: 'Trigger keywords of 300 characters: save fails with a message naming the limit',
    run: async (c) => {
      const o = c.obs;
      const id = await seed(c, miniGraph(), { label: 'kw' });
      await openFlow(c, id);
      await watchToasts(c);
      await openInspector(c, await idOf(c, 'Trigger'));
      const kw = c.page
        .locator('aside.ins-panel textarea, aside.ins-panel input[type=text]')
        .first();
      await kw.fill(rep(300));
      await sleep(150);
      await at(c, SEL.save).first().click();
      await sleep(1500);
      const toasts = await toastsMatching(c, /Save failed|too long/i);
      o.flag('failedToastShown', toasts.length > 0);
      o.flag(
        'namesLimit',
        toasts.some((t) => /255/.test(t)),
      );
      o.enum('pill', await pillText(c));
      const f = await apiGet(c, id);
      const trig = (f.graph?.flowNodes ?? []).find((n) => n.type === 'trigger');
      o.flag('graphWasStoredAnyway', String(trig?.data?.keywords ?? '').length === 300);
    },
  });

  // ---------------------------------------------------------------------------------------------------------------
  // publish / unpublish / pause pills
  // ---------------------------------------------------------------------------------------------------------------
  add({
    id: 'ui.publish.new-graph',
    title: 'Publish a never-saved graph: name modal, exactly one row, published, pill, toast',
    run: async (c) => {
      const o = c.obs;
      await openBuilder(c);
      await watchToasts(c);
      await buildSmall(c);
      await at(c, SEL.nameInput).first().fill(flowName(c, 'pub'));
      await at(c, SEL.publish).first().click();
      const input = c.page.getByPlaceholder(/Welcome flow/i);
      o.flag(
        'nameModalShown',
        await input
          .waitFor({ timeout: 4000 })
          .then(() => true)
          .catch(() => false),
      );
      if (await input.count()) {
        o.enum(
          'nameModal.prefill',
          (await input.inputValue()) === flowName(c, 'pub')
            ? 'toolbar name'
            : (await input.inputValue()) || 'blank',
        );
        await input.fill(flowName(c, 'pub'));
        await c.page.getByRole('button', { name: /^Save flow$/ }).click();
      }
      await sleep(2500);
      const mine = await myFlows(c);
      o.num('rows', mine.length);
      o.enum('pill', await pillText(c));
      o.list('toast.published', await toastsMatching(c, /^Published$|Publish failed/));
      for (const f of mine)
        c.onCleanup(() =>
          c.http('DELETE', delPath(c, f.id), { headers: c.side === 'ours' ? idem() : {} }),
        );
      const states = [];
      for (const f of mine) {
        const g = await apiGet(c, f.id);
        states.push(`${g.published ? 'published' : 'draft'}`);
      }
      o.seq('rowStates', states.sort());
    },
  });

  add({
    id: 'ui.publish.states',
    title:
      'Published flow: edit goes to Draft label, save keeps it published, API unpublish and pause reflected on reopen',
    run: async (c) => {
      const o = c.obs;
      const id = await seed(c, miniGraph(), { label: 'st' });
      await openFlow(c, id);
      await watchToasts(c);
      o.enum('pill.draft', await pillText(c));
      await at(c, SEL.publish).first().click();
      await sleep(1500);
      o.enum('pill.published', await pillText(c));
      o.list('toast.published', await toastsMatching(c, /^Published$|Publish failed/));
      o.flag('stored.published', (await apiGet(c, id)).published);
      await touch(c, ' v1');
      o.enum('pill.editedWhilePublished', await pillText(c));
      await at(c, SEL.save).first().click();
      await sleep(1400);
      o.enum('pill.afterSaveOfPublished', await pillText(c));
      o.flag('stillPublished', (await apiGet(c, id)).published);
      // publish while edited: publishes the stored graph, does not save the edit
      await touch(c, ' v1');
      const nBefore = (await apiGet(c, id)).graph?.flowNodes?.length;
      await at(c, SEL.publish).first().click();
      await sleep(1400);
      o.flag('publishDoesNotSaveEdits', (await apiGet(c, id)).graph?.flowNodes?.length === nBefore);
      // unpublish through the API, reopen
      const un = await c.http(
        'POST',
        c.side === 'wadesk' ? '/flows/api/unpublish' : `/v2/flows/${id}/unpublish`,
        c.side === 'wadesk' ? { data: { flow_id: id } } : { data: {}, headers: idem() },
      );
      o.status('unpublish', un.status);
      await openFlow(c, id);
      o.enum('pill.afterUnpublish', await pillText(c));
      // paused: published + inactive
      await c.http(
        'POST',
        c.side === 'wadesk' ? '/flows/api/publish' : `/v2/flows/${id}/publish`,
        c.side === 'wadesk' ? { data: { flow_id: id } } : { data: {}, headers: idem() },
      );
      const tg = await c.http(
        'POST',
        c.side === 'wadesk' ? `/flows/${id}/toggle` : `/v2/flows/${id}/toggle`,
        c.side === 'wadesk' ? { data: {} } : { data: {}, headers: idem() },
      );
      o.status('toggle', tg.status);
      const g = await apiGet(c, id);
      o.flag('paused.stored', g.published && !g.active);
      await openFlow(c, id);
      o.enum('pill.paused', await pillText(c));
      o.flag('publishButtonStillThere', await c.visible(SEL.publish));
    },
  });

  // ---------------------------------------------------------------------------------------------------------------
  // test panel
  // ---------------------------------------------------------------------------------------------------------------
  const panelText = async (c) =>
    (
      await at(c, SEL.testPanel)
        .first()
        .innerText()
        .catch(() => '')
    )
      .replace(/\s*\n+\s*/g, ' | ')
      .replace(/\b\d{1,2}:\d{2}\s?(AM|PM)?\b/gi, '<t>');
  const sendTest = async (c, text, wait = 900) => {
    const inp = at(c, SEL.testPanel).first().locator('input').first();
    await inp.fill(text);
    await inp.press('Enter');
    await sleep(wait);
  };
  add({
    id: 'ui.test.transcript',
    title:
      'Test runner on a small graph: first-message hint, keyword start, ask, merge tags, buttons, condition, restart',
    run: async (c) => {
      const o = c.obs;
      const g = G(
        [
          N(
            'n_t00001',
            'trigger',
            100,
            100,
            { kind: 'keyword', keywordMode: 'keywords', keywords: 'hello, hi' },
            true,
          ),
          N('n_a00001', 'ask', 460, 100, {
            prompt: 'Your name?',
            var: 'name',
            validate: 'text',
            options: [],
          }),
          N('n_m00001', 'message', 820, 100, { text: 'Hi {{name}}, plan is {{plan}}' }),
          N('n_b00001', 'buttons', 1180, 100, {
            prompt: 'Pick',
            options: ['Yes', 'No'],
            var: 'choice',
          }),
          N('n_c00001', 'condition', 1540, 60, {
            conditions: [{ variable: 'choice', operator: 'equals', value: 'Yes' }],
            operators: [],
          }),
          N('n_y00001', 'message', 1900, 20, { text: 'You said yes' }),
          N('n_d00001', 'delay', 1540, 300, { amount: 5, unit: 'min' }),
          N('n_e00001', 'end', 1900, 300, {}),
        ],
        [
          E('e_1', 'n_t00001', 'out', 'n_a00001'),
          E('e_2', 'n_a00001', 'out', 'n_m00001'),
          E('e_3', 'n_m00001', 'out', 'n_b00001'),
          E('e_4', 'n_b00001', 'p0', 'n_c00001'),
          E('e_5', 'n_c00001', 'yes', 'n_y00001'),
          E('e_6', 'n_c00001', 'no', 'n_d00001'),
          E('e_7', 'n_d00001', 'out', 'n_e00001'),
        ],
      );
      const id = await seed(c, g, { label: 'tst' });
      await openFlow(c, id);
      await at(c, SEL.test).first().click();
      await sleep(600);
      o.enum('opened', await panelText(c));
      await sendTest(c, 'hello', 1600);
      o.enum('afterKeyword', await panelText(c));
      await sendTest(c, 'Sam', 1800);
      o.enum('afterName', await panelText(c));
      await sendTest(c, 'yes', 2200);
      o.enum('afterChoice', await panelText(c));
      await at(c, SEL.testPanel)
        .first()
        .getByRole('button', { name: /Restart/ })
        .click();
      await sleep(600);
      o.enum('afterRestart', await panelText(c));
      await sendTest(c, 'something else', 1600);
      o.enum('offKeyword', await panelText(c));
      await sendTest(c, 'Kim', 1800);
      await sendTest(c, '2', 2600);
      o.enum('numberChoiceNo', await panelText(c));
      o.flag(
        'inputDisabledWhenFinished',
        await at(c, SEL.testPanel).first().locator('input').first().isDisabled(),
      );
    },
  });

  add({
    id: 'ui.test.empty-and-unwired',
    title: 'Test runner: empty canvas message; unwired port stops with a message',
    run: async (c) => {
      const o = c.obs;
      await openBuilder(c);
      await at(c, SEL.test).first().click();
      await sleep(600);
      o.enum('empty', await panelText(c));
      await c.page.keyboard.press('Escape');
      const g = G(
        [
          N(
            'n_t00001',
            'trigger',
            100,
            100,
            { kind: 'keyword', keywordMode: 'any', keywords: '' },
            true,
          ),
          N('n_b00001', 'buttons', 460, 100, {
            prompt: 'Pick',
            options: ['A', 'B'],
            var: 'choice',
          }),
        ],
        [E('e_1', 'n_t00001', 'out', 'n_b00001')],
      );
      const id = await seed(c, g, { label: 'unw' });
      await openFlow(c, id);
      await at(c, SEL.test).first().click();
      await sleep(500);
      o.enum('hintAny', await panelText(c));
      await sendTest(c, 'hey', 1600);
      await sendTest(c, 'B', 1200);
      o.enum('unwired', await panelText(c));
    },
  });

  add({
    id: 'ui.test.webhook-ssrf',
    title:
      'Test runner: a Webhook node pointed at a metadata address reports the block and continues',
    run: async (c) => {
      const o = c.obs;
      const g = G(
        [
          N(
            'n_t00001',
            'trigger',
            100,
            100,
            { kind: 'keyword', keywordMode: 'any', keywords: '' },
            true,
          ),
          N('n_w00001', 'webhook', 460, 100, {
            method: 'GET',
            url: 'http://169.254.169.254/latest',
            body: '',
            contentType: 'application/json',
            headers: [],
            save: 'response',
          }),
          N('n_m00001', 'message', 820, 100, { text: 'after webhook' }),
        ],
        [E('e_1', 'n_t00001', 'out', 'n_w00001'), E('e_2', 'n_w00001', 'out', 'n_m00001')],
      );
      const id = await seed(c, g, { label: 'whk' });
      await openFlow(c, id);
      await at(c, SEL.test).first().click();
      await sleep(500);
      await sendTest(c, 'go', 3500);
      o.enum('transcript', await panelText(c));
    },
  });

  // ---------------------------------------------------------------------------------------------------------------
  // AI generate modal
  // ---------------------------------------------------------------------------------------------------------------
  add({
    id: 'ui.ai.modal',
    title:
      'Generate with AI modal: tiles or the no-provider message, quick examples, Generate gating, error when generation fails',
    run: async (c) => {
      const o = c.obs;
      await openBuilder(c);
      await at(c, SEL.ai).first().click();
      await sleep(900);
      const modal = c.page
        .locator('div')
        .filter({ hasText: /AI Flow Generator|Generate a flow with AI/ })
        .last();
      const txt = async () =>
        (await c.page.locator('body').innerText()).replace(/\s*\n+\s*/g, ' | ');
      const t0 = await txt();
      o.flag('modal.title', /AI Flow Generator/i.test(t0));
      o.flag('modal.subtitle', /Pick a model, describe what you want/.test(t0));
      o.flag('modal.examples', /Quick examples/.test(t0));
      o.flag('modal.footer', /AI will replace the current flow/.test(t0));
      o.flag('modal.noProviders', /No AI providers/i.test(t0));
      o.num(
        'tiles',
        await c.page
          .locator('button')
          .filter({ hasText: /OpenAI|Anthropic|Google|Mistral/ })
          .count(),
      );
      const gen = c.page.getByRole('button', { name: /^Generate$/ });
      o.flag('generate.disabledEmpty', await gen.isDisabled());
      const ta = c.page.locator('textarea').last();
      o.enum('textarea.placeholder', ((await ta.getAttribute('placeholder')) || '').slice(0, 40));
      o.enum('textarea.maxlength', await ta.getAttribute('maxlength'));
      await ta.fill('Greet the customer and ask their name');
      o.flag('generate.disabledNoModel', await gen.isDisabled());
      const ex = c.page
        .locator('button')
        .filter({
          hasText: /Customer support bot|Order tracking|Lead qualification|Appointment booking/,
        });
      o.num('exampleButtons', await ex.count());
      if (await ex.count()) {
        await ex.first().click();
        o.flag('exampleFillsPrompt', ((await ta.inputValue()) || '').length > 20);
      }
      await c.page.keyboard.press('Escape');
      await sleep(300);
      const stillOpen = /AI Flow Generator/i.test(await txt());
      o.flag('escapeCloses', !stillOpen);
      if (!stillOpen) await at(c, SEL.ai).first().click();
      await sleep(500);
      await c.page
        .getByRole('button', { name: /^Cancel$/ })
        .first()
        .click();
      await sleep(300);
      o.flag('cancelCloses', !/AI Flow Generator/i.test(await txt()));
    },
  });

  // ---------------------------------------------------------------------------------------------------------------
  // XSS, responsive, vars
  // ---------------------------------------------------------------------------------------------------------------
  add({
    id: 'ui.xss.node-text',
    title:
      'Script in node text, flow name and merge tags: shown as text on the card, inspector, test panel and after reload',
    run: async (c) => {
      const o = c.obs;
      const payload = '<img src=x onerror=window.__xss=1><script>window.__xss=2</script>';
      const g = G(
        [
          N(
            'n_t00001',
            'trigger',
            100,
            100,
            { kind: 'keyword', keywordMode: 'any', keywords: '' },
            true,
          ),
          N('n_m00001', 'message', 460, 100, { text: payload }),
          N('n_b00001', 'buttons', 820, 100, {
            prompt: payload,
            options: [payload, 'ok'],
            var: 'choice',
          }),
        ],
        [E('e_1', 'n_t00001', 'out', 'n_m00001'), E('e_2', 'n_m00001', 'out', 'n_b00001')],
      );
      const s = await apiSave(c, {
        name: `${flowName(c, 'xss')} ${payload}`,
        graph: g,
        type: 'chat',
      });
      o.flag('saved', s.accepted);
      if (!s.accepted) return;
      await c.page.addInitScript(() => {
        window.__xss = 0;
      });
      await openFlow(c, s.id);
      await sleep(600);
      await openInspector(c, await idOf(c, 'Send message'));
      await at(c, SEL.test).first().click();
      await sleep(400);
      await sendTest(c, '<b>x</b>', 2200);
      o.flag('card.textShown', (await bodyText(c)).includes('<img src=x'));
      o.set('sec.xssExecuted', (await c.page.evaluate(() => window.__xss)) !== 0);
      o.flag('noInjectedImg', (await c.page.locator('img[src="x"]').count()) === 0);
      o.flag('nameShownAsText', (await at(c, SEL.nameInput).first().inputValue()).includes('<img'));
    },
  });

  add({
    id: 'ui.responsive.390',
    title:
      'Builder at 390 px: palette collapsed with an Add-node button, tap adds at the centre, no horizontal overflow',
    run: async (c) => {
      const o = c.obs;
      const h2 = await c.openAlso({ viewport: { width: 390, height: 844 } });
      const real = c.page;
      c.page = h2.page;
      try {
        await openBuilder(c);
        o.flag(
          'paletteVisible',
          (await c.page.locator('.pal-card').count()) > 0 &&
            (await c.page.locator('.pal-card').first().isVisible()),
        );
        const fab = c.page.getByRole('button', { name: /Add node/i });
        o.flag('addNodeButton', (await fab.count()) > 0);
        if (await fab.count()) {
          await fab.first().click();
          await sleep(400);
          o.flag(
            'drawerOpens',
            (await c.page.locator('.pal-card').count()) > 0 &&
              (await c.page.locator('.pal-card').first().isVisible()),
          );
          await c.page.locator('.pal-card', { hasText: 'Send message' }).first().dblclick();
          await sleep(400);
          o.num('nodesAfterTap', (await nodeCards(c)).length);
          o.flag(
            'drawerClosesAfterTap',
            !(await c.page
              .locator('.pal-card')
              .first()
              .isVisible()
              .catch(() => false)),
          );
        }
        o.num(
          'overflowX',
          Math.max(
            0,
            await c.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
          ),
        );
        o.flag('toolbarVisible', await c.visible(SEL.save));
        await c.shot('mobile');
      } finally {
        c.page = real;
      }
    },
  });

  // ---------------------------------------------------------------------------------------------------------------
  // API level
  // ---------------------------------------------------------------------------------------------------------------
  const record = (c, s) => {
    const o = c.obs;
    o.flag('accepted', s.accepted);
    o.enum('outcome', s.accepted ? 'saved' : s.r.status >= 500 ? 'crash' : 'rejected');
    o.set('status.save', Math.floor(s.r.status / 100) * 100);
    o.list('flagged', s.flagged);
  };
  const saveCases = [
    ['happy', {}],
    ['name.1', { name: 'a' }],
    ['name.255', { name: rep(255) }],
    ['name.256', { name: rep(256) }],
    ['name.empty', { name: '' }],
    ['name.spaces', { name: '   ' }],
    ['name.unicode', { name: 'Café Ünïcode ✓ 你好' }],
    ['name.emoji', { name: 'flow 😀' }],
    ['name.html', { name: '<b>x</b>' }],
    ['name.sql', { name: "x'; DROP TABLE flows; --" }],
    ['name.padded', { name: '  padded  ' }],
    ['category.64', { category: rep(64) }],
    ['category.65', { category: rep(65) }],
    ['category.null', { category: null }],
    ['type.call', { type: 'call' }],
    ['type.instagram', { type: 'instagram' }],
    ['type.invalid', { type: 'sms' }],
    ['type.empty', { type: '' }],
    ['graph.no-nodes', { graph: G([]) }],
    ['graph.nodes-not-array', { graph: { flowNodes: 'x', flowEdges: [], vars: [] } }],
    ['graph.no-edges-key', { graph: { flowNodes: [N('n_a', 'message', 1, 1, { text: 'x' })] } }],
    [
      'graph.dangling-edge',
      {
        graph: G(
          [N('n_a', 'message', 1, 1, { text: 'x' }, true)],
          [E('e_1', 'n_a', 'out', 'n_gone')],
        ),
      },
    ],
    ['graph.unknown-type', { graph: G([N('n_a', 'warp_drive', 1, 1, {}, true)]) }],
    [
      'graph.two-starts',
      {
        graph: G([
          N('n_a', 'message', 1, 1, { text: 'a' }, true),
          N('n_b', 'message', 2, 2, { text: 'b' }, true),
        ]),
      },
    ],
    [
      'graph.two-triggers',
      {
        graph: G([
          N('n_a', 'trigger', 1, 1, { kind: 'keyword' }, true),
          N('n_b', 'trigger', 2, 2, { kind: 'keyword' }),
        ]),
      },
    ],
    [
      'graph.dup-node-ids',
      {
        graph: G([
          N('n_a', 'message', 1, 1, { text: 'a' }),
          N('n_a', 'message', 2, 2, { text: 'b' }),
        ]),
      },
    ],
    ['graph.no-coords', { graph: G([{ id: 'n_a', type: 'message', data: { text: 'a' } }]) }],
    [
      'graph.string-coords',
      { graph: G([{ id: 'n_a', type: 'message', x: '12', y: '5', data: { text: 'a' } }]) },
    ],
    ['graph.node-not-object', { graph: G(['x']) }],
    ['graph.vars-strings', { graph: { flowNodes: [], flowEdges: [], vars: ['a'] } }],
    ['graph.huge-text', { graph: G([N('n_a', 'message', 1, 1, { text: rep(200000) }, true)]) }],
    [
      'graph.nodes-500',
      { graph: G(Array.from({ length: 500 }, (_, i) => N(`n_${i}`, 'end', i, 0, {}, i === 0))) },
    ],
    [
      'graph.nodes-501',
      { graph: G(Array.from({ length: 501 }, (_, i) => N(`n_${i}`, 'end', i, 0, {}, i === 0))) },
    ],
    [
      'graph.edges-2001',
      {
        graph: G(
          [
            N('n_a', 'message', 1, 1, { text: 'a' }, true),
            N('n_b', 'message', 2, 2, { text: 'b' }),
          ],
          Array.from({ length: 2001 }, (_, i) => E(`e_${i}`, 'n_a', 'out', 'n_b')),
        ),
      },
    ],
    [
      'trigger.kind-invalid',
      { graph: G([N('n_a', 'trigger', 1, 1, { kind: 'nonsense', keywords: 'x' }, true)]) },
    ],
    [
      'trigger.keywords-255',
      {
        graph: G([
          N(
            'n_a',
            'trigger',
            1,
            1,
            { kind: 'keyword', keywordMode: 'keywords', keywords: rep(255) },
            true,
          ),
        ]),
      },
    ],
    [
      'trigger.keywords-256',
      {
        graph: G([
          N(
            'n_a',
            'trigger',
            1,
            1,
            { kind: 'keyword', keywordMode: 'keywords', keywords: rep(256) },
            true,
          ),
        ]),
      },
    ],
    [
      'trigger.keywords-300',
      {
        graph: G([
          N(
            'n_a',
            'trigger',
            1,
            1,
            { kind: 'keyword', keywordMode: 'keywords', keywords: rep(300) },
            true,
          ),
        ]),
      },
    ],
    [
      'trigger.any',
      { graph: G([N('n_a', 'trigger', 1, 1, { kind: 'keyword', keywordMode: 'any' }, true)]) },
    ],
  ];
  for (const [id, over] of saveCases)
    add({
      id: `api.save.${id}`,
      title: `Save API: ${id}`,
      tags: ['edge', 'validation'],
      api: true,
      run: async (c) => {
        const args = { name: flowName(c, 'sv'), graph: miniGraph(), type: 'chat', ...over };
        if (over.name !== undefined && over.name.trim() && over.name.length < 250)
          args.name = `${flowName(c, 'sv')} ${over.name}`;
        else if (over.name !== undefined && over.name.length >= 250)
          args.name = (flowName(c, 'sv') + over.name).slice(0, over.name.length);
        const s = await apiSave(c, args);
        record(c, s);
        if (s.accepted && s.id != null) {
          const f = await apiGet(c, s.id);
          c.obs.enum('stored.type', f.type);
          c.obs.enum('stored.category', f.category);
          c.obs.num(
            'stored.nameLength',
            String(f.name ?? '').length - (over.name !== undefined ? 0 : 0) > 0 ? 1 : 0,
          );
          c.obs.enum('stored.triggerKind', f.kind);
          recordShape(c.obs, 'stored', f.graph);
          c.obs.num('stored.nodes', f.graph?.flowNodes?.length ?? -1);
        }
      },
    });

  add({
    id: 'api.save.missing-fields',
    title: 'Save API: missing name, missing graph, empty body',
    api: true,
    run: async (c) => {
      const o = c.obs;
      const none = await apiSave(c, {
        raw: c.side === 'wadesk' ? { flow_data: miniGraph() } : { graph: miniGraph() },
      });
      o.flag('noName.accepted', none.accepted);
      o.list('noName.flagged', none.flagged);
      const nog = await apiSave(c, {
        raw: c.side === 'wadesk' ? { flow_name: flowName(c, 'ng') } : { name: flowName(c, 'ng') },
      });
      o.flag('noGraph.accepted', nog.accepted);
      o.list('noGraph.flagged', nog.flagged);
      const empty = await apiSave(c, { raw: {} });
      o.flag('emptyBody.accepted', empty.accepted);
      o.status('emptyBody', Math.floor(empty.r.status / 100) * 100);
    },
  });

  add({
    id: 'api.save.update-and-ownership',
    title: 'Save API: update keeps the id, unknown id is 404, another id format is refused',
    api: true,
    run: async (c) => {
      const o = c.obs;
      const a = await apiSave(c, {
        name: flowName(c, 'up1'),
        graph: miniGraph('one'),
        type: 'chat',
      });
      const b = await apiSave(c, {
        id: a.id,
        name: flowName(c, 'up2'),
        graph: miniGraph('two'),
        type: 'chat',
      });
      o.flag('update.accepted', b.accepted);
      o.flag('update.sameId', b.id === a.id);
      o.num('rows', (await myFlows(c)).length);
      const f = await apiGet(c, a.id);
      o.enum(
        'stored.name',
        f.name === flowName(c, 'up2') || /up2/.test(f.name) ? 'updated' : 'old',
      );
      const ghost = await apiSave(c, {
        id: c.side === 'wadesk' ? 999999999 : '00000000-0000-4000-8000-000000000000',
        name: flowName(c, 'gh'),
        graph: miniGraph(),
      });
      o.enum('unknownId', statusClass(ghost.r.status));
      const bad = await apiSave(c, {
        id: c.side === 'wadesk' ? 'abc' : '12345',
        name: flowName(c, 'gh2'),
        graph: miniGraph(),
      });
      o.enum('badIdFormat', statusClass(bad.r.status));
      o.num('rowsAfterGhost', (await myFlows(c)).length);
      const get = await c.http(
        'GET',
        c.side === 'wadesk'
          ? '/flows/api/999999999'
          : '/v2/flows/00000000-0000-4000-8000-000000000000',
      );
      o.enum('getUnknown', statusClass(get.status));
    },
  });

  add({
    id: 'api.access.unauthenticated',
    title: 'Builder endpoints without a session',
    api: true,
    run: async (c) => {
      const o = c.obs;
      const call = async (label, method, wd, ours) => {
        const r = await c.http(method, c.side === 'wadesk' ? wd : ours, {
          anonymous: true,
          data: method === 'POST' ? {} : undefined,
        });
        o.flag(`${label}.refused`, [401, 403, 302, 419].includes(r.status));
        o.flag(
          `${label}.contentHidden`,
          !(
            r.status === 200 &&
            /flow/i.test(String(r.text).slice(0, 4000)) &&
            !/login/i.test(String(r.text))
          ),
        );
      };
      await call('save', 'POST', '/flows/api/save', '/v2/flows');
      await call(
        'publish',
        'POST',
        '/flows/api/publish',
        `/v2/flows/${crypto.randomUUID()}/publish`,
      );
      await call('get', 'GET', '/flows/api/1', `/v2/flows/${crypto.randomUUID()}`);
      await call('testWebhook', 'POST', '/flows/api/test-webhook', '/v2/flows/test-webhook');
      await call('aiGenerate', 'POST', '/flows/api/ai-generate', '/v2/flows/ai-generate');
      await call('upload', 'POST', '/flows/api/upload-media', '/v2/flows/upload-media');
      await call('builderPage', 'GET', '/flows/builder', '/flows/builder');
    },
  });

  add({
    id: 'api.publish-unpublish',
    title: 'Publish / unpublish endpoints: states, unknown id, repeated calls',
    api: true,
    run: async (c) => {
      const o = c.obs;
      const s = await apiSave(c, { name: flowName(c, 'pb'), graph: miniGraph(), type: 'chat' });
      const pub = (id) =>
        c.http(
          'POST',
          c.side === 'wadesk' ? '/flows/api/publish' : `/v2/flows/${id}/publish`,
          c.side === 'wadesk' ? { data: { flow_id: id } } : { data: {}, headers: idem() },
        );
      const unp = (id) =>
        c.http(
          'POST',
          c.side === 'wadesk' ? '/flows/api/unpublish' : `/v2/flows/${id}/unpublish`,
          c.side === 'wadesk' ? { data: { flow_id: id } } : { data: {}, headers: idem() },
        );
      const r1 = await pub(s.id);
      o.enum('publish', statusClass(r1.status));
      let g = await apiGet(c, s.id);
      o.flag('published', g.published);
      o.flag('active', g.active);
      const r2 = await pub(s.id);
      o.enum('publishAgain', statusClass(r2.status));
      const r3 = await unp(s.id);
      o.enum('unpublish', statusClass(r3.status));
      g = await apiGet(c, s.id);
      o.flag('afterUnpublish.published', g.published);
      const r4 = await unp(s.id);
      o.enum('unpublishAgain', statusClass(r4.status));
      const ghost = c.side === 'wadesk' ? 999999999 : '00000000-0000-4000-8000-000000000000';
      o.enum('publishUnknown', statusClass((await pub(ghost)).status));
      o.enum('unpublishUnknown', statusClass((await unp(ghost)).status));
    },
  });

  // webhook test endpoint (SSRF)
  const hooks = [
    ['metadata-ip', 'http://169.254.169.254/latest/meta-data'],
    ['loopback', 'http://127.0.0.1/'],
    ['localhost', 'http://localhost:9/'],
    ['private-10', 'http://10.0.0.1/'],
    ['private-192', 'http://192.168.1.1/'],
    ['private-172', 'http://172.16.0.1/'],
    ['ipv6-loopback', 'http://[::1]/'],
    ['metadata-host', 'http://metadata.google.internal/x'],
    ['internal-suffix', 'http://service.internal/x'],
    ['decimal-ip', 'http://2130706433/'],
    ['ftp', 'ftp://example.com/'],
    ['file', 'file:///etc/passwd'],
    ['gopher', 'gopher://example.com/'],
    ['javascript', 'javascript:alert(1)'],
    ['no-scheme', 'example.com/x'],
    ['unresolvable', 'http://no-such-host.invalid/'],
    ['empty', ''],
    ['spaces', '   '],
    ['too-long', `http://example.com/${rep(2100)}`],
    ['userinfo', 'http://user:pw@127.0.0.1/'],
  ];
  for (const [id, url] of hooks)
    add({
      id: `api.webhook.${id}`,
      title: `Webhook test endpoint: ${id}`,
      tags: ['security'],
      api: true,
      run: async (c) => {
        const o = c.obs;
        const r = await c.http(
          'POST',
          c.side === 'wadesk' ? '/flows/api/test-webhook' : '/v2/flows/test-webhook',
          { data: { url, method: 'GET' }, headers: c.side === 'ours' ? idem() : {} },
        );
        const b = r.body && typeof r.body === 'object' ? r.body : {};
        o.enum('status', statusClass(r.status));
        o.flag('ok', b.ok === true);
        o.flag('blocked', /^Blocked/.test(String(b.error ?? '')));
        o.enum(
          'errorKind',
          String(b.error ?? '')
            .replace(/\(.*\)/, '()')
            .replace(/:.*$/, ':'),
        );
        o.set('info.error', b.error ?? null);
        o.set(
          'sec.reachedPrivateHost',
          b.ok === true && /127\.|10\.|169\.254|192\.168|::1|localhost/.test(url),
        );
      },
    });
  add({
    id: 'api.webhook.methods-and-shape',
    title:
      'Webhook test endpoint: bad method, headers, body, vars substitution into the URL, missing url',
    tags: ['security'],
    api: true,
    run: async (c) => {
      const o = c.obs;
      const call = async (data) =>
        await c.http(
          'POST',
          c.side === 'wadesk' ? '/flows/api/test-webhook' : '/v2/flows/test-webhook',
          { data, headers: c.side === 'ours' ? idem() : {} },
        );
      const a = await call({});
      o.enum('noUrl.status', statusClass(a.status));
      const b = await call({ url: 'http://127.0.0.1/', method: 'TRACE' });
      o.enum('badMethod.status', statusClass(b.status));
      o.flag('badMethod.blocked', /^Blocked/.test(String(b.body?.error ?? '')));
      const d = await call({ url: 'http://{{host}}/', vars: { host: '127.0.0.1' } });
      o.flag('varsInUrl.blocked', /^Blocked/.test(String(d.body?.error ?? '')));
      const e = await call({
        url: 'http://127.0.0.1/',
        headers: [
          { key: 'X-A', value: 'b' },
          { key: '', value: 'skip' },
        ],
        body: '{"a":1}',
        contentType: 'application/json',
      });
      o.flag('headersBody.blocked', /^Blocked/.test(String(e.body?.error ?? '')));
      const f = await call({ url: 'http://127.0.0.1/', method: 'x'.repeat(11) });
      o.enum('methodTooLong.status', statusClass(f.status));
    },
  });

  // media upload errors
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const upload = async (c, { name, buf, mime, type, noFile = false }) => {
    const path = c.side === 'wadesk' ? '/flows/api/upload-media' : '/v2/flows/upload-media';
    const multipart = {};
    if (!noFile) multipart.file = { name, mimeType: mime, buffer: buf };
    if (type !== undefined) multipart.type = type;
    return c.http('POST', path, { multipart, headers: c.side === 'ours' ? idem() : {} });
  };
  const uploads = [
    ['no-file', { noFile: true, type: 'image' }],
    ['no-type', { name: 'a.png', buf: png, mime: 'image/png' }],
    ['bad-type', { name: 'a.png', buf: png, mime: 'image/png', type: 'sticker' }],
    [
      'php',
      {
        name: 'shell.php',
        buf: Buffer.from('<?php echo 1;'),
        mime: 'application/x-php',
        type: 'document',
      },
    ],
    [
      'php-as-png',
      { name: 'shell.png', buf: Buffer.from('<?php echo 1;'), mime: 'image/png', type: 'image' },
    ],
    [
      'html',
      {
        name: 'a.html',
        buf: Buffer.from('<script>alert(1)</script>'),
        mime: 'text/html',
        type: 'document',
      },
    ],
    [
      'svg',
      {
        name: 'a.svg',
        buf: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
        mime: 'image/svg+xml',
        type: 'image',
      },
    ],
    [
      'exe',
      {
        name: 'a.exe',
        buf: Buffer.from('MZ....'),
        mime: 'application/octet-stream',
        type: 'document',
      },
    ],
    ['no-extension', { name: 'noext', buf: png, mime: 'image/png', type: 'image' }],
    ['double-extension', { name: 'a.php.png', buf: png, mime: 'image/png', type: 'image' }],
    ['empty-file', { name: 'a.png', buf: Buffer.alloc(0), mime: 'image/png', type: 'image' }],
    ['long-name', { name: `${rep(300)}.png`, buf: png, mime: 'image/png', type: 'image' }],
    [
      'over-50mb',
      { name: 'big.mp4', buf: Buffer.alloc(52 * 1024 * 1024, 1), mime: 'video/mp4', type: 'video' },
    ],
  ];
  for (const [id, args] of uploads)
    add({
      id: `api.upload.${id}`,
      title: `Media upload: ${id}`,
      tags: ['security', 'upload'],
      api: true,
      run: async (c) => {
        const o = c.obs;
        const r = await upload(c, args);
        const b = r.body && typeof r.body === 'object' ? r.body : {};
        o.enum('status', statusClass(r.status));
        o.flag('accepted', r.status === 200 || r.status === 201);
        o.flag('hasUrl', !!(b.data?.url ?? b.url));
        o.set('info.body', JSON.stringify(b).slice(0, 220));
        const url = b.data?.url;
        o.set('sec.serverNameKeepsClientExtension', !!url && /\.php/i.test(String(url)));
      },
    });
  add({
    id: 'api.upload.png-ok',
    title: 'Media upload: a real PNG (needs object storage on ours)',
    tags: ['upload'],
    api: true,
    run: async (c) => {
      const o = c.obs;
      const r = await upload(c, { name: 'dot.png', buf: png, mime: 'image/png', type: 'image' });
      const b = r.body && typeof r.body === 'object' ? r.body : {};
      o.enum('status', statusClass(r.status));
      o.flag('absoluteUrl', /^https?:\/\//.test(String(b.data?.url ?? '')));
      o.enum('type', b.data?.type ?? null);
      o.enum('mimeType', b.data?.mimeType ?? null);
      o.flag('filenameRandomised', !!b.data?.filename && b.data.filename !== 'dot.png');
      o.set('info.body', JSON.stringify(b).slice(0, 220));
    },
  });

  // AI generate endpoint errors
  const aiCases = [
    ['no-key', { prompt: 'Greet and ask a name', model: 'gpt-4o-mini', provider: 'openai' }],
    ['anthropic', { prompt: 'x', model: 'claude-sonnet-4-6', provider: 'anthropic' }],
    ['mistral', { prompt: 'x', model: 'mistral-large-latest', provider: 'mistral' }],
    ['bad-provider', { prompt: 'x', model: 'm', provider: 'cohere' }],
    ['prompt-2000', { prompt: rep(2000), model: 'gpt-4o-mini', provider: 'openai' }],
    ['prompt-2001', { prompt: rep(2001), model: 'gpt-4o-mini', provider: 'openai' }],
    ['prompt-empty', { prompt: '', model: 'gpt-4o-mini', provider: 'openai' }],
    ['model-empty', { prompt: 'x', model: '', provider: 'openai' }],
    ['model-121', { prompt: 'x', model: rep(121), provider: 'openai' }],
    [
      'flow-type-invalid',
      { prompt: 'x', model: 'gpt-4o-mini', provider: 'openai', flow_type: 'sms' },
    ],
  ];
  for (const [id, data] of aiCases)
    add({
      id: `api.ai.${id}`,
      title: `AI generate endpoint: ${id}`,
      api: true,
      run: async (c) => {
        const o = c.obs;
        const body = { ...data };
        if (c.side === 'ours' && 'flow_type' in body) {
          body.flowType = body.flow_type;
          delete body.flow_type;
        }
        const r = await c.http(
          'POST',
          c.side === 'wadesk' ? '/flows/api/ai-generate' : '/v2/flows/ai-generate',
          { data: body, headers: c.side === 'ours' ? idem() : {} },
        );
        o.enum('status', statusClass(r.status));
        o.flag('ok', r.body?.ok === true || (r.status === 200 && !!r.body?.flow));
        o.set('info.body', JSON.stringify(r.body).slice(0, 220));
      },
    });

  // import / export round trip
  add({
    id: 'api.export-import.roundtrip',
    title:
      'Export a flow on each side and import it into the other (and into itself); compare shape, name, type, state',
    api: true,
    run: async (c) => {
      const o = c.obs;
      const g = G(
        [
          N(
            'n_t00001',
            'trigger',
            100,
            100,
            { kind: 'keyword', keywordMode: 'keywords', keywords: 'hello' },
            true,
          ),
          N('n_c00001', 'condition', 460, 100, {
            conditions: [{ variable: 'a', operator: 'equals', value: 'b' }],
            operators: [],
          }),
          N('n_m00001', 'message', 820, 40, { text: 'yes' }),
          N('n_b00001', 'buttons', 820, 260, {
            prompt: 'Pick',
            options: ['A', 'B', 'C'],
            var: 'choice',
          }),
        ],
        [
          E('e_1', 'n_t00001', 'out', 'n_c00001'),
          E('e_2', 'n_c00001', 'yes', 'n_m00001'),
          E('e_3', 'n_c00001', 'no', 'n_b00001'),
        ],
        [{ name: 'name', desc: 'Contact name', default: '' }],
      );
      const s = await apiSave(c, {
        name: flowName(c, 'exp'),
        graph: g,
        type: 'chat',
        category: 'Sales',
      });
      o.flag('seeded', s.accepted);
      const ex = await c.http(
        'GET',
        c.side === 'wadesk' ? `/flows/${s.id}/export` : `/v2/flows/${s.id}/export`,
      );
      const file = ex.body && typeof ex.body === 'object' ? ex.body : {};
      o.enum('export.status', statusClass(ex.status));
      o.enum('export.marker', String(file._wadesk_flow_export));
      o.seq('export.keys', Object.keys(file));
      o.flag('export.hasExportedAt', typeof file.exported_at === 'string');
      o.enum('export.flowType', file.flow_type);
      o.enum('export.category', file.category);
      o.flag('export.nameKept', String(file.name ?? '').includes(c.tagBase));
      o.seq('export.disposition', [
        String(ex.headers['content-disposition'] ?? '').replace(/filename="[^"]*"/, 'filename="…"'),
      ]);
      recordShape(o, 'export', file.flow_data);
      o.flag('export.noWorkspaceIds', !JSON.stringify(file).match(/workspace|user_id|org_id/i));
      // the other side's export file, written by the sibling spec run through a shared fixture
      const mine = JSON.stringify(file);
      const doImport = async (payload, label) => {
        let r;
        if (c.side === 'wadesk') {
          r = await c.http('POST', '/flows/import', {
            multipart: {
              file: {
                name: 'flow.json',
                mimeType: 'application/json',
                buffer: Buffer.from(
                  typeof payload === 'string' ? payload : JSON.stringify(payload),
                ),
              },
            },
          });
        } else {
          let parsed;
          try {
            parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
          } catch {
            parsed = null;
          }
          r =
            parsed === null
              ? { status: 422, body: {} }
              : await c.http('POST', '/v2/flows/import', {
                  data: { payload: parsed },
                  headers: idem(),
                });
        }
        const b = r.body && typeof r.body === 'object' ? r.body : {};
        const all = [...(await myFlows(c)), ...(await strays(c))];
        for (const f of all)
          if (!ownedIds.has(f.id)) {
            ownedIds.add(f.id);
            c.onCleanup(() =>
              c.http('DELETE', delPath(c, f.id), { headers: c.side === 'ours' ? idem() : {} }),
            );
          }
        return { r, b, all };
      };
      const ownedIds = new Set();
      const before = (await myFlows(c)).length;
      const i1 = await doImport(mine, 'self');
      o.num('self.rowsAdded', i1.all.length - before);
      const imp = i1.all.filter((f) => f.id !== s.id)[0];
      if (imp) {
        const got = await apiGet(c, imp.id);
        o.flag('self.nameSuffix', /\(imported\)$/.test(String(got.name)));
        o.enum('self.type', got.type);
        o.enum('self.category', got.category);
        o.flag('self.draft', !got.published);
        recordShape(o, 'self', got.graph);
        o.seq(
          'self.vars',
          (got.graph?.vars ?? []).map((v) => `${v.name}|${v.desc ?? ''}`),
        );
      }
      // malformed imports
      const bad = [
        ['not-json', 'this is not json'],
        [
          'no-nodes',
          JSON.stringify({ _wadesk_flow_export: 1, name: flowName(c, 'nn'), flow_data: {} }),
        ],
        [
          'nodes-not-array',
          JSON.stringify({ name: flowName(c, 'na'), flow_data: { flowNodes: 'x' } }),
        ],
        [
          'bare-graph',
          JSON.stringify({
            flowNodes: [N('n_a', 'message', 1, 1, { text: `${c.tagBase} bare` }, true)],
            flowEdges: [],
            vars: [],
          }),
        ],
        ['empty-object', '{}'],
        ['array', '[]'],
        [
          'wrong-marker',
          JSON.stringify({
            _wadesk_flow_export: 2,
            name: flowName(c, 'wm'),
            flow_data: G([N('n_a', 'message', 1, 1, { text: 'a' }, true)]),
          }),
        ],
        [
          'name-300',
          JSON.stringify({
            _wadesk_flow_export: 1,
            name: (flowName(c, 'n3') + rep(300)).slice(0, 300),
            flow_type: 'chat',
            flow_data: G([N('n_a', 'message', 1, 1, { text: 'a' }, true)]),
          }),
        ],
        [
          'flow-type-unknown',
          JSON.stringify({
            _wadesk_flow_export: 1,
            name: `${flowName(c, 'ft')}`,
            flow_type: 'sms',
            flow_data: G([N('n_a', 'message', 1, 1, { text: 'a' }, true)]),
          }),
        ],
      ];
      for (const [id, text] of bad) {
        const b0 = [...(await myFlows(c)), ...(await strays(c))].length;
        const r = await doImport(text, `bad.${id}`);
        o.num(`bad.${id}.rowsAdded`, r.all.length - b0);
      }
      c.obs.set('info.exportSample', mine.slice(0, 300));
    },
  });

  add({
    id: 'api.cross-import.other-side',
    title:
      "Import the OTHER side's export file (fixture generated by the sibling run) and compare the result",
    api: true,
    run: async (c) => {
      const o = c.obs;
      // The export of the shared sample graph, as each side writes it: WaDesk key order is name, flow_type, category, flow_data.
      const g = G(
        [
          N(
            'n_t00001',
            'trigger',
            100,
            100,
            { kind: 'keyword', keywordMode: 'any', keywords: '' },
            true,
          ),
          N('n_m00001', 'message', 460, 100, { text: 'x' }),
        ],
        [E('e_1', 'n_t00001', 'out', 'n_m00001')],
      );
      const wadesk = {
        _wadesk_flow_export: 1,
        exported_at: '2026-01-01T00:00:00+00:00',
        name: `${flowName(c, 'xi')}`,
        flow_type: 'chat',
        category: null,
        flow_data: g,
      };
      const ours = {
        ...wadesk,
        exported_at: '2026-01-01T00:00:00.000Z',
        name: `${flowName(c, 'xj')}`,
      };
      for (const [label, file] of [
        ['wadeskFile', wadesk],
        ['oursFile', ours],
      ]) {
        let r;
        if (c.side === 'wadesk')
          r = await c.http('POST', '/flows/import', {
            multipart: {
              file: {
                name: 'f.json',
                mimeType: 'application/json',
                buffer: Buffer.from(JSON.stringify(file)),
              },
            },
          });
        else
          r = await c.http('POST', '/v2/flows/import', {
            data: { payload: file },
            headers: idem(),
          });
        o.enum(`${label}.status`, statusClass(r.status));
      }
      const mine = await myFlows(c);
      for (const f of mine)
        c.onCleanup(() =>
          c.http('DELETE', delPath(c, f.id), { headers: c.side === 'ours' ? idem() : {} }),
        );
      o.num('rows', mine.length);
      for (const f of mine) {
        const got = await apiGet(c, f.id);
        o.flag(
          `${/xi/.test(f.name) ? 'wadeskFile' : 'oursFile'}.suffix`,
          /\(imported\)$/.test(String(got.name)),
        );
        recordShape(o, /xi/.test(f.name) ? 'wadeskFile' : 'oursFile', got.graph);
      }
    },
  });

  // reference-data endpoints the builder boots with
  add({
    id: 'api.builder-data.shapes',
    title: 'Builder reference data: pickers answer, with the same keys and ordering rules',
    api: true,
    run: async (c) => {
      const o = c.obs;
      if (c.side === 'wadesk') {
        const pk = await c.http('GET', '/flows/api/picker');
        o.status('picker', pk.status);
        o.seq(
          'picker.keys',
          Object.keys(pk.body ?? {})
            .filter((k) => k !== 'ok')
            .sort(),
        );
        const ms = await c.http('GET', '/flows/api/ai-models');
        o.status('aiModels', ms.status);
        o.flag('aiModels.array', Array.isArray(ms.body?.models));
        const as = await c.http('GET', '/flows/api/ai-assistants');
        o.flag('assistants.array', Array.isArray(as.body?.assistants));
        const ca = await c.http('GET', '/flows/api/call-assistants');
        o.flag('callAssistants.array', Array.isArray(ca.body?.assistants));
        const cs = await c.http('GET', '/flows/api/commerce/stores');
        o.status('commerceStores', cs.status);
      } else {
        const ctx = await c.http('GET', '/v2/flows/builder-context');
        o.status('picker', ctx.status);
        const keys = Object.keys(ctx.body ?? {});
        // ours answers the picker, the lists and the model catalogues in one call: the picker's keys are tags, groups,
        // keywordRules and one sender list per channel (chat = WaDesk's `devices`)
        o.seq(
          'picker.keys',
          [
            ...['tags', 'groups', 'keywordRules'].filter((k) => keys.includes(k)),
            ...Object.keys(ctx.body?.senders ?? {}).map((k) => (k === 'chat' ? 'devices' : k)),
          ].sort(),
        );
        o.flag('aiModels.array', Array.isArray(ctx.body?.aiModels ?? ctx.body?.models));
        o.flag('assistants.array', Array.isArray(ctx.body?.aiAssistants ?? ctx.body?.assistants));
        o.flag('callAssistants.array', Array.isArray(ctx.body?.callAssistants));
        o.status('aiModels', ctx.status);
        o.status('commerceStores', ctx.status);
        o.set('info.keys', keys.join(','));
      }
    },
  });

  // ---------------------------------------------------------------------------------------------------------------
  // page probes
  // ---------------------------------------------------------------------------------------------------------------
  const pages = [
    {
      id: 'builder-chat',
      title: 'Flow builder (new chat flow)',
      path: '/flows/builder',
      ready: '.pal-card',
      probes: ['load', 'responsive', 'a11y', 'keyboard', 'degraded', 'auth', 'perf'],
    },
    {
      id: 'builder-call',
      title: 'Flow builder (new call flow)',
      path: '/flows/builder?type=call',
      ready: '.pal-card',
      probes: ['load', 'a11y', 'auth'],
    },
  ];

  return {
    feature: 'WD-FLB-014',
    title:
      'Flow builder editor: shell, canvas, palette, inspectors, validation, save, publish, test runner, AI generator, endpoints',
    pages,
    scenarios,
    intended: [
      // --- API save ---------------------------------------------------------------------------------------------------
      {
        scenario: /^api\.save\.graph\.(nodes-501|edges-2001)$/,
        quirk: 'flow_steps_limit never enforced',
        reason:
          'WD-FLB-028 port notes: ours caps a flow at 500 nodes and 2000 edges on save; WaDesk stores any number (its flow_steps_limit exists but is never checked)',
      },
      {
        scenario: /^api\.save\.graph\.huge-text$/,
        reason:
          'the API caps a JSON request body (platform-wide body limit); WaDesk takes a graph of any size',
      },
      {
        scenario: /^api\.save\.graph\.(node-not-object|vars-strings)$/,
        quirk: 'WaDesk trusts any array',
        reason:
          'WD-FLB-019 rule 6: WaDesk does not validate node shapes; ours validates that nodes and variables are objects before storing',
      },
      {
        scenario: /^api\.save\.type\.empty$/,
        reason:
          'JSON API: an empty string is not a channel; WaDesk reads "" as null only because Laravel converts empty strings to null on every request. The builder never sends it',
      },
      {
        scenario:
          /^api\.save\.graph\.(dangling-edge|dup-node-ids|no-coords|no-edges-key|string-coords|two-starts)$/,
        key: 'map.stored.shape',
        reason:
          'ours applies the boot normalisation when it stores a graph (one START, no edge to a missing node, coordinates filled in); WaDesk stores what the client sent and normalises when the builder opens it, so the opened canvas is the same',
      },
      {
        scenario: /^api\.access\.unauthenticated$/,
        key: 'flag.builderPage.refused',
        reason:
          'the web app serves its page shell and the client sends an anonymous visitor to the login page; no flow content is served (flag.builderPage.contentHidden is equal and the page probe "auth" passes)',
      },
      {
        scenario: /^builder-chat\.keyboard$/,
        key: 'abs.keyboard.focusVisible',
        reason:
          'the single Tab stop without a focus ring is the Next.js development-mode indicator (a <nextjs-portal> element that only exists under `next dev`); every control of the builder shows focus',
      },
      // --- builder UI -------------------------------------------------------------------------------------------------
      {
        scenario: /^ui\.publish\.new-graph$/,
        key: /^(num\.rows|seq\.rowStates)$/,
        quirk: 'publish of a never-saved flow saves twice',
        reason:
          'WD-FLB-022 rule 1 (not ported, intended fix): WaDesk creates a second row and publishes that one, leaving a stray draft; ours saves once and publishes that row, so exactly one published row exists',
      },
      {
        scenario: /^ui\.save\.keyword-too-long$/,
        key: 'flag.graphWasStoredAnyway',
        quirk: 'save hook throws after the row is written',
        reason:
          'WD-FLB-019 port notes: create / update, trigger extraction and the rule sync are one transaction, so a rejected save stores nothing (WaDesk stores the new graph and then reports an error)',
      },
      {
        scenario: /^ui\.save\.new-flow-modal$/,
        key: /^enum\.stored\.(triggerData|conditionData)$/,
        quirk: 'Laravel converts "" to null',
        reason:
          "WaDesk's middleware turns every empty string in the request into null, ours stores the empty string the builder sent; the runtime reads both as unset",
      },
      {
        scenario: /^ui\.inspector\.call\.hang-up$/,
        key: 'seq.card.ports',
        quirk: 'dead output port on Hang up',
        reason:
          'WaDesk draws an output dot on Hang up that nothing follows; ours treats Hang up as terminal like End (WD-FLB-017 table: terminal)',
      },
      {
        scenario:
          /^ui\.inspector\.(call\.menu-branch|chat\.(book-appointment|create-move-deal|whatsapp-shop|woocommerce|shopify))$/,
        key: /^(seq\.card\.ports|enum\.card\.text)$/,
        quirk: 'isMultiPort omits several nodes',
        reason:
          'WD-FLB-017 rule 1 (do not port the defect): every declared output port is drawn (booked / no_slots, purchased / abandoned, created / error, one per Menu branch plus no match) so each branch can be wired in the UI',
      },
      {
        scenario: /^ui\.inspector\./,
        key: 'flag.pickerShowsLoadingWhenEmpty',
        quirk: 'empty list shows "Loading ..."',
        reason:
          'WaDesk cannot tell an empty list from a pending one and shows "Loading ..." forever for a workspace with no templates, forms, services or groups; ours says Loading only while loading and shows the normal empty picker afterwards',
      },
      {
        scenario: /^ui\.inspector\.chat\.google-(docs|meet)$/,
        key: 'flag.placeholderShowsBackslashN',
        quirk: 'literal backslash-n in placeholder',
        reason:
          "WaDesk's placeholder text for the message template shows the two characters backslash and n; ours shows the intended line breaks",
      },
      {
        scenario: /^ui\.inspector\.chat\.google-(docs|form|sheets)$/,
        key: /^(seq\.rows|num\.controls|seq\.select\d+\..*)$/,
        quirk: 'Loading forever when Google is off',
        reason:
          'with Google disabled WaDesk leaves the document / form / spreadsheet picker on "Loading ..." for ever; ours says Google is not connected and offers the id / link field, so the node stays usable',
      },
    ],
    skip: [
      {
        scenario: /^api\.upload\.over-50mb$/,
        side: 'wadesk',
        reason:
          'the local reference runs PHP with post_max_size 8 MB: a body over that answers 200 with a PHP warning before validation runs, so its 50 MB rule cannot be observed here; ours is covered by the API e2e test',
      },
      {
        scenario:
          /^ui\.(palette|validate)\.(instagram|facebook|tiktok|telegram|line|wechat|viber|email)/,
        reason:
          'channel palettes need a connected channel account on both sides; compared from the contracts unit tests instead',
      },
    ],
    teardown: {
      both: async (c) => {
        const mine = await runFlows(c).catch(() => []);
        for (const f of mine)
          if (String(f.name).startsWith(NAME) && String(f.name).includes(c.tagBase))
            await c
              .http('DELETE', delPath(c, f.id), { headers: c.side === 'ours' ? idem() : {} })
              .catch(() => undefined);
      },
    },
  };
};
