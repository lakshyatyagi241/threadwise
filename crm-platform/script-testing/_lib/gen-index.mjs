#!/usr/bin/env node
// Regenerates the generated table inside script-testing/README.md (between the GENERATED markers) from every <test>/meta.json.
// node script-testing/_lib/gen-index.mjs          rewrite README.md
// node script-testing/_lib/gen-index.mjs --check  exit 1 if README.md is stale (use in CI)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discover } from './master.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const rows = discover(root).map((t) => t.status === 'pending'
  ? `| [${t.name}](${t.name}/) | ${cell(t.title)} | PENDING | - | - | - | ${cell(t.note)} | - | - |`
  : `| [${t.name}](${t.name}/) | ${cell(t.title)} | ${t.heavy ? 'yes' : 'no'} | ${t.estMinutes?.quick ?? '?'} / ${t.estMinutes?.full ?? '?'} | ${(t.needs ?? []).join(', ')} | \`bash script-testing/${t.name}/run.sh --quick\` | ${cell(t.proves)} | ${cell(t.doesNotProve)} | ${t.report ? '`' + t.report + '`' : '-'} |`);
const table = ['| Test | Title | Heavy | Min quick / full | Needs | Command | Proves | Does not prove | Report |', '|---|---|---|---|---|---|---|---|---|', ...rows].join('\n');
const file = path.join(root, 'README.md');
const src = fs.readFileSync(file, 'utf8');
const next = src.replace(/(<!-- GENERATED:START -->)[\s\S]*?(<!-- GENERATED:END -->)/, `$1\n${table}\n$2`);
if (process.argv.includes('--check')) { if (next !== src) { console.error('script-testing/README.md is stale: run node script-testing/_lib/gen-index.mjs'); process.exit(1); } process.exit(0); }
fs.writeFileSync(file, next);
console.log(`README.md index updated: ${rows.length} test folders`);
