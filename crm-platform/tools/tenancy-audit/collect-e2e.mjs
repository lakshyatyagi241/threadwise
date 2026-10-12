#!/usr/bin/env node
// Runs the e2e specs that are evidence for the tenancy controls and stores one vitest JSON report per spec in
// reports/tenancy-audit/e2e/<name>.json, which run.mjs reads. Needs Docker (every spec boots the app on Postgres + Redis).
//
//   node tools/tenancy-audit/collect-e2e.mjs               # everything below
//   node tools/tenancy-audit/collect-e2e.mjs faq flows     # only these names
//
// A spec that fails or cannot boot is still recorded: its report says so and run.mjs marks the controls FAILED / BLOCKED.
// The module suites run with -t so only their isolation tests execute; the audit's own specs run whole.
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out = join(root, 'reports/tenancy-audit/e2e');
mkdirSync(out, { recursive: true });

const ISOLATION = 'isolation|cross-tenant|another workspace|other workspace';

/** name -> [spec path under its app, -t filter or null for the whole spec, app directory (default apps/api)] */
const SPECS = {
  'tenancy-regressions': ['test/e2e/tenancy/tenancy-regressions.e2e.spec.ts', null],
  'tenancy-concurrency': ['test/e2e/tenancy/tenancy-concurrency.e2e.spec.ts', null],
  'waba-connect': ['test/e2e/whatsapp-cloud-api-waba/waba-connect.e2e.spec.ts', null],
  'ai-training': ['test/e2e/ai-agents-training/ai-training.e2e.spec.ts', ISOLATION],
  faq: ['test/e2e/faq-knowledge/faq.e2e.spec.ts', ISOLATION],
  'widget-public': ['test/e2e/chatbot-widget/widget-public.e2e.spec.ts', ISOLATION],
  'widgets-admin': ['test/e2e/chatbot-widget/widgets-admin.e2e.spec.ts', ISOLATION],
  'broadcast-wizard': ['test/e2e/campaigns/broadcast-wizard.e2e.spec.ts', ISOLATION],
  channels: ['test/e2e/chat-conversations/channels.e2e.spec.ts', ISOLATION],
  'message-send': ['test/e2e/chat-conversations/message-send.e2e.spec.ts', ISOLATION],
  'contact-groups': ['test/e2e/contacts-attributes-tags/contact-groups.e2e.spec.ts', ISOLATION],
  'catalog-products': ['test/e2e/catalog-products/catalog-products.e2e.spec.ts', ISOLATION],
  'api-library': ['test/e2e/api-library/api-library.e2e.spec.ts', ISOLATION],
  // Whole spec: its isolation tests depend on earlier tests having started the HTTP listener, so a -t filter breaks them.
  flows: ['test/e2e/flow-builder-editor/flows.e2e.spec.ts', null],
  invoicing: ['test/e2e/invoicing/invoicing.e2e.spec.ts', ISOLATION],
  'team-chat': ['test/e2e/team-chat/team-chat.e2e.spec.ts', ISOLATION],
  'forms-admin': ['test/e2e/forms-builder/forms-admin.e2e.spec.ts', ISOLATION],
  'ai-keys': ['test/e2e/ai-keys-usage-admin/ai-keys.e2e.spec.ts', ISOLATION],
  impersonation: ['test/e2e/workspaces-teams-tenancy/impersonation.e2e.spec.ts', null],
  // Fast unit specs (no Docker): the fixes of this audit and the web proxy that carries the credential to the API.
  // Redis-backed integration specs (need REDIS_URL): rate-limit scoping per caller and the fail-open behaviour when Redis is down.
  'rate-limiter': ['test/integration/platform-infrastructure/rate-limiter.spec.ts', null],
  'throttle-http': ['test/integration/platform-infrastructure/throttle.http.spec.ts', null],
  'web-proxy': ['src/lib/auth/proxy.tenancy.test.ts', null, 'apps/web'],
  'catalog-bridge': ['test/unit/node-bridge-runtime/catalog-bridge.spec.ts', null],
  'api-key-throttle': ['test/unit/public-api/api-key-auth-throttle.spec.ts', null],
  'scheduled-receipts': [
    'test/unit/scheduled-queue-warmer/scheduled-receipts-tenant.spec.ts',
    null,
  ],
};

const want = process.argv.slice(2);
const names = want.length ? want : Object.keys(SPECS);
let failed = 0;
for (const name of names) {
  const spec = SPECS[name];
  if (!spec) {
    console.error(`unknown spec name: ${name}`);
    process.exitCode = 2;
    continue;
  }
  const [file, filter, app = 'apps/api'] = spec;
  const cwd = join(root, app);
  console.log(`\n=== ${name}: ${file}${filter ? `  -t "${filter}"` : ''}`);
  const args = [
    join(cwd, 'node_modules/vitest/vitest.mjs'),
    'run',
    file,
    '--passWithNoTests',
    '--testTimeout=300000',
    '--reporter=json',
    `--outputFile=${join(out, `${name}.json`)}`,
    ...(filter ? ['-t', filter] : []),
  ];
  const r = spawnSync(process.execPath, args, { cwd, stdio: 'inherit', env: process.env });
  if (r.status !== 0) failed++;
}
console.log(`\n${names.length - failed}/${names.length} spec runs exited 0 (details in ${out})`);
// Never fail here: run.mjs turns each report into PASSED / FAILED / BLOCKED and decides the verdict.
