// Semantic page snapshot: what a user can see and operate, independent of markup.
// Runs inside the page (page.evaluate), so it has no imports and must stay self-contained.
// Output is plain JSON. Text is kept for humans (copy differences are never defects, see
// references/comparison-rules.md); the structural fields are what the comparator uses.

export function snapshotInPage(opts = {}) {
  const root = opts.root ? document.querySelector(opts.root) || document.body : document.body;
  const MAXTXT = 90;
  const clip = (s) => (s || '').replace(/\s+/g, ' ').trim().slice(0, MAXTXT);

  const visible = (el) => {
    if (!el || !(el instanceof Element)) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
      if (n.hasAttribute('hidden') || n.getAttribute('aria-hidden') === 'true') return false;
    }
    return true;
  };

  const labelFor = (el) => {
    const aria = el.getAttribute('aria-label');
    if (aria) return clip(aria);
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      const t = by
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent || '')
        .join(' ');
      if (clip(t)) return clip(t);
    }
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l) return clip(l.textContent);
    }
    const wrap = el.closest('label');
    if (wrap) return clip(wrap.textContent);
    // visual label heuristic: nearest preceding label/legend/text block in the same field container
    const box = el.closest(
      '[class*="field"], [class*="form-group"], [class*="input-group"], .mb-3, .mb-4, div',
    );
    const near = box && box.querySelector('label, legend, [class*="label"]');
    if (near && near !== el) return clip(near.textContent);
    return clip(
      el.getAttribute('title') || el.getAttribute('placeholder') || el.getAttribute('name') || '',
    );
  };

  const nameOf = (el) => {
    const aria = el.getAttribute('aria-label');
    if (aria) return clip(aria);
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      const t = by
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent || '')
        .join(' ');
      if (clip(t)) return clip(t);
    }
    const txt = clip(el.innerText || el.textContent);
    if (txt) return txt;
    const img = el.querySelector('img[alt]');
    if (img && clip(img.alt)) return clip(img.alt);
    return clip(el.getAttribute('title') || el.value || '');
  };

  const fieldKind = (el) => {
    const tag = el.tagName.toLowerCase();
    if (tag === 'select') return el.multiple ? 'multiselect' : 'select';
    if (tag === 'textarea') return 'textarea';
    if (el.getAttribute('contenteditable') === 'true') return 'richtext';
    if (el.getAttribute('role') === 'switch') return 'switch';
    if (el.getAttribute('role') === 'combobox') return 'combobox';
    const t = (el.getAttribute('type') || 'text').toLowerCase();
    return t;
  };

  const isRequired = (el) =>
    el.required === true ||
    el.getAttribute('aria-required') === 'true' ||
    /\*\s*$/.test(labelFor(el)) ||
    !!el.closest('[class*="required"]');

  const fieldInfo = (el) => ({
    kind: fieldKind(el),
    name: el.getAttribute('name') || el.id || '',
    label: labelFor(el),
    required: isRequired(el),
    disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
    readonly: el.readOnly === true,
    placeholder: clip(el.getAttribute('placeholder')),
    maxlength: el.maxLength > 0 && el.maxLength < 1e6 ? el.maxLength : null,
    minlength: el.minLength > 0 ? el.minLength : null,
    pattern: el.getAttribute('pattern') || null,
    min: el.getAttribute('min'),
    max: el.getAttribute('max'),
    step: el.getAttribute('step'),
    autocomplete: el.getAttribute('autocomplete'),
    options: el.tagName === 'SELECT' ? el.options.length : null,
    hasValue:
      el.type === 'checkbox' || el.type === 'radio' ? !!el.checked : (el.value || '') !== '',
  });

  const fieldSel =
    'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]), select, textarea, [contenteditable="true"], [role=combobox], [role=switch]';

  // forms (also treat a dialog or main container holding fields without a <form> as an implicit form)
  const forms = [];
  const seenFields = new Set();
  const rootForms =
    root.matches && root.matches('form') ? [root] : [...root.querySelectorAll('form')];
  rootForms.forEach((f) => {
    if (!visible(f) && !f.querySelector(fieldSel)) return;
    const fields = [...f.querySelectorAll(fieldSel)].filter(visible).map((e) => {
      seenFields.add(e);
      return fieldInfo(e);
    });
    const buttons = [...f.querySelectorAll('button, input[type=submit], [role=button]')]
      .filter(visible)
      .map((b) => ({
        name: nameOf(b),
        type: b.getAttribute('type') || 'button',
        disabled: b.disabled === true,
      }));
    if (!fields.length && !buttons.length) return;
    forms.push({
      id: f.id || '',
      method: (f.getAttribute('method') || 'get').toLowerCase(),
      action: (f.getAttribute('action') || '').replace(location.origin, ''),
      fields,
      buttons,
      hasCsrf: !!f.querySelector('input[name=_token], input[name=csrf], input[name=_csrf]'),
      novalidate: f.noValidate === true,
    });
  });
  const loose = [...root.querySelectorAll(fieldSel)].filter(
    (e) => visible(e) && !seenFields.has(e),
  );
  if (loose.length)
    forms.push({
      id: '(implicit)',
      method: 'js',
      action: '',
      fields: loose.map(fieldInfo),
      buttons: [],
      hasCsrf: false,
      novalidate: true,
    });

  // tables and table-like grids
  const tables = [];
  root.querySelectorAll('table, [role=table], [role=grid]').forEach((t) => {
    if (!visible(t)) return;
    const headEls = [...t.querySelectorAll('thead th, thead td, [role=columnheader]')].filter(
      visible,
    );
    const heads = headEls.map((h) => clip(h.innerText || h.getAttribute('aria-label')));
    const rows = [...t.querySelectorAll('tbody tr, [role=row]')].filter(
      (r) => visible(r) && !r.querySelector('th, [role=columnheader]'),
    );
    const first = rows[0];
    const cells = first ? [...first.querySelectorAll('td, [role=cell], [role=gridcell]')] : [];
    tables.push({
      columns: heads.length || cells.length,
      headers: heads,
      sortable: headEls.filter(
        (h) =>
          h.getAttribute('aria-sort') || h.querySelector('a, button') || /sort/i.test(h.className),
      ).length,
      rows: rows.length,
      hasCheckboxColumn: !!(first && first.querySelector('input[type=checkbox]')),
      hasRowActions: !!(first && first.querySelector('button, a, [role=menu], [aria-haspopup]')),
      rowLinks: first ? first.querySelectorAll('a').length : 0,
      emptyRow: rows.length === 1 && rows[0].querySelectorAll('td').length === 1,
    });
  });

  // pagination style (page numbers vs load-more vs infinite)
  const pageNav = root.querySelector(
    'nav[aria-label*="agination" i], .pagination, [class*="pagination"], ul.pager, [role=navigation][aria-label*="page" i]',
  );
  const loadMore = [...root.querySelectorAll('button, a')].find(
    (b) => visible(b) && /^(load|show|view|see)\s+more|^more$/i.test(clip(b.innerText)),
  );
  const pagination = {
    kind: pageNav && visible(pageNav) ? 'pages' : loadMore ? 'loadmore' : 'none',
    controls: pageNav
      ? [...pageNav.querySelectorAll('a, button')].filter(visible).length
      : loadMore
        ? 1
        : 0,
    showsTotal: /\b(of|total)\s+\d+|\d+\s+(results|entries|records|items)\b/i.test(
      clip((pageNav?.parentElement || root).innerText.slice(0, 4000)),
    ),
  };

  // buttons and links (by role), headings, tabs, dialogs, messages
  const buttons = [
    ...root.querySelectorAll(
      'button, [role=button], input[type=submit], input[type=button], a.btn, a[class*="button"]',
    ),
  ]
    .filter(visible)
    .map((b) => ({
      name: nameOf(b),
      disabled: b.disabled === true || b.getAttribute('aria-disabled') === 'true',
      haspopup: b.getAttribute('aria-haspopup') || null,
      type: b.getAttribute('type') || null,
    }));
  const links = [...root.querySelectorAll('a[href]')].filter(visible).map((a) => ({
    name: nameOf(a),
    href: (a.getAttribute('href') || '')
      .replace(location.origin, '')
      .replace(/\d{2,}/g, ':n')
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':uuid'),
  }));
  const headings = [...root.querySelectorAll('h1,h2,h3,h4,h5,h6,[role=heading]')]
    .filter(visible)
    .map((h) => ({
      level: Number(h.tagName[1]) || Number(h.getAttribute('aria-level')) || 2,
      text: clip(h.innerText),
    }));
  const tabs = [...root.querySelectorAll('[role=tab]')]
    .filter(visible)
    .map((t) => ({ name: nameOf(t), selected: t.getAttribute('aria-selected') === 'true' }));
  const dialogs = [
    ...document.querySelectorAll(
      'dialog[open], [role=dialog], [role=alertdialog], [aria-modal=true]',
    ),
  ]
    .filter(visible)
    .map((d) => ({
      name: clip(
        d.getAttribute('aria-label') || d.querySelector('h1,h2,h3,[class*=title]')?.innerText || '',
      ),
      modal: d.getAttribute('aria-modal') === 'true' || d.tagName === 'DIALOG',
      buttons: [...d.querySelectorAll('button')].filter(visible).length,
    }));
  const alerts = [
    ...document.querySelectorAll(
      '[role=alert], [role=status], [aria-live=assertive], [aria-live=polite], [class*=toast], [class*=flash], [class*=alert]:not(script)',
    ),
  ]
    .filter((e) => visible(e) && clip(e.innerText))
    .map((e) => ({
      role: e.getAttribute('role') || 'live',
      text: clip(e.innerText),
      cls: /error|danger|invalid|fail|red/i.test(e.className.toString())
        ? 'error'
        : /success|green|ok/i.test(e.className.toString())
          ? 'success'
          : /warn|yellow|amber/i.test(e.className.toString())
            ? 'warning'
            : 'info',
    }));
  const spinners = [
    ...document.querySelectorAll(
      '[aria-busy=true], [role=progressbar], [class*=spinner], [class*=loading], [class*=skeleton]',
    ),
  ].filter(visible).length;
  const invalid = [
    ...document.querySelectorAll(
      '[aria-invalid=true], .is-invalid, .has-error, input:invalid, select:invalid, textarea:invalid',
    ),
  ]
    .filter(visible)
    .map((e) => ({ name: e.getAttribute('name') || e.id || '', label: labelFor(e) }));

  const imgs = [...root.querySelectorAll('img')].filter(visible);
  const interactive = [
    ...root.querySelectorAll(
      'a[href], button, input, select, textarea, [role=button], [tabindex]:not([tabindex="-1"])',
    ),
  ].filter(visible);
  const unnamed = interactive.filter((e) => !nameOf(e) && !labelFor(e) && e.type !== 'hidden');

  const bodyText = clip(root.innerText.slice(0, 600));
  const counts = {
    headings: headings.length,
    h1: headings.filter((h) => h.level === 1).length,
    forms: forms.length,
    tables: tables.length,
    buttons: buttons.length,
    links: links.length,
    inputs: forms.reduce((n, f) => n + f.fields.length, 0),
    tabs: tabs.length,
    dialogs: dialogs.length,
    images: imgs.length,
    brokenImages: imgs.filter((i) => i.complete && i.naturalWidth === 0).length,
    interactive: interactive.length,
    unnamedInteractive: unnamed.length,
  };
  const landmarks = {};
  for (const [k, sel] of Object.entries({
    main: 'main, [role=main]',
    nav: 'nav, [role=navigation]',
    header: 'header, [role=banner]',
    footer: 'footer, [role=contentinfo]',
    aside: 'aside, [role=complementary]',
    search: '[role=search], input[type=search]',
  }))
    landmarks[k] = [...document.querySelectorAll(sel)].filter(visible).length;

  return {
    url: location.pathname + location.search,
    title: document.title,
    lang: document.documentElement.lang || '',
    dir: document.documentElement.dir || getComputedStyle(document.documentElement).direction,
    viewport: { w: innerWidth, h: innerHeight },
    overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    counts,
    landmarks,
    headings,
    tabs,
    dialogs,
    alerts,
    spinners,
    invalid,
    forms,
    tables,
    pagination,
    buttons: buttons.slice(0, 80),
    links: links.slice(0, 120),
    emptyState:
      tables.length > 0 && tables.every((t) => t.rows === 0 || t.emptyRow) && bodyText.length > 0,
    textSample: bodyText,
  };
}
