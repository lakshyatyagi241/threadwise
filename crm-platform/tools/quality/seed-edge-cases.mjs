#!/usr/bin/env node
// Creates a first catalogue file for every API module that does not have one yet
// (QA task 4). It never overwrites a file. Each seeded case comes from a real limit
// in the module's contract (a *_MAX / *_MIN constant), so it is a gap to test, not padding.
// Usage: node tools/quality/seed-edge-cases.mjs
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const modulesDir = join(root, 'apps/api/src/modules');
const contractsDir = join(root, 'packages/contracts/src');
const outDir = join(root, 'docs/quality/edge-cases');

/** Modules whose contracts live under another name. */
const CONTRACTS = {
  auth: ['auth-registration-security'],
  crm: ['contacts-attributes-tags', 'companies', 'deals-pipelines', 'tasks', 'segments'],
  broadcast: ['broadcasts'],
  'contacts-pql': ['contacts-attributes-tags'],
  inbox: ['team-inbox-conversations'],
  'whatsapp-provider-admin': ['whatsapp-providers'],
  'whatsapp-provider-registry': ['whatsapp-providers'],
  'public-api': ['developer-rest-api-v1'],
  'audit-log': ['notifications-activity-audit'],
  notifications: ['notifications-activity-audit'],
};

/** Modules where a mistake loses money, messages or data. They must end with no untested P0 case. */
const P0 = new Set([
  'auth',
  'identity',
  'roles-permissions',
  'workspaces-teams-tenancy',
  'wallet-message-billing',
  'plans-subscriptions-trials',
  'chat-conversations',
  'inbox',
  'team-inbox-conversations',
  'crm',
  'contact-consent',
  'broadcasts',
  'broadcast',
  'campaigns',
  'flow-builder-editor',
  'flow-runtime-engine',
  'whatsapp-cloud-api-waba',
]);
const P1 = new Set([
  'billing',
  'bsp-billing-engine',
  'coupons-credits-referral-currency',
  'message-templates',
  'outbound-webhooks',
  'webhook-fanout',
  'developer-rest-api-v1',
  'public-api',
  'privacy',
  'audit-log',
  'notifications',
  'forms-builder',
  'leads',
  'lead-scoring',
  'checkout-orders-merchant-payments',
  'platform-payment-gateways',
  'channel-email',
  'channel-sms',
  'channel-telegram',
  'channel-facebook',
  'channel-instagram',
  'whatsapp-devices-baileys',
  'team-inbox-routing-sla',
  'contacts-pql',
  'appointments-booking',
  'catalog-products',
  'node-bridge-runtime',
]);

const words = (s) => s.replace(/_/g, ' ').toLowerCase();
function limitsOf(dirs) {
  const out = [];
  for (const d of dirs) {
    const p = join(contractsDir, d);
    if (!existsSync(p) || !statSync(p).isDirectory()) continue;
    for (const f of readdirSync(p)
      .filter((n) => n.endsWith('.ts') && !n.endsWith('.test.ts'))
      .sort()) {
      const text = readFileSync(join(p, f), 'utf8');
      for (const m of text.matchAll(
        /^export const ([A-Z][A-Z0-9_]*_(MAX|MIN)(?:_[A-Z]+)?)\s*=\s*([0-9_]+)\s*;/gm,
      )) {
        out.push({
          name: m[1],
          kind: m[2],
          value: m[3].replace(/_/g, ''),
          file: `packages/contracts/src/${d}/${f}`,
        });
      }
    }
  }
  return out;
}

let made = 0;
for (const mod of readdirSync(modulesDir)
  .filter((n) => statSync(join(modulesDir, n)).isDirectory())
  .sort()) {
  const file = join(outDir, `${mod}.json`);
  if (existsSync(file)) continue;
  const tier = P0.has(mod) ? 'P0' : P1.has(mod) ? 'P1' : 'P2';
  const seen = new Set();
  const cases = [];
  for (const l of limitsOf(CONTRACTS[mod] ?? [mod])) {
    if (seen.has(l.name) || cases.length >= 8) continue;
    seen.add(l.name);
    const over = l.kind === 'MAX';
    const n = String(cases.length + 1).padStart(3, '0');
    cases.push({
      id: `EC-${mod}-${n}`,
      feature: words(l.name.replace(/_(MAX|MIN)(_.*)?$/, '')),
      category: 'input',
      scenario: over
        ? `a value of ${Number(l.value) + 1} (one past ${l.name} = ${l.value}) is sent`
        : `a value of ${Math.max(Number(l.value) - 1, 0)} (one under ${l.name} = ${l.value}) is sent`,
      expected: 'refused with a 422 validation error, nothing is stored',
      priority: tier === 'P0' ? 'P1' : 'P2',
      status: 'gap',
      source: l.file,
    });
  }
  writeFileSync(file, JSON.stringify({ module: mod, tier, cases }, null, 2) + '\n');
  made++;
}
console.log(`seeded ${made} catalogue file(s)`);
