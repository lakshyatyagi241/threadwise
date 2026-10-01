#!/usr/bin/env node
// Look at a screen the way the comparator does, to write a twin spec without guessing locators.
//   node explore.mjs <threadwise|ours> <path> [--click "<button name>"] [--root "<css>"] [--shot out.png] [--json]
//   --click   click the first button/link with that accessible name before taking the snapshot (opens modals/menus)
//   --root    restrict the snapshot to a CSS subtree (a form, a dialog)
//   --anonymous  do not log in first (public pages such as /login)
// Prints headings, forms with every field (kind, name, label, required, limits), tables, buttons, dialogs and the
// pagination style. Field `name`s and labels are what you put in the spec's per-side locators.
import { chromium } from 'playwright';
import { loadConfig } from './lib/config.mjs';
import { createSides, settle } from './lib/sides.mjs';
import { snapshotInPage } from './lib/snapshot.mjs';
import { parseArgs } from './lib/util.mjs';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const a = parseArgs(process.argv.slice(2), {
  click: 'str',
  root: 'str',
  shot: 'str',
  json: 'bool',
  anonymous: 'bool',
});
const [sideName, path = '/'] = a._;
if (!['threadwise', 'ours'].includes(sideName)) {
  console.error(
    'usage: node explore.mjs <threadwise|ours> <path> [--click "name"] [--root css] [--shot file.png] [--json]',
  );
  process.exit(2);
}
const cfg = loadConfig();
const browser = await chromium.launch({ headless: cfg.headless });
const sides = createSides({
  cfg,
  browser,
  runDir: mkdtempSync(join(tmpdir(), 'parity-explore-')),
  sides: [sideName],
});
const side = sides[sideName];
try {
  const h = await side.open({ loggedIn: !a.anonymous });
  await h.page.goto(side.url(path), { waitUntil: 'load' });
  await settle(h.page);
  if (a.click) {
    await h.page
      .getByRole('button', { name: new RegExp(a.click, 'i') })
      .or(h.page.getByRole('link', { name: new RegExp(a.click, 'i') }))
      .first()
      .click();
    await settle(h.page, { quiet: 700 });
  }
  const s = await h.page.evaluate(snapshotInPage, { root: a.root });
  if (a.shot) await h.page.screenshot({ path: a.shot });
  if (a.json) console.log(JSON.stringify(s, null, 2));
  else {
    console.log(
      `${sideName} ${s.url}  title="${s.title}"  viewport ${s.viewport.w}x${s.viewport.h}${s.overflowX ? '  (horizontal overflow)' : ''}`,
    );
    console.log('headings:', s.headings.map((x) => `h${x.level} ${x.text}`).join(' | ') || '-');
    console.log('landmarks:', JSON.stringify(s.landmarks), ' counts:', JSON.stringify(s.counts));
    for (const f of s.forms) {
      console.log(
        `\nFORM ${f.id || '(no id)'} ${f.method.toUpperCase()} ${f.action || ''}${f.hasCsrf ? '  [csrf]' : ''}`,
      );
      for (const x of f.fields)
        console.log(
          `  ${x.kind.padEnd(9)} name=${JSON.stringify(x.name)} label=${JSON.stringify(x.label)}${x.required ? ' REQUIRED' : ''}${x.maxlength ? ' max=' + x.maxlength : ''}${x.pattern ? ' pattern=' + x.pattern : ''}${x.options ? ' options=' + x.options : ''}${x.disabled ? ' disabled' : ''}`,
        );
      if (f.buttons.length)
        console.log(
          '  buttons:',
          f.buttons.map((b) => `${b.name || '(icon)'}[${b.type}]`).join(' | '),
        );
    }
    for (const t of s.tables)
      console.log(
        `\nTABLE ${t.columns} cols, ${t.rows} rows, sortable ${t.sortable}, rowActions ${t.hasRowActions}, checkboxCol ${t.hasCheckboxColumn}\n  headers: ${t.headers.join(' | ')}`,
      );
    console.log(
      '\npagination:',
      JSON.stringify(s.pagination),
      ' emptyState:',
      s.emptyState,
      ' dialogs:',
      s.dialogs.map((d) => d.name || '(dialog)').join(', ') || '-',
    );
    console.log(
      'buttons:',
      s.buttons
        .slice(0, 40)
        .map((b) => b.name || '(icon)')
        .join(' | '),
    );
    if (s.alerts.length)
      console.log('alerts:', s.alerts.map((x) => `${x.cls}:${x.text}`).join(' | '));
  }
} catch (e) {
  console.error(`explore failed: ${e.message.split('\n')[0]}`);
  process.exitCode = 1;
} finally {
  await side.close();
  await browser.close();
}
