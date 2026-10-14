#!/usr/bin/env node
// QA suite: one command per QA task, one report.
//
//   pnpm qa --list                       the tasks and what each one checks
//   pnpm qa                              every task that can run without a stack (static checks); live checks are reported as skipped
//   pnpm qa 30 31 43                     only those task numbers
//   pnpm qa -- --all-live                with API_URL / WEB_URL / DATABASE_URL / QA_* set, run the live checks too
//   pnpm qa -- --fail                    exit 1 if any check fails or a measurable target is not met (CI gate)
//
// Live targets are LOCAL only (localhost). See tools/qa-suite/README.md for the environment variables.
// Output: reports/qa-suite/<timestamp>/report.html (+ report.md, results.json) and a copy in reports/qa-suite/latest/.

import { readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ROOT, env, sh } from './lib/core.mjs';
import { summarise, writeReport } from './lib/report.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const wanted = args.filter((a) => /^\d+$/.test(a)).map(Number);

const tasks = [];
for (const f of readdirSync(join(here, 'tasks'))
  .filter((f) => f.endsWith('.mjs'))
  .sort()) {
  const t = (await import(pathToFileURL(join(here, 'tasks', f)))).default;
  if (t?.id) tasks.push(t);
}
tasks.sort((a, b) => a.id - b.id);

if (args.includes('--list')) {
  for (const t of tasks)
    console.log(`${String(t.id).padStart(3)}  ${t.priority}  ${t.name.padEnd(28)} ${t.target}`);
  process.exit(0);
}

const selected = wanted.length ? tasks.filter((t) => wanted.includes(t.id)) : tasks;
const results = [];
for (const task of selected) {
  process.stdout.write(`#${task.id} ${task.name} ... `);
  const t0 = Date.now();
  let r;
  try {
    r = await task.run({ args });
  } catch (e) {
    r = {
      checks: [
        {
          id: 'crash',
          title: 'task crashed',
          status: 'fail',
          detail: e.stack?.split('\n').slice(0, 3).join(' | '),
        },
      ],
    };
  }
  const s = summarise([{ checks: r.checks }]);
  console.log(
    `${s.pass} pass, ${s.fail} fail, ${s.warn} warn, ${s.skip} skipped (${((Date.now() - t0) / 1000).toFixed(1)}s)`,
  );
  results.push({
    task: {
      id: task.id,
      name: task.name,
      priority: task.priority,
      target: task.target,
      owner: task.owner,
    },
    ...r,
  });
}

const git = (a) => sh('git', a).stdout?.trim() ?? '';
const meta = {
  generatedAt: new Date().toISOString(),
  commit: git(['rev-parse', '--short', 'HEAD']),
  branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
  live: { api: env.api, web: env.web, db: !!env.db },
};
const report = writeReport(meta, results);
const tot = summarise(results);
console.log(`\nTotal: ${tot.pass} pass, ${tot.fail} fail, ${tot.warn} warn, ${tot.skip} skipped`);
console.log(`Report: ${relative(process.cwd(), report)}`);
if (args.includes('--fail') && (tot.fail || results.some((r) => r.target?.met === false)))
  process.exit(1);
