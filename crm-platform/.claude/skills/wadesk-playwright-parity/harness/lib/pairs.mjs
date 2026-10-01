// Side-by-side composite screenshots (WaDesk left, ours right) for every scenario that has a defect or a review item,
// so one image read shows both apps. Best effort: a failure here never fails a comparison.
import { chromium } from 'playwright';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ensureDir, slug } from './util.mjs';

const LABELS = [
  'load',
  'form-open',
  'after-submit',
  'all-empty',
  'list',
  'search-miss',
  'degraded',
  'confirm',
  'after-delete',
  'responsive-mobile',
  'responsive-tablet',
  'responsive-desktop',
  'error',
];

export async function makePairs(runDir, findings, { max = 40 } = {}) {
  const wanted = new Set(
    findings.filter((f) => ['defect', 'review'].includes(f.result)).map((f) => f.scenario),
  );
  const jobs = [];
  for (const id of wanted) {
    const dir = join(runDir, 'shots', slug(id));
    for (const label of LABELS) {
      const w = join(dir, `wadesk-${label}.png`);
      const o = join(dir, `ours-${label}.png`);
      if (existsSync(w) && existsSync(o)) jobs.push({ id, label, w, o });
    }
  }
  if (!jobs.length) return [];
  const out = [];
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1900, height: 900 } });
    const dir = ensureDir(join(runDir, 'pairs'));
    for (const j of jobs.slice(0, max)) {
      const html = join(dir, '_pair.html');
      writeFileSync(
        html,
        `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#1e1e1e;color:#fff;font:600 14px system-ui"><div style="display:flex;gap:10px;padding:10px;align-items:flex-start"><figure style="margin:0;width:930px"><figcaption style="padding:4px 0">WaDesk: ${j.id} / ${j.label}</figcaption><img style="width:100%;display:block" src="${pathToFileURL(j.w)}"></figure><figure style="margin:0;width:930px"><figcaption style="padding:4px 0">Ours</figcaption><img style="width:100%;display:block" src="${pathToFileURL(j.o)}"></figure></div>`,
      );
      await page.goto(pathToFileURL(html).href);
      await page.waitForLoadState('load');
      const file = join(dir, `${slug(j.id)}__${j.label}.png`);
      await page.screenshot({ path: file, fullPage: true });
      out.push(file);
    }
  } finally {
    await browser.close();
  }
  return out;
}
