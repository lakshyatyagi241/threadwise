#!/usr/bin/env node
/**
 * Reads the CONFIRMED wallet balance and the plan facts of one workspace from geta_core (read-only) and writes the files the load needs.
 *
 *   node pilot/staging/core-opening.cjs --client iskm --workspace <waboo db name> [--out <dir>]
 *
 * Why: the tenant database has no wallet total (only credit_logs.new_balance up to the last AI deduction). The live balance is
 * geta_core.workspace.credits.remaining_amounts, plus top-ups in geta_core.reseller_credit_logs. Never guess an opening balance.
 *
 * Writes <out>/<client>-credit-opening.json (read by credits/config.ts, same shape as always) and <out>/<client>-core.json
 * (business, plan, subscription, top-ups; no credentials, no personal data). Default <out>: D:\wadesk-vedant\_work\migration\runs\config.
 * Needs the access kit (mongo-eval.cjs) at GETA_MONGO_KIT (default: the kit folder under db-migration). Output: masked counts only.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const args = process.argv.slice(2);
const flag = (n) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : undefined);
const client = flag('client');
const ws = flag('workspace');
if (!client || !ws || !/^[\w.-]+$/.test(client) || !/^[\w.+-]+$/.test(ws)) {
  console.error('usage: core-opening.cjs --client <key> --workspace <waboo db name> [--out <dir>]');
  process.exit(2);
}
const out = flag('out') || 'D:\\wadesk-vedant\\_work\\migration\\runs\\config';
const kit = process.env.GETA_MONGO_KIT || path.resolve(__dirname, '..', '..', 'exporter');

const r = spawnSync(process.execPath, [path.join(kit, 'bin', 'mongo-eval.cjs'), '--query', 'core', '--workspace', ws], {
  encoding: 'utf8',
  timeout: 120000,
  env: { ...process.env, MSYS_NO_PATHCONV: '1' },
});
const m = /@@CORE@@(\{.*\})/.exec(r.stdout || '');
if (!m) {
  console.error('core-opening: no answer from geta_core (host key / VPN?). exit', r.status);
  process.exit(1);
}
const core = JSON.parse(m[1]);
if (core.error) {
  console.error(`core-opening: ${core.error} for ${ws}`);
  process.exit(1);
}
const cr = core.workspace.credits || {};
const remaining = Number(cr.remaining_amounts);
if (!Number.isFinite(remaining) || remaining < 0 || !/^[a-z]{3}$/i.test(cr.currency || '')) {
  console.error('core-opening: credits.remaining_amounts / currency missing or invalid:', JSON.stringify(cr));
  process.exit(1);
}
const day = new Date().toISOString().slice(0, 10);
// purchases are in the tenant database (credits_expenses): a credit is money in, a debit money out
const re = spawnSync(process.execPath, [path.join(kit, 'bin', 'mongo-eval.cjs'), '--query', 'expenses', '--workspace', ws], { encoding: 'utf8', timeout: 120000, env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
const me = /@@EXP@@(\[.*\])/.exec(re.stdout || '');
if (!me) {
  console.error('core-opening: no answer for credits_expenses of', ws, '(exit', re.status, ')');
  process.exit(1);
}
for (const e of JSON.parse(me[1])) {
  const money = Number(e.amount);
  if (!Number.isFinite(money) || money <= 0 || !e.at) continue;
  core.walletEvents.push({ src: 'expense', id: e.id, at: e.at, delta: e.type === 'debit' ? -money : money, invoice: e.invoice });
}
// the workspace's own settings the app has a home for (no credentials, no personal data): the deal pipelines with their stages and lost
// reasons, and the opt-in / opt-out keyword rows of the consent screen
const rs = spawnSync(process.execPath, [path.join(kit, 'bin', 'mongo-eval.cjs'), '--query', 'settings', '--workspace', ws], { encoding: 'utf8', timeout: 120000, env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
const ms = /@@SET@@(\{.*\})/.exec(rs.stdout || '');
if (!ms) {
  // without the settings, core-load would skip the pipelines, lost reasons, consent keywords, task outcomes, last logins and auto-assignment and the run could still look green
  console.error('core-opening: no answer for the workspace settings of', ws, '(exit', rs.status, '): refusing to write a core.json without them');
  process.exit(1);
}
core.settings = JSON.parse(ms[1]);
core.walletEvents.sort((a, b) => String(a.at).localeCompare(String(b.at)));
core.readAt = new Date().toISOString();
const opening = {
  amount: remaining.toFixed(2),
  currency: cr.currency.toUpperCase(),
  asOf: new Date().toISOString().replace(/\.\d+Z$/, '+00:00'),
  confirmedBy: `geta_core.workspace.credits.remaining_amounts for ${ws}, read ${day}`.slice(0, 160),
  note: 'Waboo keeps the live wallet balance in geta_core, not in the tenant database.',
};
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, `${client}-credit-opening.json`), JSON.stringify(opening, null, 2) + '\n');
fs.writeFileSync(path.join(out, `${client}-core.json`), JSON.stringify({ readOn: day, ...core }, null, 2) + '\n');
console.log(
  `core-opening: ${client}: balance ${opening.amount} ${opening.currency}; plan ${core.subscription.planCode || '-'} (${core.subscription.status || '-'}); ${core.topups.length} top-up row(s); wrote ${client}-credit-opening.json and ${client}-core.json`,
);
