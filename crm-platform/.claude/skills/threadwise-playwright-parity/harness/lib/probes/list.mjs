// List and delete engines. Datasets differ between Reference and our platform, so these compare BEHAVIOUR, not row
// counts: does a miss show an empty state, does a sort click reorder, does a filter narrow, does load-more add rows,
// does delete ask first, does cancel keep the row, is the row really gone after a reload.
import { settle } from '../sides.mjs';
import { pick, oneLine } from '../util.mjs';

const rowsOf = (c, list) => c.loc(pick(list.rows, c));
const countRows = async (c, list) =>
  await rowsOf(c, list)
    .count()
    .catch(() => 0);
const firstTexts = async (c, list, col, n = 8) => {
  const rows = rowsOf(c, list);
  const total = Math.min(await rows.count().catch(() => 0), n);
  const out = [];
  for (let i = 0; i < total; i++) {
    const cell = rows.nth(i).locator('td, [role=cell], [role=gridcell]').nth(col);
    out.push(((await cell.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim());
  }
  return out;
};
const direction = (xs) => {
  const v = xs.filter((x) => x !== '');
  if (v.length < 2) return 'n/a';
  const num = v.every((x) => /^-?[\d.,]+$/.test(x));
  const key = (x) => (num ? parseFloat(x.replace(/,/g, '')) : x.toLowerCase());
  const asc = v.every((x, i) => i === 0 || key(v[i - 1]) <= key(x));
  const desc = v.every((x, i) => i === 0 || key(v[i - 1]) >= key(x));
  return asc && desc ? 'flat' : asc ? 'asc' : desc ? 'desc' : 'unsorted';
};

async function typeSearch(c, list, term) {
  const s = list.search;
  const input = c.loc(pick(s.input, c)).first();
  await input.fill(term);
  c.obs.actions.fills += 1;
  const submit = pick(s.submit, c);
  if (!submit || submit === 'enter') await input.press('Enter');
  else await c.click(submit);
  await c.afterAction({ quiet: Math.max(c.cfg.timeouts.quiet, 700) });
}

async function health(c, since) {
  const ev = c.rec.since(since);
  return { crash: ev.pageErrors.length > 0 || ev.http.some((h) => h.status >= 500) };
}

export function listScenarios(list, { depth = 'full' } = {}) {
  const lvl = { quick: 0, standard: 1, full: 2 }[depth] ?? 2;
  const out = [];
  const base = { feature: list.feature, tags: ['list', ...(list.tags || [])], needsUi: true };
  const open = async (c) => {
    await c.step('open list', () => c.goto(list.page, { ready: list.ready }));
  };

  out.push({
    ...base,
    id: `${list.id}.initial`,
    title: `${list.title}: first view`,
    run: async (c) => {
      await open(c);
      const n = await countRows(c, list);
      c.obs.flag('hasRows', n > 0);
      const s = await c.snap('list');
      c.obs.set('ui.table.0.columns', s.tables[0]?.columns ?? 0);
      c.obs.set('ui.pagination.kind', s.pagination.kind);
      c.obs.info('rows', n);
      await c.shot('list');
    },
  });

  if (list.search) {
    const miss = `zz-nomatch-${Math.random().toString(36).slice(2, 7)}`;
    out.push({
      ...base,
      id: `${list.id}.search.miss`,
      tags: [...base.tags, 'search', 'empty-state'],
      title: `${list.title}: search with no match`,
      run: async (c) => {
        await open(c);
        const before = await countRows(c, list);
        await typeSearch(c, list, miss);
        const n = await countRows(c, list);
        const s = await c.snap('search-miss');
        c.obs.flag('noRowsOnMiss', n === 0);
        c.obs.flag('rowsReducedOnMiss', n < before || before === 0);
        c.obs.set(
          'abs.emptyStateShown',
          n === 0 && (s.emptyState || /(no |nothing|empty|not found|0 )/i.test(s.textSample)),
        );
        await c.shot('search-miss');
      },
    });
    if (list.search.term) {
      out.push({
        ...base,
        id: `${list.id}.search.hit`,
        tags: [...base.tags, 'search'],
        title: `${list.title}: search narrows to matches`,
        run: async (c) => {
          await open(c);
          const term =
            typeof list.search.term === 'object' ? pick(list.search.term, c) : list.search.term;
          await typeSearch(c, list, term);
          const n = await countRows(c, list);
          c.obs.flag('hasMatches', n > 0);
          c.obs.num('matches', n);
          const url = new URL(c.page.url());
          c.obs.flag(
            'searchInUrl',
            [...url.searchParams.values()].some((v) => v.includes(term)),
          );
          await c.page.reload({ waitUntil: 'load' });
          await settle(c.page);
          c.obs.flag(
            'searchSurvivesReload',
            (await countRows(c, list)) === n &&
              (await c
                .loc(pick(list.search.input, c))
                .first()
                .inputValue()
                .catch(() => '')) === term,
          );
        },
      });
    }
    if (lvl >= 1) {
      const EDGES = [
        ['percent', '%'],
        ['underscore', '_'],
        ['apostrophe', "O'Brien"],
        ['double-quote', '"quoted"'],
        ['backslash', '\\'],
        ['script', '<script>window.__xss=1</script>'],
        ['spaces', '   '],
        ['unicode', 'Zoë 李雷'],
        ['long', 'x'.repeat(400)],
        ['sql', "' OR 1=1 --"],
        ['wildcard', '*'],
        ['upper', 'UPPERCASE'],
      ];
      for (const [id, v] of EDGES.slice(0, lvl >= 2 ? EDGES.length : 5)) {
        out.push({
          ...base,
          id: `${list.id}.search.edge-${id}`,
          tags: [...base.tags, 'search', 'edge', ...(id === 'script' ? ['xss'] : [])],
          title: `${list.title}: search for ${id}`,
          run: async (c) => {
            await open(c);
            const mark = c.rec.mark();
            await typeSearch(c, list, v);
            const h = await health(c, mark);
            c.obs.flag('survives', !h.crash);
            c.obs.flag(
              'listStillRenders',
              (await countRows(c, list)) >= 0 && (await c.visible(pick(list.search.input, c))),
            );
            c.obs.set(
              'sec.xssExecuted',
              (await c.page.evaluate(() => !!window.__xss).catch(() => false)) ||
                c.rec.events.dialogs.length > 0,
            );
            c.obs.set('low.http5xx', c.rec.since(mark).http.filter((x) => x.status >= 500).length);
          },
        });
      }
    }
  }

  for (const s of list.sorts || []) {
    out.push({
      ...base,
      id: `${list.id}.sort.${s.id}`,
      tags: [...base.tags, 'sort'],
      title: `${list.title}: sort by ${s.id}`,
      run: async (c) => {
        await open(c);
        const col = typeof s.col === 'object' ? pick(s.col, c) : s.col;
        const before = await firstTexts(c, list, col);
        const header = c.loc(pick(s.header, c)).first();
        await c.click(header);
        await c.afterAction({ quiet: 700 });
        const one = await firstTexts(c, list, col);
        await c.click(c.loc(pick(s.header, c)).first()).catch(() => {});
        await c.afterAction({ quiet: 700 });
        const two = await firstTexts(c, list, col);
        c.obs.enum('sort.first', direction(one));
        c.obs.enum('sort.second', direction(two));
        c.obs.flag('sortToggles', JSON.stringify(one) !== JSON.stringify(two));
        c.obs.flag(
          'sortChangesOrder',
          JSON.stringify(before) !== JSON.stringify(one) || direction(one) !== 'unsorted',
        );
      },
    });
  }

  for (const f of list.filters || []) {
    out.push({
      ...base,
      id: `${list.id}.filter.${f.id}`,
      tags: [...base.tags, 'filter'],
      title: `${list.title}: filter by ${f.id}`,
      run: async (c) => {
        await open(c);
        const before = await countRows(c, list);
        const ctl = c.loc(pick(f.control, c)).first();
        const opt = pick(f.option, c);
        const tag = await ctl.evaluate((e) => e.tagName.toLowerCase()).catch(() => '');
        if (tag === 'select') await ctl.selectOption(typeof opt === 'string' ? opt : opt);
        else {
          await c.click(ctl);
          if (opt) await c.click(opt);
        }
        await c.afterAction({ quiet: 800 });
        const after = await countRows(c, list);
        c.obs.flag('filterNarrows', after <= before);
        c.obs.flag('filterInUrl', new URL(c.page.url()).search.length > 1);
        await c.page.reload({ waitUntil: 'load' });
        await settle(c.page);
        c.obs.flag('filterSurvivesReload', (await countRows(c, list)) === after);
      },
    });
  }

  if (list.more) {
    out.push({
      ...base,
      id: `${list.id}.more`,
      tags: [...base.tags, 'pagination'],
      title: `${list.title}: load more / next page`,
      run: async (c) => {
        await open(c);
        const before = await countRows(c, list);
        const first = (await firstTexts(c, list, 0, 1))[0];
        const more = c.loc(pick(list.more, c)).first();
        const visible = await more.isVisible().catch(() => false);
        c.obs.flag('moreControlVisible', visible);
        if (!visible) return;
        await c.click(more);
        await c.afterAction({ quiet: 800 });
        const after = await countRows(c, list);
        const first2 = (await firstTexts(c, list, 0, 1))[0];
        c.obs.flag('moreChangesList', after !== before || first !== first2);
      },
    });
  }

  if (list.rowOpen) {
    out.push({
      ...base,
      id: `${list.id}.row-open`,
      tags: [...base.tags, 'navigation'],
      title: `${list.title}: open a row`,
      run: async (c) => {
        await open(c);
        const target = c.loc(pick(list.rowOpen, c)).first();
        if (!(await target.isVisible().catch(() => false))) {
          c.obs.flag('rowOpenable', false);
          return;
        }
        const before = c.page.url();
        await c.click(target);
        await c.afterAction({ quiet: 800 });
        c.obs.flag('rowOpenable', c.page.url() !== before || (await c.visible({ role: 'dialog' })));
        c.obs.flag(
          'backReturnsToList',
          await (async () => {
            await c.page.goBack().catch(() => {});
            await settle(c.page);
            return (
              (await countRows(c, list)) >= 0 &&
              new URL(c.page.url()).pathname === new URL(before).pathname
            );
          })(),
        );
      },
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
export function deleteScenarios(del) {
  const base = { feature: del.feature, tags: ['delete', ...(del.tags || [])], needsUi: true };
  const prep = async (c) => {
    const seed = pick(del.seed, c);
    const made = await c.step('seed row', () => seed(c));
    await c.step('open list', () => c.goto(del.page, { ready: del.ready }));
    const row = c.loc(pick(del.row, c)(made ?? {}, c));
    return { made, row };
  };
  const trigger = async (c, row, made) => {
    const start = pick(del.start, c);
    await c.step('start delete', () => start(c, row, made));
    await c.page.waitForTimeout(400);
  };
  const confirmLoc = (c) => (del.confirm ? c.loc(pick(del.confirm, c)).first() : null);
  const out = [];
  out.push({
    ...base,
    id: `${del.id}.confirm-shown`,
    title: `${del.title}: asks before deleting`,
    run: async (c) => {
      const { made, row } = await prep(c);
      const mark = c.rec.mark();
      await trigger(c, row, made);
      const confirm = confirmLoc(c);
      const dialogs = c.rec.since(mark).dialogs.length;
      c.obs.flag(
        'confirmShown',
        dialogs > 0 || (confirm ? await confirm.isVisible().catch(() => false) : false),
      );
      await c.shot('confirm');
      const cancel = del.cancel ? c.loc(pick(del.cancel, c)).first() : null;
      if (cancel && (await cancel.isVisible().catch(() => false)))
        await cancel.click().catch(() => {});
      const cleanup = pick(del.cleanup, c);
      if (typeof cleanup === 'function') await cleanup(c, made).catch(() => {});
    },
  });
  out.push({
    ...base,
    id: `${del.id}.cancel-keeps`,
    title: `${del.title}: cancelling keeps the row`,
    run: async (c) => {
      const { made, row } = await prep(c);
      c.rec.dialogPolicy = 'dismiss';
      await trigger(c, row, made);
      const cancel = del.cancel ? c.loc(pick(del.cancel, c)).first() : null;
      if (cancel && (await cancel.isVisible().catch(() => false))) await cancel.click();
      await c.afterAction({ quiet: 700 });
      c.obs.flag(
        'rowKeptOnCancel',
        await c
          .loc(pick(del.row, c)(made ?? {}, c))
          .first()
          .isVisible()
          .catch(() => false),
      );
      const cleanup = pick(del.cleanup, c);
      if (typeof cleanup === 'function') await cleanup(c, made).catch(() => {});
    },
  });
  out.push({
    ...base,
    id: `${del.id}.confirm-removes`,
    tags: [...base.tags, 'happy'],
    title: `${del.title}: confirming removes the row`,
    run: async (c) => {
      const { made, row } = await prep(c);
      await trigger(c, row, made);
      const confirm = confirmLoc(c);
      if (confirm && (await confirm.isVisible().catch(() => false))) await c.click(confirm);
      await c.afterAction({ quiet: 900 });
      c.obs.flag(
        'rowRemoved',
        !(await c
          .loc(pick(del.row, c)(made ?? {}, c))
          .first()
          .isVisible()
          .catch(() => false)),
      );
      await c.page.reload({ waitUntil: 'load' });
      await settle(c.page);
      c.obs.flag(
        'goneAfterReload',
        !(await c
          .loc(pick(del.row, c)(made ?? {}, c))
          .first()
          .isVisible()
          .catch(() => false)),
      );
      await c.shot('after-delete');
    },
  });
  return out;
}

export { oneLine };
