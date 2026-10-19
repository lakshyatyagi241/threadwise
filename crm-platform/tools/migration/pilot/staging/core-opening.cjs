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
if (!client || !ws || !/^[\w.-]+$/.test(client) || !/^[\w.-]+$/.test(ws)) {
  console.error('usage: core-opening.cjs --client <key> --workspace <waboo db name> [--out <dir>]');
  process.exit(2);
}
const out = flag('out') || 'D:\\wadesk-vedant\\_work\\migration\\runs\\config';
const kit =
  process.env.GETA_MONGO_KIT ||
  'D:\\wadesk-vedant\\db-migration\\geta-mongodb-read-replica-prod\\geta-mongodb-read-replica-prod';

const expr = `(()=>{const w=db.workspace.findOne({workspace_id:${JSON.stringify(ws)}});if(!w)return "@@CORE@@"+JSON.stringify({error:"no workspace"});
const b=db.business.findOne({id:w.business_id})||{};const sd=b.subscription_data||{};
const tops=db.reseller_credit_logs.find({to_workspace:${JSON.stringify(ws)}}).sort({transaction_datetime:1}).toArray().map(r=>({action:r.action,added:r.credits_added,removed:r.credits_removed,at:r.transaction_datetime}));
const wev=db.reseller_credit_logs.find({$or:[{from_workspace:${JSON.stringify(ws)}},{to_workspace:${JSON.stringify(ws)}}]}).sort({transaction_datetime:1}).toArray().map(r=>{const inn=r.to_workspace===${JSON.stringify(ws)};const prev=inn?r.to_previous_balance:r.from_previous_balance;const upd=inn?r.to_updated_balance:r.from_updated_balance;return {src:'reseller',id:String(r.id||r._id),at:r.transaction_datetime,delta:Math.round((upd-prev)*10000)/10000,prev:prev,reason:r.reason||null};});
return "@@CORE@@"+JSON.stringify({walletEvents:wev,workspace:{id:w.workspace_id,businessId:w.business_id,status:w.status,timezone:w.timezone,primaryLanguage:w.primary_language,provider:w.meta_provider,credits:w.credits,autoAssignment:(w.config||{}).auto_assignment===true},
business:{id:b.id,name:b.name,domain:b.domain,schemaName:b.schema_name},subscription:{id:sd.subscription_id,planCode:sd.plan_code,name:sd.name,status:sd.status,amount:sd.amount,subTotal:sd.sub_total,interval:sd.interval,intervalUnit:sd.interval_unit,activation:sd.activation_date,lastBilling:sd.last_billing_date,nextBilling:sd.next_billing_date,customerId:sd.customer_id,quantity:sd.quantity,discount:sd.discount,config:(sd.config||[]).map(c=>({code:c.code,name:c.name,status:c.status,limit:c.limit,visible:c.is_visible}))},sub:(function(){const s=db.subscriptions.findOne({subscription_id:sd.subscription_id})||{};return {number:s.subscription_number,invoiceId:s.invoice_id,paymentMethod:s.associated_payment_method,paymentTerms:s.payment_terms_label};})(),planCatalogue:(function(){const p=db.plan_permissions.findOne({plan_code:sd.plan_code})||{};return {planCode:p.plan_code,term:p.term,type:p.type,amount:p.amount,isCustom:p.is_custom};})(),topups:tops});})()`;

const r = spawnSync(process.execPath, [path.join(kit, 'bin', 'mongo-eval.cjs'), 'geta_core', expr], {
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
const exprE = `(()=>{const rows=db.getCollection("credits_expenses").find({}).sort({transaction_time:1}).toArray().map(r=>({src:'expense',id:String(r.id||r._id),at:r.transaction_time,type:r.transaction_type,amount:r.total_cost,invoice:r.invoice_id||null}));return "@@EXP@@"+JSON.stringify(rows);})()`;
const re = spawnSync(process.execPath, [path.join(kit, 'bin', 'mongo-eval.cjs'), ws, exprE], { encoding: 'utf8', timeout: 120000, env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
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
const exprS = `(()=>{const day=x=>x&&x.$date?x.$date:x;
const pipes=db.getCollection("deal_pipelines").find({type:"Pipeline"}).sort({created_at:1,_id:1}).toArray().map(p=>({id:p.id,name:p.name,stages:(p.stages||[]).map(s=>({id:s.id,name:s.name,probability:s.win_probability}))}));
const lost=db.getCollection("deal_pipelines").find({type:"Lost_Reason"}).toArray().flatMap(d=>(d.lost_reasons||[]).map(r=>({id:r.id,reason:r.lost_reason})));
const consent=db.getCollection("workspace_settings").find({type:{$in:["opt-in","opt-out"]}}).toArray().map(d=>({type:d.type,channel:d.channel,status:d.status,keywords:(d.config||{}).keywords||[],response:((d.config||{}).response||{}).value||null,responseType:(d.config||{}).type||null}));
return "@@SET@@"+JSON.stringify({pipelines:pipes,lostReasons:lost,consent:consent})})()`;
const rs = spawnSync(process.execPath, [path.join(kit, 'bin', 'mongo-eval.cjs'), ws, exprS], { encoding: 'utf8', timeout: 120000, env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
const ms = /@@SET@@(\{.*\})/.exec(rs.stdout || '');
if (!ms) console.error('core-opening: no answer for the workspace settings of', ws, '(exit', rs.status, '): pipelines, lost reasons and consent keywords are left out');
else core.settings = JSON.parse(ms[1]);
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
