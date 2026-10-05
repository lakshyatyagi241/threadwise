// Form engine. Given a form definition (see references/spec-format.md) it generates the scenario matrix and, for
// each case, drives the form on BOTH apps and records what happened in side-neutral terms:
//   was it accepted, which fields were flagged, did typed values survive a rejection, where did focus go, how many
//   requests were sent, was anything executed (XSS), what did the UI do when the server failed...
// The comparator then diffs the two observations. Nothing here decides what SHOULD happen; Reference is the oracle.
import { casesFor, DEPTHS } from '../values.mjs';
import { statusClass, oneLine, pick } from '../util.mjs';

// ---------------------------------------------------------------------------------------------------------------
// locating
const root = (c, form) => {
  const r = pick(form.root, c);
  return r ? c.loc(r).first() : c.page.locator('body');
};
const fieldLocator = (c, form, f) => c.loc(pick(f.loc || f, c), root(c, form)).first();

async function fieldHandle(c, form, f) {
  try {
    const l = fieldLocator(c, form, f);
    if ((await l.count()) === 0) return null;
    return await l.elementHandle({ timeout: 800 });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// filling
export async function fillField(c, form, f, value) {
  const custom = pick(f.fill, c);
  if (typeof custom === 'function') return custom(c, value);
  const l = fieldLocator(c, form, f);
  c.obs.actions.fills += 1;
  const t = f.type || 'text';
  if (t === 'select') {
    if (value && typeof value === 'object' && 'option' in value) {
      const opts = await l.evaluate((s) =>
        [...s.options].map((o) => ({ value: o.value, label: o.label, disabled: o.disabled })),
      );
      const usable = opts.filter((o) => !o.disabled);
      const withValue = usable.filter((o) => o.value !== '');
      const target =
        value.option === 'first'
          ? withValue[0]
          : value.option === 'last'
            ? withValue[withValue.length - 1]
            : usable.find((o) => o.value === '') || usable[0];
      if (!target) return;
      return l.selectOption({ value: target.value });
    }
    if (value && typeof value === 'object') return l.selectOption(value);
    return l.selectOption(String(value));
  }
  if (t === 'checkbox' || t === 'switch') return l.setChecked(!!value);
  if (t === 'file') return l.setInputFiles(value);
  if (t === 'date' || t === 'datetime') {
    await l.fill(String(value)).catch(async () => {
      await l.click();
      await c.page.keyboard.type(String(value));
    });
    return;
  }
  await l.fill(String(value));
}

export async function fillAll(c, form, values) {
  for (const f of form.fields) {
    if (!(f.id in values)) continue;
    await fillField(c, form, f, values[f.id]);
  }
}

async function readValues(c, form) {
  const out = {};
  for (const f of form.fields) {
    const l = fieldLocator(c, form, f);
    try {
      if ((await l.count()) === 0) continue;
      const t = f.type || 'text';
      out[f.id] =
        t === 'checkbox' || t === 'switch'
          ? await l.isChecked()
          : await l.inputValue({ timeout: 500 });
    } catch {
      /* not readable (custom widget): skip */
    }
  }
  return out;
}

/** Resolve when the subtree has not mutated for `ms` (hydration, widget init, animations), capped at `max`. */
async function domQuiet(c, locator, ms = 300, max = 2500) {
  await locator
    .evaluate(
      (el, { ms, max }) =>
        new Promise((resolve) => {
          let timer;
          const done = () => {
            obs.disconnect();
            resolve();
          };
          const obs = new MutationObserver(() => {
            clearTimeout(timer);
            timer = setTimeout(done, ms);
          });
          obs.observe(el, {
            subtree: true,
            childList: true,
            attributes: true,
            characterData: true,
          });
          timer = setTimeout(done, ms);
          setTimeout(done, max);
        }),
      { ms, max },
    )
    .catch(() => {});
}

const digits = (s) => String(s).replace(/\D/g, '');
const sameValue = (type, typed, now) =>
  type === 'phone' || type === 'tel'
    ? digits(typed) === digits(now)
    : String(typed).trim() === String(now).trim();

/** Fill every field, read back, and refill once if the page wiped or reformatted values (late hydration). Returns the number of refills. */
async function fillVerified(c, form, typed) {
  await fillAll(c, form, typed);
  let refills = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    await c.page.waitForTimeout(150);
    const now = await readValues(c, form);
    const lost = form.fields.filter(
      (f) =>
        typeof typed[f.id] === 'string' &&
        typed[f.id].trim() !== '' &&
        f.id in now &&
        !sameValue(f.type, typed[f.id], now[f.id]),
    );
    if (!lost.length) break;
    refills += 1;
    await c.page.waitForTimeout(350);
    for (const f of lost) await fillField(c, form, f, typed[f.id]);
  }
  return refills;
}

// ---------------------------------------------------------------------------------------------------------------
// in-page inspection of validation feedback
function inspectInPage({ els, ids }) {
  const vis = (e) => {
    const r = e.getBoundingClientRect();
    const s = getComputedStyle(e);
    return (
      r.width > 0 &&
      r.height > 0 &&
      s.visibility !== 'hidden' &&
      s.display !== 'none' &&
      s.opacity !== '0'
    );
  };
  const errCls =
    /(error|invalid|danger|feedback|text-red|text-rose|has-error|help-block|alert-danger)/i;
  const okCls = /(success|positive|text-green|text-emerald|alert-success)/i;
  const reddish = (e) => {
    const m = getComputedStyle(e).color.match(/[\d.]+/g);
    if (!m) return false;
    const [r, g, b] = m.map(Number);
    return r >= 160 && g <= 120 && b <= 120 && r - g >= 60;
  };
  const own = (e) =>
    [...e.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent)
      .join('')
      .trim();
  const cls = (e) => (e.className && e.className.toString()) || '';
  const present = els.filter(Boolean);
  const flagged = [];
  const texts = {};
  els.forEach((el, i) => {
    if (!el || !el.isConnected) return;
    let wrap = el;
    while (
      wrap.parentElement &&
      wrap.parentElement.tagName !== 'FORM' &&
      wrap.parentElement !== document.body &&
      present.filter((x) => wrap.parentElement.contains(x)).length <= 1
    )
      wrap = wrap.parentElement;
    const attr = el.getAttribute('aria-invalid') === 'true' || errCls.test(cls(el));
    const described = (el.getAttribute('aria-describedby') || '')
      .split(/\s+/)
      .map((id) => document.getElementById(id))
      .filter((e) => e && vis(e) && e.textContent.trim().length > 2);
    const msgs = [...wrap.querySelectorAll('*')].filter(
      (e) =>
        e !== el &&
        !e.contains(el) &&
        e.tagName !== 'LABEL' &&
        e.tagName !== 'OPTION' &&
        vis(e) &&
        own(e).length > 2 &&
        (e.getAttribute('role') === 'alert' || errCls.test(cls(e)) || reddish(e)),
    );
    if (attr || described.length || msgs.length) {
      flagged.push(ids[i]);
      texts[ids[i]] = (described[0]?.textContent || msgs[0]?.textContent || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120);
    }
  });
  const live = [
    ...document.querySelectorAll(
      '[role=alert], [role=status], [aria-live], [class*=toast], [class*=flash], [class*=alert], [class*=snackbar], [class*=notification]',
    ),
  ].filter((e) => vis(e) && e.textContent.trim().length > 2);
  const formLevelError =
    live.some((e) => errCls.test(cls(e)) || reddish(e) || e.getAttribute('role') === 'alert') &&
    !flagged.length;
  const successSignal = live.some((e) => okCls.test(cls(e)));
  const a = document.activeElement;
  let focus = 'none';
  if (a && a !== document.body) {
    const idx = els.findIndex((x) => x === a);
    focus =
      idx >= 0
        ? flagged.length && ids[idx] === flagged[0]
          ? 'first-invalid'
          : flagged.includes(ids[idx])
            ? 'other-invalid'
            : 'other-field'
        : a.closest('[role=alert]')
          ? 'summary'
          : 'other';
  }
  return {
    flagged,
    texts,
    formLevelError,
    successSignal,
    focus,
    liveTexts: live.slice(0, 3).map((e) => e.textContent.replace(/\s+/g, ' ').trim().slice(0, 120)),
  };
}

async function invalidPseudo(c, els, ids) {
  return c.page
    .evaluate(
      ({ els, ids }) =>
        ids.filter(
          (id, i) => els[i] && els[i].isConnected && els[i].willValidate && !els[i].checkValidity(),
        ),
      { els, ids },
    )
    .catch(() => []);
}

// ---------------------------------------------------------------------------------------------------------------
// submitting and reading the result
async function submit(c, form, via = 'click') {
  c.lastActionAt = Date.now();
  if (via === 'enter') {
    const first = fieldLocator(
      c,
      form,
      form.fields.find((f) =>
        ['text', 'name', 'email', 'phone', 'tel', 'number', 'password'].includes(f.type || 'text'),
      ) || form.fields[0],
    );
    await first.focus();
    c.obs.actions.keys += 1;
    await c.page.keyboard.press('Enter');
  } else {
    const btn = c.loc(pick(form.submit, c), root(c, form)).first();
    c.obs.actions.clicks += 1;
    await btn.click({ noWaitAfter: true });
  }
}

async function settleAfterSubmit(c) {
  await c.afterAction({ quiet: Math.max(c.cfg.timeouts.quiet, 500), timeout: 6000 });
}

export async function inspectOutcome(c, form, { mark, urlBefore, typed = {} }) {
  const ids = form.fields.map((f) => f.id);
  const ev = c.rec.since(mark);
  const submits = ev.http.filter((h) => h.method !== 'GET');
  const submitReq = submits[0];
  const urlAfter = c.page.url();
  const pathOf = (u) => {
    try {
      return new URL(u).pathname;
    } catch {
      return u;
    }
  };
  const urlChanged = pathOf(urlAfter) !== pathOf(urlBefore);
  const formVisible = await root(c, form)
    .isVisible()
    .catch(() => false);
  const els = [];
  for (const f of form.fields) els.push(await fieldHandle(c, form, f));
  const insp =
    formVisible && !urlChanged
      ? await c.page.evaluate(inspectInPage, { els, ids }).catch(() => ({
          flagged: [],
          texts: {},
          formLevelError: false,
          successSignal: false,
          focus: 'none',
          liveTexts: [],
        }))
      : {
          flagged: [],
          texts: {},
          formLevelError: false,
          successSignal: false,
          focus: 'none',
          liveTexts: [],
        };
  // A submit that sent nothing is a client-side rejection when the browser's own validation blocked it OR the app's
  // script validated and flagged fields (a form with novalidate and inline errors): both are "rejected with feedback".
  // Without this an app that validates in script is reported as `no-request` (a swallowed click) on every invalid case.
  const pseudoBlocked = !submitReq && formVisible ? await invalidPseudo(c, els, ids) : [];
  const scriptBlocked = !submitReq && formVisible && !pseudoBlocked.length ? insp.flagged : [];
  const clientBlocked = [...pseudoBlocked, ...scriptBlocked];
  const flagged = [...new Set([...insp.flagged, ...clientBlocked])];

  let outcome;
  if (ev.pageErrors.length && !flagged.length) outcome = 'crash';
  else if (submitReq && submitReq.status >= 500) outcome = 'crash';
  else if (!submitReq)
    outcome = clientBlocked.length
      ? 'rejected'
      : urlChanged || !formVisible
        ? 'saved'
        : 'no-request';
  else if (submitReq.status === 419 || submitReq.status === 401) outcome = 'session-expired';
  else if (submitReq.status >= 400) outcome = 'rejected';
  else if (flagged.length || insp.formLevelError) outcome = 'rejected';
  else outcome = urlChanged || !formVisible || insp.successSignal ? 'saved' : 'silent';

  const accepted = outcome === 'saved' || outcome === 'silent';
  const result = {
    outcome,
    accepted,
    flagged,
    formLevelError: insp.formLevelError,
    status: submitReq
      ? statusClass(submitReq.status)
      : clientBlocked.length
        ? 'client-blocked'
        : 'none',
    submitRequests: submits.length,
    urlChanged,
    formVisible,
    focus: insp.focus,
    texts: insp.texts,
    liveTexts: insp.liveTexts,
    layer: submitReq ? 'server' : clientBlocked.length ? 'client' : 'none',
  };

  if (!accepted && formVisible) {
    const now = await readValues(c, form);
    const typeOf = (id) => form.fields.find((f) => f.id === id)?.type;
    const lost = Object.entries(typed)
      .filter(
        ([id, v]) =>
          typeof v === 'string' &&
          v.trim() !== '' &&
          id in now &&
          !sameValue(typeOf(id), v, now[id]),
      )
      .map(([id]) => id);
    result.valueKept = lost.length === 0;
    result.valueLost = lost;
  }
  return result;
}

function record(c, r, { target, tag } = {}) {
  const o = c.obs;
  o.enum('outcome', r.outcome);
  o.flag('accepted', r.accepted);
  o.list('flaggedFields', r.flagged);
  o.flag('formLevelError', r.formLevelError);
  o.set('status.submit', r.status);
  o.num('submitRequests', r.submitRequests);
  if (r.valueKept !== undefined) o.flag('valueKept', r.valueKept);
  if (!r.accepted && r.focus !== undefined)
    o.set(
      'abs.focusQuality',
      { none: 0, other: 0, 'other-field': 1, summary: 2, 'other-invalid': 2, 'first-invalid': 3 }[
        r.focus
      ] ?? 0,
    );
  o.info('validationLayer', r.layer);
  o.info('errorText', r.texts);
  if (r.liveTexts?.length) o.info('liveText', r.liveTexts);
  if (r.valueLost?.length) o.info('valueLost', r.valueLost);
  o.info('target', target);
  if (tag) o.info('tag', tag);
}

// ---------------------------------------------------------------------------------------------------------------
async function openForm(c, form) {
  const open = pick(form.open, c);
  if (typeof open !== 'function')
    throw new Error(
      `form "${form.id}": open.${c.side} must be a function(c) that leaves the form visible`,
    );
  await c.step('open form', () => open(c));
  await root(c, form)
    .first()
    .waitFor({ state: 'visible', timeout: c.cfg.timeouts.action })
    .catch(() => {
      throw Object.assign(new Error(`form root not visible after open (side=${c.side})`), {
        step: 'open form',
        missing: true,
      });
    });
  await domQuiet(c, root(c, form).first());
}

async function structure(c, form) {
  const o = c.obs;
  const fields = [];
  for (const f of form.fields) {
    const l = fieldLocator(c, form, f);
    const present = (await l.count().catch(() => 0)) > 0;
    const vis = present && (await l.isVisible().catch(() => false));
    o.flag(`field.${f.id}.present`, present && vis);
    if (!present || !vis) continue;
    const a = await l
      .evaluate((e) => {
        const lab = (e.labels && e.labels[0]?.textContent) || e.closest('label')?.textContent || '';
        return {
          type: e.type || e.tagName.toLowerCase(),
          required: e.required === true || e.getAttribute('aria-required') === 'true',
          reqMark: /\*/.test(lab) || !!e.closest('[class*="required"]'),
          maxlength: e.maxLength > 0 && e.maxLength < 1e6 ? e.maxLength : null,
          hasLabel: !!(
            lab.trim() ||
            e.getAttribute('aria-label') ||
            e.getAttribute('aria-labelledby')
          ),
          disabled: e.disabled === true,
          readonly: e.readOnly === true,
          hasPlaceholder: !!e.getAttribute('placeholder'),
          autocomplete: e.getAttribute('autocomplete') || null,
        };
      })
      .catch(() => null);
    if (!a) continue;
    o.set(`ui.field.${f.id}.kind`, a.type);
    o.set(`ui.field.${f.id}.required`, a.required || a.reqMark);
    o.set(`ui.field.${f.id}.maxlength`, a.maxlength);
    o.set(`abs.field.${f.id}.labelled`, a.hasLabel);
    o.set(`ui.field.${f.id}.readonly`, a.readonly || a.disabled);
    fields.push(f.id);
  }
  const btn = c.loc(pick(form.submit, c), root(c, form)).first();
  o.flag('submitVisible', await btn.isVisible().catch(() => false));
  if (form.cancel) o.flag('cancelVisible', await c.visible(pick(form.cancel, c), root(c, form)));
  o.set('ui.form.fieldCount', fields.length);
}

// ---------------------------------------------------------------------------------------------------------------
// scenarios
export function formScenarios(form, { depth = 'full' } = {}) {
  const lvl = DEPTHS[depth] ?? 2;
  const idp = form.id;
  const out = [];
  const base = { feature: form.feature, tags: ['form', ...(form.tags || [])], needsUi: true };
  const typedBase = (c) => ({ ...(typeof form.valid === 'function' ? form.valid(c) : form.valid) });

  const runCase = async (c, overrides, { via = 'click', beforeSubmit, target } = {}) => {
    await openForm(c, form);
    const typed = { ...typedBase(c), ...overrides };
    const refills = await c.step('fill', () => fillVerified(c, form, typed));
    if (beforeSubmit) await beforeSubmit(c);
    const urlBefore = c.page.url();
    let mark = c.rec.mark();
    await c.step('submit', () => submit(c, form, via));
    await settleAfterSubmit(c);
    let r = await inspectOutcome(c, form, { mark, urlBefore, typed });
    let submitRetries = 0;
    if (
      r.outcome === 'no-request' &&
      r.formVisible &&
      (await root(c, form)
        .isVisible()
        .catch(() => false))
    ) {
      // the click was swallowed (late hydration, animation): once more, and count it so a flaky button shows up
      submitRetries = 1;
      await c.page.waitForTimeout(400);
      mark = c.rec.mark();
      await c.step('submit again', () => submit(c, form, via));
      await settleAfterSubmit(c);
      r = await inspectOutcome(c, form, { mark, urlBefore, typed });
    }
    c.obs.set('low.refillsNeeded', refills);
    c.obs.set('low.submitRetries', submitRetries);
    record(c, r, { target });
    // XSS / readback after an accepted save
    if (r.accepted) {
      const rb = pick(form.readback, c);
      if (typeof rb === 'function') {
        const stored = await rb(c, {
          values: typed,
          tag: typed[
            tagFields.find((x) => typeof typed[x] === 'string' && typed[x].startsWith('pwp-')) ||
              tagFields[0]
          ],
        }).catch((e) => ({ error: oneLine(e.message) }));
        if (stored && !stored.error)
          c.obs.set(
            'map.stored',
            Object.fromEntries(Object.entries(stored).map(([k, v]) => [k, String(v).trim()])),
          );
        else if (stored?.error) c.obs.info('readbackError', stored.error);
        c.obs.set(
          'sec.xssExecuted',
          (await c.page.evaluate(() => !!window.__xss).catch(() => false)) ||
            c.rec.events.dialogs.length > 0,
        );
      }
      const cleanup = pick(form.cleanup, c);
      if (typeof cleanup === 'function')
        await cleanup(c, { values: typed }).catch((e) =>
          c.obs.note(`cleanup failed: ${oneLine(e.message, 100)}`),
        );
    }
    return r;
  };

  // tagField (string or array): the field(s) that carry the run's test-data tag so rows can be found and cleaned up.
  // The tag goes into the first one that is not the field under test (an edge value must stay verbatim).
  const tagFields = [].concat(form.tagField || []);
  const taggedBase = (c, avoid) => {
    const id = tagFields.find((x) => x !== avoid);
    return id ? { [id]: c.tag('f') } : {};
  };

  // 1. structure: the form as the user first sees it
  out.push({
    ...base,
    id: `${idp}.structure`,
    title: `${form.title}: form structure on open`,
    run: async (c) => {
      await openForm(c, form);
      await structure(c, form);
      await c.snap('form-open');
      await c.shot('form-open');
      // tab order over the declared fields (sequence of logical ids)
      const handles = await Promise.all(form.fields.map((f) => fieldHandle(c, form, f)));
      const order = [];
      await fieldLocator(c, form, form.fields[0])
        .focus()
        .catch(() => {});
      for (let i = 0; i < form.fields.length * 2 + 4; i++) {
        const idx = await c.page
          .evaluate((hs) => hs.findIndex((x) => x && x === document.activeElement), handles)
          .catch(() => -1);
        if (idx >= 0 && !order.includes(form.fields[idx].id)) order.push(form.fields[idx].id);
        await c.page.keyboard.press('Tab');
      }
      c.obs.seq('tabOrder', order);
    },
  });

  // 2. happy path (+ readback)
  out.push({
    ...base,
    id: `${idp}.happy`,
    tags: [...base.tags, 'happy'],
    title: `${form.title}: valid submit`,
    run: async (c) => {
      const r = await runCase(c, taggedBase(c));
      await c.shot('after-submit');
      c.obs.num('actions', c.obs.actions.clicks + c.obs.actions.fills + c.obs.actions.keys);
      void r;
    },
  });

  // 3. all empty, then each required field missing on its own
  const required = form.fields.filter((f) => f.required);
  out.push({
    ...base,
    id: `${idp}.all-empty`,
    tags: [...base.tags, 'validation', 'required'],
    title: `${form.title}: submit with everything empty`,
    run: async (c) => {
      await openForm(c, form);
      const urlBefore = c.page.url();
      const mark = c.rec.mark();
      await c.step('submit', () => submit(c, form));
      await settleAfterSubmit(c);
      record(c, await inspectOutcome(c, form, { mark, urlBefore, typed: {} }));
      await c.shot('all-empty');
    },
  });
  for (const f of required) {
    out.push({
      ...base,
      id: `${idp}.${f.id}.required`,
      tags: [...base.tags, 'validation', 'required'],
      title: `${form.title}: ${f.id} left empty`,
      run: async (c) => {
        const blank =
          f.type === 'select' ? { option: 'empty' } : f.type === 'checkbox' ? false : '';
        await runCase(c, { ...taggedBase(c, f.id), [f.id]: blank }, { target: `${f.id}=empty` });
      },
    });
  }

  // 4. per-field value matrix
  for (const f of form.fields) {
    if (f.skipMatrix) continue;
    for (const k of casesFor(f, depth)) {
      if (k.id === 'empty' && f.required) continue; // already covered above
      out.push({
        ...base,
        id: `${idp}.${f.id}.${k.id}`,
        tags: [...base.tags, 'edge', `field:${f.id}`, `case:${k.id}`, ...(k.xss ? ['xss'] : [])],
        title: `${form.title}: ${f.id} = ${k.id} (${k.why})`,
        run: async (c) => {
          await runCase(
            c,
            { ...taggedBase(c, f.id), [f.id]: k.value },
            { target: `${f.id}=${k.id}` },
          );
        },
      });
    }
    // uniqueness
    if (f.unique) {
      for (const [vid, mut] of [
        ['exact', (s) => s],
        ['case', (s) => s.toUpperCase()],
        ['padded', (s) => ` ${s} `],
      ]) {
        out.push({
          ...base,
          id: `${idp}.${f.id}.duplicate-${vid}`,
          tags: [...base.tags, 'edge', 'unique', `field:${f.id}`],
          title: `${form.title}: duplicate ${f.id} (${vid})`,
          run: async (c) => {
            const v =
              typeof f.sample === 'function'
                ? f.sample(c)
                : typeof f.sample === 'string'
                  ? f.sample
                  : f.type === 'email'
                    ? `${c.tag('dup')}@example.com`.toLowerCase()
                    : f.type === 'phone' || f.type === 'tel'
                      ? `+1415555${String(1000 + Math.floor(Math.random() * 8999))}`
                      : c.tag('dup');
            const first = await runCase(
              c,
              { ...taggedBase(c, f.id), [f.id]: v },
              { target: `${f.id}=seed` },
            );
            c.obs.flag('firstAccepted', first.accepted);
            c.obs.info('firstOutcome', first.outcome);
            await runCase(
              c,
              { ...taggedBase(c, f.id), [f.id]: mut(v) },
              { target: `${f.id}=duplicate-${vid}` },
            );
          },
        });
      }
    }
  }

  if (lvl >= 1) {
    // 5. UX behaviours around submission
    out.push({
      ...base,
      id: `${idp}.enter-key`,
      tags: [...base.tags, 'ux', 'keyboard'],
      title: `${form.title}: Enter submits the form`,
      run: async (c) => {
        await openForm(c, form);
        await fillAll(c, form, { ...typedBase(c), ...taggedBase(c) });
        const mark = c.rec.mark();
        await c.step('press Enter', () => submit(c, form, 'enter'));
        await settleAfterSubmit(c);
        c.obs.flag(
          'enterSubmits',
          c.rec.since(mark).http.some((h) => h.method !== 'GET'),
        );
      },
    });
    out.push({
      ...base,
      id: `${idp}.double-submit`,
      tags: [...base.tags, 'ux', 'edge', 'idempotency'],
      title: `${form.title}: double-click on submit`,
      run: async (c) => {
        await openForm(c, form);
        const tagged = { ...typedBase(c), ...taggedBase(c) };
        await fillAll(c, form, tagged);
        const btn = c.loc(pick(form.submit, c), root(c, form)).first();
        const mark = c.rec.mark();
        await btn.click({ noWaitAfter: true });
        const guarded = await btn
          .evaluate(
            (b) =>
              b.disabled ||
              b.getAttribute('aria-busy') === 'true' ||
              b.getAttribute('aria-disabled') === 'true' ||
              b.className.toString().match(/loading|spinner|busy|disabled/i) !== null,
          )
          .catch(() => 'gone');
        await btn.click({ noWaitAfter: true, timeout: 700 }).catch(() => {});
        await settleAfterSubmit(c);
        c.obs.num(
          'submitRequests',
          c.rec.since(mark).http.filter((h) => h.method !== 'GET').length,
        );
        c.obs.set('abs.submitGuardedWhileSending', guarded === true || guarded === 'gone');
        const count = pick(form.countAfter, c);
        if (typeof count === 'function')
          c.obs.num('rowsCreated', await count(c, tagged[tagFields[0]] || '').catch(() => null));
        const cleanup = pick(form.cleanup, c);
        if (typeof cleanup === 'function') await cleanup(c, { values: tagged }).catch(() => {});
      },
    });
    out.push({
      ...base,
      id: `${idp}.slow-server`,
      tags: [...base.tags, 'ux', 'network'],
      title: `${form.title}: slow server shows progress and blocks repeats`,
      run: async (c) => {
        await openForm(c, form);
        await fillAll(c, form, { ...typedBase(c), ...taggedBase(c) });
        const undo = await c.failRequests(
          (r) => r.method() !== 'GET' && ['xhr', 'fetch', 'document'].includes(r.resourceType()),
          { delay: 2500 },
        );
        const btn = c.loc(pick(form.submit, c), root(c, form)).first();
        await btn.click({ noWaitAfter: true });
        await c.page.waitForTimeout(700);
        const state = await btn
          .evaluate((b) => ({
            disabled:
              b.disabled ||
              b.getAttribute('aria-disabled') === 'true' ||
              b.getAttribute('aria-busy') === 'true',
            cls: /loading|spinner|busy|disabled/i.test(b.className.toString()),
          }))
          .catch(() => ({ disabled: true, cls: false, gone: true }));
        const spinner = await c.page
          .evaluate(() =>
            [
              ...document.querySelectorAll(
                '[aria-busy=true], [role=progressbar], [class*=spinner], [class*=loading], [class*=animate-spin]',
              ),
            ].some((e) => {
              const r = e.getBoundingClientRect();
              return r.width > 0 && r.height > 0;
            }),
          )
          .catch(() => false);
        c.obs.set('abs.progressShownWhileSending', state.disabled || state.cls || spinner);
        await undo();
        await settleAfterSubmit(c);
      },
    });
    out.push({
      ...base,
      id: `${idp}.server-error`,
      tags: [...base.tags, 'ux', 'network', 'robustness'],
      title: `${form.title}: server failure (XHR 500)`,
      run: async (c) => {
        await openForm(c, form);
        const typed = { ...typedBase(c), ...taggedBase(c) };
        await fillAll(c, form, typed);
        let hit = 0;
        const undo = await c.failRequests((r) => {
          const m = r.method() !== 'GET' && ['xhr', 'fetch'].includes(r.resourceType());
          if (m) hit += 1;
          return m;
        }, 500);
        const mark = c.rec.mark();
        await submit(c, form);
        await settleAfterSubmit(c);
        await undo();
        if (!hit) {
          c.obs.info('serverError', 'not applicable: this side submits with a full page POST');
          return;
        }
        const ev = c.rec.since(mark);
        const insp = await c.page
          .evaluate(inspectInPage, {
            els: await Promise.all(form.fields.map((f) => fieldHandle(c, form, f))),
            ids: form.fields.map((f) => f.id),
          })
          .catch(() => ({ liveTexts: [], formLevelError: false, flagged: [] }));
        const now = await readValues(c, form);
        const kept = Object.entries(typed).every(
          ([id, v]) =>
            typeof v !== 'string' ||
            v.trim() === '' ||
            !(id in now) ||
            sameValue(form.fields.find((x) => x.id === id)?.type, v, now[id]),
        );
        const btn = c.loc(pick(form.submit, c), root(c, form)).first();
        c.obs.set(
          'abs.errorFeedbackOnServerFailure',
          insp.liveTexts.length > 0 || insp.formLevelError || insp.flagged.length > 0,
        );
        c.obs.set('abs.valueKeptOnServerFailure', kept);
        c.obs.set('abs.submitUsableAfterFailure', await btn.isEnabled().catch(() => false));
        c.obs.set('low.pageErrors', ev.pageErrors.length);
      },
    });
    out.push({
      ...base,
      id: `${idp}.offline`,
      tags: [...base.tags, 'ux', 'network', 'robustness'],
      title: `${form.title}: offline while submitting`,
      run: async (c) => {
        await openForm(c, form);
        const typed = { ...typedBase(c), ...taggedBase(c) };
        await fillAll(c, form, typed);
        await c.context.setOffline(true);
        const mark = c.rec.mark();
        const urlBefore = c.page.url();
        await submit(c, form).catch(() => {});
        await c.page.waitForTimeout(1500);
        await c.context.setOffline(false);
        const stillOnForm =
          c.page.url() === urlBefore &&
          (await root(c, form)
            .isVisible()
            .catch(() => false));
        c.obs.set('abs.staysOnFormWhenOffline', stillOnForm || c.page.url() === urlBefore);
        c.obs.set('low.pageErrors', c.rec.since(mark).pageErrors.length);
        c.obs.info(
          'offlineLiveText',
          await c.page
            .evaluate(() =>
              [...document.querySelectorAll('[role=alert],[role=status],[class*=toast]')]
                .map((e) => e.textContent.trim().slice(0, 100))
                .filter(Boolean)
                .slice(0, 2),
            )
            .catch(() => []),
        );
      },
    });
    out.push({
      ...base,
      id: `${idp}.session-expired`,
      tags: [...base.tags, 'edge', 'auth', 'robustness'],
      title: `${form.title}: session expires before submit`,
      run: async (c) => {
        await openForm(c, form);
        await fillAll(c, form, { ...typedBase(c), ...taggedBase(c) });
        await c.context.clearCookies();
        await c.page
          .evaluate(() => {
            try {
              localStorage.clear();
              sessionStorage.clear();
            } catch {
              /* ignore */
            }
          })
          .catch(() => {});
        const mark = c.rec.mark();
        await submit(c, form).catch(() => {});
        await settleAfterSubmit(c);
        const ev = c.rec.since(mark);
        const path = (() => {
          try {
            return new URL(c.page.url()).pathname;
          } catch {
            return '';
          }
        })();
        const toLogin = /login|sign-?in|auth/i.test(path);
        const crashed = ev.pageErrors.length > 0 || ev.http.some((h) => h.status >= 500);
        const stays = await root(c, form)
          .isVisible()
          .catch(() => false);
        const feedback =
          stays &&
          (await c.page
            .evaluate(() =>
              [
                ...document.querySelectorAll(
                  '[role=alert],[role=status],[class*=toast],[class*=alert],[class*=flash]',
                ),
              ].some((e) => e.textContent.trim().length > 2 && e.getBoundingClientRect().width > 0),
            )
            .catch(() => false));
        const kind = crashed
          ? 'crash'
          : toLogin
            ? 'redirect-login'
            : feedback
              ? 'stays-with-feedback'
              : stays
                ? 'stays-silent'
                : 'other';
        c.obs.enum('sessionExpiry', kind);
        c.obs.set(
          'abs.sessionExpiryQuality',
          { crash: 0, 'stays-silent': 1, other: 1, 'stays-with-feedback': 2, 'redirect-login': 2 }[
            kind
          ],
        );
        c.obs.set('low.http5xx', ev.http.filter((h) => h.status >= 500).length);
      },
    });
  }
  if (form.cancel && lvl >= 1) {
    out.push({
      ...base,
      id: `${idp}.cancel-dirty`,
      tags: [...base.tags, 'ux'],
      title: `${form.title}: cancel with typed data, then reopen`,
      run: async (c) => {
        await openForm(c, form);
        const f0 =
          form.fields.find((f) => ['text', 'name'].includes(f.type || 'text')) || form.fields[0];
        await fillField(c, form, f0, c.tag('dirty'));
        const mark = c.rec.mark();
        await c.click(pick(form.cancel, c), { root: root(c, form) });
        await c.page.waitForTimeout(500);
        c.obs.flag(
          'confirmOnDirtyCancel',
          c.rec.since(mark).dialogs.length > 0 || (await c.visible({ role: 'dialog' })),
        );
        const closed = !(await root(c, form)
          .isVisible()
          .catch(() => false));
        c.obs.flag('cancelClosesForm', closed || c.page.url() !== '');
        await openForm(c, form).catch(() => {});
        const vals = await readValues(c, form);
        c.obs.flag('reopenIsClean', !(f0.id in vals) || String(vals[f0.id] || '') === '');
      },
    });
  }
  return out;
}

export { pick, fieldLocator, root as formRoot, openForm, structure as formStructure };
