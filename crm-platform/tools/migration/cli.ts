#!/usr/bin/env tsx
/**
 * Waboo -> crm-platform migration tool.
 *
 *   coverage  --client <c> | --all           collections vs the registry (MIGRATED / EXCLUDED / GAP / UNKNOWN ...)
 *   manifest  --client <c> | --all           write dumps/<c>/manifest.json (doc count + sha256 per collection)
 *   init                                     create the `migration` schema (owner connection, idempotent)
 *   run       --client <c> [--org-name N] [--org-slug S] [--org-plan P] [--owner-email E] [--owner-name N]
 *             [--dry-run] [--batch N] [--force] [--skip-hash] [--default-cc 91]
 *             [--allow-target-host H[,H]] [--allow-docker-host N[,N]] [--confirm-db-name=<exact db name>]
 *             [--owner-verified] [--trial-days N] [--lock-wait-seconds N]
 *             [--allow-no-owner]   (load users into an organization with no Owner; refused by default)
 *             [--channel-map FILE] [--keep-deleted-contact-chats] [--thread-status waboo|closed] [--no-assign-agents] [--window-hours 24]
 *                                  (chat history = inbox; the channel map is required when the dump has chathistory)
 *             [--failed-send-attempts 3] [--keep-test-broadcasts] [--nonterminal-status cancelled|failed]
 *                                  (broadcast campaigns + recipient logs; see README "Stage 2: broadcasts")
 *             [--credit-opening FILE] [--no-wallet] [--credit-workspace-id ID]
 *                                  (credits: the CONFIRMED opening balance file is required for the wallet part; see README "Stage 2: credits")
 *   pricing-seed --client <c> [--compare-with <c2>] [--factor DEC] [--apply] [--skip-conflicts]
 *                                  operator command, DRY RUN by default: what credits_mapping_new would write to the GLOBAL message_rates
 *   update    --client <c> --org-slug <s> [--steps contacts,tags,...] [--default-cc 91] [--batch N] [--skip-hash] [--apply --confirm-org-slug <s>]
 *                                  UPDATE MODE, DRY RUN by default: rows already migrated are brought in line with the current dump (changed columns only; see README "Update mode")
 *   kb-reingest --client <c> --org-slug <s> [--apply --confirm-org-slug <s>]
 *   cutover --client <c> --org-slug <s> [--rollback] [--check-meta] [--apply --confirm-org-slug <s> --i-switched-waboo-off --confirm-cutover "CUT OVER <s>"]
 *                                  OPERATOR step, NEVER part of run/migrate, DRY RUN by default: connects the migrated WhatsApp number (see README "WhatsApp cutover")
 *   chat-reparse --client <c> --org-slug <s> [--apply --confirm-org-slug <s>]   (re-read the saved bot payloads of messages loaded with an empty body)
 *   chat-relink  --client <c> --org-slug <s> [--channel-map FILE] [--apply --confirm-org-slug <s>]   (contact_id of loaded conversations that have none, by the planner's rule)
 *   chat-status  --client <c> --org-slug <s> [--channel-map FILE] [--apply --confirm-org-slug <s>]   (closes loaded conversations that Waboo has closed: the status of the newest visitor_logs session)
 *   usage-charges-append --client <c> --org-slug <s> [--skip-hash] [--apply --confirm-org-slug <s>]  (credits catch-up: ONLY the billing-log charges and token rows not yet in id_map; never the ledger or the wallet; DRY RUN by default)
 *   campaign-link --client <c> --org-slug <s> [--apply --confirm-org-slug <s>]  (set wpcampaigns.template_id on campaigns loaded before the templates; exact matches only, DRY RUN by default)
 *                                  OPERATOR step, DRY RUN by default: migrated knowledge-base url entries -> processing + ai_training_source.requested (the app worker then makes outbound requests)
 *   steps                          READ-ONLY: every step name in load order with what it needs (for run --steps / --skip-steps)
 *   automation-profile --client <c> | --all
 *                                  READ-ONLY: the distinct (type, class, function, shapeId) of the advanced automation nodes with counts (names only)
 *             [--steps a,b,fields] [--skip-steps c]   (run only / all but these steps; the organization is always ensured; a step whose
 *                                  prerequisite is neither selected nor already loaded is refused before anything is written)
 *             [--flow-version published|draft|newest] [--widgets-for-whatsapp-bots]
 *                                  (simple flows -> chatbot flows and widgets; see README "Stage 2: flows and chatbot widgets")
 *   permission-catalogue --client <c> | --all [--out dir]
 *                                  lists the Waboo permissions access/permission-map.json does not map yet (names only, read-only)
 *   reconcile --client <c> | --all [--out dir] [--seed N] [--skip-hash] [--allow-extra-rows] [--default-cc 91]
 *                                  [--allow-target-host H[,H]] [--channel-map FILE] (+ the inbox and broadcast flags the run used)
 *
 * Env: SOURCE_DUMPS_DIR (default ./dumps), TARGET_DATABASE_URL (worker login), MIGRATION_DATABASE_URL (owner: init + org creation).
 * Only localhost / 127.0.0.1 / docker-internal hosts are accepted without --allow-target-host; a real write to any other host also
 * needs --confirm-db-name.
 */
import { resolve } from 'node:path';
import { loadAccessConfig } from './access/config';
import { BroadcastConfigError, type BroadcastOptions } from './broadcast/config';
import { CreditsConfigError, type CreditOptions } from './credits/config';
import { FlowsConfigError, type FlowOptions, type FlowVersionPolicy } from './flows/config';
import { automationProfile, formatAutomationProfile } from './extract/automation-profile';
import { PricingError, pricingSeed } from './pricing/seed';
import { createInterface } from 'node:readline';
import { InboxConfigError, type InboxOptions } from './inbox/config';
import { permissionCatalogue, writeCatalogue } from './extract/catalogue';
import { coverage, formatCoverage } from './extract/coverage';
import { writeManifest } from './extract/manifest';
import { NdjsonDirSource } from './extract/source';
import { assertTargetAllowed, connect, ensureSchema } from './load/db';
import { coreLoad } from './load/core';
import { flowState } from './load/flowstate';
import { walletSync } from './load/walletsync';
import { usageChargesAppend } from './load/usageappend';
import { kbReingest } from './load/kbreingest';
import { cutover } from './load/cutover';
import { updateRows } from './load/update';
import { chatReparse } from './load/chatreparse';
import { chatRelink } from './load/chatrelink';
import { chatStatus } from './load/chatstatus';
import { campaignLink } from './load/campaignlink';
import { runClient, RunLockedError } from './load/run';
import { formatSteps, StepsError } from './load/steps';
import { sanitizeError } from './util';
import { reconcile, toMarkdown } from './reconcile';

function parse(argv: string[]): { cmd: string; flags: Map<string, string | true> } {
  const [cmd = 'help', ...rest] = argv;
  const flags = new Map<string, string | true>();
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq > 0) {
      flags.set(a.slice(2, eq), a.slice(eq + 1));
      continue;
    }
    const next = rest[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags.set(a.slice(2), next);
      i++;
    } else flags.set(a.slice(2), true);
  }
  return { cmd, flags };
}

const inboxOf = (flags: Map<string, string | true>): InboxOptions => ({
  channelMapPath: flags.get('channel-map') ? String(flags.get('channel-map')) : undefined,
  keepDeletedContactChats: flags.has('keep-deleted-contact-chats') ? true : undefined,
  threadStatus: flags.get('thread-status')
    ? (String(flags.get('thread-status')) as 'waboo' | 'closed')
    : undefined,
  assignAgents: flags.has('no-assign-agents') ? false : undefined,
  windowHours: flags.get('window-hours') ? Number(flags.get('window-hours')) : undefined,
});

const broadcastOf = (flags: Map<string, string | true>): BroadcastOptions => ({
  failedSendAttempts: flags.get('failed-send-attempts')
    ? Number(flags.get('failed-send-attempts'))
    : undefined,
  keepTestBroadcasts: flags.has('keep-test-broadcasts') ? true : undefined,
  nonTerminalStatus: flags.get('nonterminal-status')
    ? (String(flags.get('nonterminal-status')) as 'cancelled' | 'failed')
    : undefined,
});

const creditsOf = (flags: Map<string, string | true>): CreditOptions => ({
  openingPath: flags.get('credit-opening') ? String(flags.get('credit-opening')) : undefined,
  noWallet: flags.has('no-wallet') ? true : undefined,
  workspaceId: flags.get('credit-workspace-id')
    ? String(flags.get('credit-workspace-id'))
    : undefined,
});

const flowsOf = (flags: Map<string, string | true>): FlowOptions => ({
  flowVersion: flags.get('flow-version')
    ? (String(flags.get('flow-version')) as FlowVersionPolicy)
    : undefined,
  widgetsForWhatsappBots: flags.has('widgets-for-whatsapp-bots') ? true : undefined,
});

const listOf = (flags: Map<string, string | true>, name: string): string[] | undefined => {
  const v = flags.get(name);
  return typeof v === 'string'
    ? v
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
    : undefined;
};

const need = (name: string): string => {
  const v = process.env[name];
  if (!v) {
    console.error(`${name} is not set`);
    process.exit(2);
  }
  return v;
};

async function main(): Promise<number> {
  const { cmd, flags } = parse(process.argv.slice(2));
  const dumpsDir = resolve(process.env.SOURCE_DUMPS_DIR ?? resolve(__dirname, 'dumps'));
  const source = new NdjsonDirSource(dumpsDir);
  const clients = flags.has('all')
    ? source.clients()
    : flags.get('client')
      ? [String(flags.get('client'))]
      : [];
  const outDir = resolve(String(flags.get('out') ?? resolve(__dirname, 'out')));

  const allowHosts = flags.get('allow-target-host')
    ? String(flags.get('allow-target-host'))
        .split(',')
        .map((h) => h.trim())
    : [];
  const confirmDbName = flags.get('confirm-db-name') ? String(flags.get('confirm-db-name')) : null;
  const allowDockerHosts = flags.get('allow-docker-host')
    ? String(flags.get('allow-docker-host'))
        .split(',')
        .map((h) => h.trim())
    : [];
  const guard = { allowHosts, allowDockerHosts, confirmDbName };

  switch (cmd) {
    case 'init': {
      console.log(
        assertTargetAllowed(need('MIGRATION_DATABASE_URL'), 'owner ', { ...guard, dryRun: false }),
      );
      const owner = connect(need('MIGRATION_DATABASE_URL'), 'owner');
      try {
        await ensureSchema(owner.db);
        console.log('migration schema ready (id_map, quarantine, run_log)');
      } finally {
        await owner.close();
      }
      return 0;
    }
    case 'manifest': {
      for (const c of clients) {
        const m = await writeManifest(source, dumpsDir, c);
        console.log(
          `${c}: ${m.collections.length} collections, ${m.collections.reduce((a, x) => a + x.docs, 0)} documents -> manifest.json`,
        );
      }
      return clients.length ? 0 : usage();
    }
    case 'coverage': {
      let code = 0;
      for (const c of clients) {
        const rows = await coverage(source, dumpsDir, c);
        console.log(formatCoverage(c, rows));
        if (rows.some((r) => r.status === 'UNKNOWN')) code = 1;
      }
      return clients.length ? code : usage();
    }
    case 'run': {
      if (clients.length !== 1) return usage();
      const s = await runClient({
        source,
        dumpsDir,
        client: clients[0]!,
        targetUrl: need('TARGET_DATABASE_URL'),
        ownerUrl: process.env.MIGRATION_DATABASE_URL,
        dryRun: flags.has('dry-run'),
        batchSize: flags.get('batch') ? Number(flags.get('batch')) : undefined,
        force: flags.has('force'),
        defaultCountryCode: flags.get('default-cc') ? String(flags.get('default-cc')) : null,
        skipHash: flags.has('skip-hash'),
        allowNoOwner: flags.has('allow-no-owner'),
        inbox: inboxOf(flags),
        broadcast: broadcastOf(flags),
        credits: creditsOf(flags),
        flows: flowsOf(flags),
        steps: listOf(flags, 'steps'),
        skipSteps: listOf(flags, 'skip-steps'),
        lockWaitSeconds: flags.get('lock-wait-seconds')
          ? Number(flags.get('lock-wait-seconds'))
          : undefined,
        guard,
        org: {
          name: flags.get('org-name') ? String(flags.get('org-name')) : undefined,
          slug: flags.get('org-slug') ? String(flags.get('org-slug')) : undefined,
          plan: flags.get('org-plan') ? String(flags.get('org-plan')) : null,
          ownerEmail: flags.get('owner-email') ? String(flags.get('owner-email')) : null,
          ownerName: flags.get('owner-name') ? String(flags.get('owner-name')) : null,
          ownerVerified: flags.has('owner-verified'),
          trialDays: flags.get('trial-days') ? Number(flags.get('trial-days')) : null,
        },
      });
      console.log(`done: org ${s.orgId}${s.dryRun ? ' (dry run, rolled back)' : ''}`);
      for (const w of s.warnings) console.log(`WARNING: ${w}`);
      return 0;
    }
    case 'pricing-seed': {
      if (clients.length !== 1) return usage();
      await pricingSeed({
        source,
        dumpsDir,
        client: clients[0]!,
        compareWith: flags.get('compare-with') ? String(flags.get('compare-with')) : undefined,
        factor: flags.get('factor') ? String(flags.get('factor')) : undefined,
        apply: flags.has('apply'),
        skipConflicts: flags.has('skip-conflicts'),
        withMargin: flags.has('with-margin'),
        ownerUrl: process.env.MIGRATION_DATABASE_URL,
        readUrl: process.env.TARGET_DATABASE_URL,
        guard,
        confirm: (phrase) =>
          new Promise<string>((res) => {
            const rl = createInterface({ input: process.stdin, output: process.stdout });
            rl.question(
              `Type exactly this to write to the GLOBAL message_rates table: ${phrase}
> `,
              (a) => {
                rl.close();
                res(a);
              },
            );
          }),
      });
      return 0;
    }
    case 'steps': {
      console.log(formatSteps());
      return 0;
    }
    case 'automation-profile': {
      if (clients.length === 0) return usage();
      for (const c of clients)
        console.log(formatAutomationProfile(await automationProfile(source, c)));
      return 0;
    }
    case 'core-load': {
      // geta_core facts (plan, subscription, business) and the role grants of the roles already loaded; DRY RUN unless --apply
      if (clients.length !== 1) return usage();
      const slug = flags.get('org-slug') ? String(flags.get('org-slug')) : '';
      if (!slug) return usage();
      const apply = flags.has('apply');
      if (apply && String(flags.get('confirm-org-slug') ?? '') !== slug) {
        console.error('core-load --apply needs --confirm-org-slug <the same org slug>');
        return 2;
      }
      console.log(
        assertTargetAllowed(need('TARGET_DATABASE_URL'), 'target', { ...guard, dryRun: !apply }),
      );
      console.log(
        assertTargetAllowed(need('MIGRATION_DATABASE_URL'), 'owner ', { ...guard, dryRun: !apply }),
      );
      await coreLoad({
        dumpsDir,
        client: clients[0]!,
        orgSlug: slug,
        targetUrl: need('TARGET_DATABASE_URL'),
        ownerUrl: need('MIGRATION_DATABASE_URL'),
        apply,
        log: (l) => console.log(l),
      });
      return 0;
    }
    case 'flow-state': {
      // publishes and activates the flows that are live in Waboo (see load/flowstate.ts); DRY RUN unless --apply
      if (clients.length !== 1) return usage();
      const slug = flags.get('org-slug') ? String(flags.get('org-slug')) : '';
      if (!slug) return usage();
      const apply = flags.has('apply');
      if (apply && String(flags.get('confirm-org-slug') ?? '') !== slug) {
        console.error('flow-state --apply needs --confirm-org-slug <the same org slug>');
        return 2;
      }
      console.log(
        assertTargetAllowed(need('TARGET_DATABASE_URL'), 'target', { ...guard, dryRun: !apply }),
      );
      console.log(
        assertTargetAllowed(need('MIGRATION_DATABASE_URL'), 'owner ', { ...guard, dryRun: !apply }),
      );
      await flowState({
        dumpsDir,
        client: clients[0]!,
        orgSlug: slug,
        targetUrl: need('TARGET_DATABASE_URL'),
        ownerUrl: need('MIGRATION_DATABASE_URL'),
        apply,
        log: (l) => console.log(l),
      });
      return 0;
    }
    case 'wallet-sync': {
      // brings the wallet to the current Waboo balance with one new ledger row (see load/walletsync.ts); DRY RUN unless --apply
      if (clients.length !== 1) return usage();
      const slug = flags.get('org-slug') ? String(flags.get('org-slug')) : '';
      if (!slug) return usage();
      const apply = flags.has('apply');
      if (apply && String(flags.get('confirm-org-slug') ?? '') !== slug) {
        console.error('wallet-sync --apply needs --confirm-org-slug <the same org slug>');
        return 2;
      }
      console.log(
        assertTargetAllowed(need('TARGET_DATABASE_URL'), 'target', { ...guard, dryRun: !apply }),
      );
      console.log(
        assertTargetAllowed(need('MIGRATION_DATABASE_URL'), 'owner ', { ...guard, dryRun: !apply }),
      );
      await walletSync({
        dumpsDir,
        client: clients[0]!,
        orgSlug: slug,
        targetUrl: need('TARGET_DATABASE_URL'),
        ownerUrl: need('MIGRATION_DATABASE_URL'),
        apply,
        log: (l) => console.log(l),
      });
      return 0;
    }
    case 'usage-charges-append': {
      // loads only the usage charges / token rows of documents not yet in id_map; the ledger and the wallet are never touched (see load/usageappend.ts); DRY RUN unless --apply
      if (clients.length !== 1) return usage();
      const slug = flags.get('org-slug') ? String(flags.get('org-slug')) : '';
      if (!slug) return usage();
      const apply = flags.has('apply');
      if (apply && String(flags.get('confirm-org-slug') ?? '') !== slug) {
        console.error('usage-charges-append --apply needs --confirm-org-slug <the same org slug>');
        return 2;
      }
      console.log(
        assertTargetAllowed(need('TARGET_DATABASE_URL'), 'target', { ...guard, dryRun: !apply }),
      );
      console.log(
        assertTargetAllowed(need('MIGRATION_DATABASE_URL'), 'owner ', { ...guard, dryRun: !apply }),
      );
      await usageChargesAppend({
        dumpsDir,
        client: clients[0]!,
        orgSlug: slug,
        targetUrl: need('TARGET_DATABASE_URL'),
        ownerUrl: need('MIGRATION_DATABASE_URL'),
        apply,
        skipHash: flags.has('skip-hash'),
        batch: flags.get('batch') ? Number(flags.get('batch')) : undefined,
        lockWaitSeconds: flags.get('lock-wait-seconds')
          ? Number(flags.get('lock-wait-seconds'))
          : undefined,
        log: (l) => console.log(l),
      });
      return 0;
    }
    case 'cutover': {
      // OPERATOR step, never part of `run`: connects the migrated WhatsApp number to WaDesk (see load/cutover.ts). DRY RUN unless --apply / --rollback --apply
      if (clients.length !== 1) return usage();
      const slug = flags.get('org-slug') ? String(flags.get('org-slug')) : '';
      if (!slug) return usage();
      const str = (n: string): string | undefined => (typeof flags.get(n) === 'string' ? String(flags.get(n)) : undefined);
      const apply = flags.has('apply');
      const back = flags.has('rollback');
      const mode = back ? (apply ? 'rollback' : 'rollback-dry') : apply ? 'apply' : 'dry';
      const writes = mode === 'apply' || mode === 'rollback';
      console.log(
        assertTargetAllowed(need('TARGET_DATABASE_URL'), 'target', { ...guard, dryRun: !writes }),
      );
      console.log(
        assertTargetAllowed(need('MIGRATION_DATABASE_URL'), 'owner ', { ...guard, dryRun: !writes }),
      );
      const epoch = Number(str('backup-epoch'));
      const code = await cutover({
        dumpsDir,
        client: clients[0]!,
        orgSlug: slug,
        targetUrl: need('TARGET_DATABASE_URL'),
        ownerUrl: need('MIGRATION_DATABASE_URL'),
        mode,
        confirmOrgSlug: str('confirm-org-slug'),
        confirmCutover: str('confirm-cutover'),
        wabooOff: flags.has('i-switched-waboo-off'),
        checkMeta: flags.has('check-meta'),
        replaceOverride: flags.has('replace-existing-override'),
        webhookBase: str('webhook-base'),
        reconcilePath: resolve(outDir, clients[0]!, 'reconcile.md'),
        maxReportAgeHours: Number(str('max-report-age-hours') ?? 48),
        backup: str('backup-file') && Number.isFinite(epoch) && epoch > 0 ? { name: str('backup-file')!, atMs: epoch * 1000 } : null,
        log: (l) => console.log(l),
      });
      return code;
    }
    case 'kb-reingest': {
      // OPERATOR step: resets the migrated knowledge-base url entries to processing and emits ai_training_source.requested, so the app
      // worker fetches the pages (OUTBOUND requests to the client's site). Never part of `run`. DRY RUN unless --apply.
      if (clients.length !== 1) return usage();
      const slug = flags.get('org-slug') ? String(flags.get('org-slug')) : '';
      if (!slug) return usage();
      const apply = flags.has('apply');
      if (apply && String(flags.get('confirm-org-slug') ?? '') !== slug) {
        console.error('kb-reingest --apply needs --confirm-org-slug <the same org slug>');
        return 2;
      }
      console.log(
        assertTargetAllowed(need('TARGET_DATABASE_URL'), 'target', { ...guard, dryRun: !apply }),
      );
      console.log(
        assertTargetAllowed(need('MIGRATION_DATABASE_URL'), 'owner ', { ...guard, dryRun: !apply }),
      );
      await kbReingest({
        client: clients[0]!,
        orgSlug: slug,
        targetUrl: need('TARGET_DATABASE_URL'),
        ownerUrl: need('MIGRATION_DATABASE_URL'),
        apply,
        log: (l) => console.log(l),
      });
      return 0;
    }
    case 'update': {
      // update mode: rows already in id_map are compared with the current dump, changed columns only (see load/update.ts); DRY RUN unless --apply
      if (clients.length !== 1) return usage();
      const slug = flags.get('org-slug') ? String(flags.get('org-slug')) : '';
      if (!slug) return usage();
      const apply = flags.has('apply');
      if (apply && String(flags.get('confirm-org-slug') ?? '') !== slug) {
        console.error('update --apply needs --confirm-org-slug <the same org slug>');
        return 2;
      }
      console.log(
        assertTargetAllowed(need('TARGET_DATABASE_URL'), 'target', { ...guard, dryRun: !apply }),
      );
      console.log(
        assertTargetAllowed(need('MIGRATION_DATABASE_URL'), 'owner ', { ...guard, dryRun: !apply }),
      );
      await updateRows({
        dumpsDir,
        client: clients[0]!,
        orgSlug: slug,
        targetUrl: need('TARGET_DATABASE_URL'),
        ownerUrl: need('MIGRATION_DATABASE_URL'),
        apply,
        defaultCountryCode: flags.get('default-cc') ? String(flags.get('default-cc')) : null,
        steps: listOf(flags, 'steps'),
        batch: flags.get('batch') ? Number(flags.get('batch')) : undefined,
        skipHash: flags.has('skip-hash'),
        lockWaitSeconds: flags.get('lock-wait-seconds')
          ? Number(flags.get('lock-wait-seconds'))
          : undefined,
        log: (l) => console.log(l),
      });
      return 0;
    }
    case 'chat-reparse': {
      // re-reads meta.legacy.response of the migrated bot messages stored with an empty body (see load/chatreparse.ts); DRY RUN unless --apply
      if (clients.length !== 1) return usage();
      const slug = flags.get('org-slug') ? String(flags.get('org-slug')) : '';
      if (!slug) return usage();
      const apply = flags.has('apply');
      if (apply && String(flags.get('confirm-org-slug') ?? '') !== slug) {
        console.error('chat-reparse --apply needs --confirm-org-slug <the same org slug>');
        return 2;
      }
      console.log(
        assertTargetAllowed(need('TARGET_DATABASE_URL'), 'target', { ...guard, dryRun: !apply }),
      );
      console.log(
        assertTargetAllowed(need('MIGRATION_DATABASE_URL'), 'owner ', { ...guard, dryRun: !apply }),
      );
      await chatReparse({
        client: clients[0]!,
        orgSlug: slug,
        targetUrl: need('TARGET_DATABASE_URL'),
        ownerUrl: need('MIGRATION_DATABASE_URL'),
        apply,
        log: (l) => console.log(l),
      });
      return 0;
    }
    case 'chat-relink': {
      // contact_id of the conversations an earlier load wrote with NULL (see load/chatrelink.ts); DRY RUN unless --apply
      if (clients.length !== 1) return usage();
      const slug = flags.get('org-slug') ? String(flags.get('org-slug')) : '';
      if (!slug) return usage();
      const apply = flags.has('apply');
      if (apply && String(flags.get('confirm-org-slug') ?? '') !== slug) {
        console.error('chat-relink --apply needs --confirm-org-slug <the same org slug>');
        return 2;
      }
      console.log(
        assertTargetAllowed(need('TARGET_DATABASE_URL'), 'target', { ...guard, dryRun: !apply }),
      );
      console.log(
        assertTargetAllowed(need('MIGRATION_DATABASE_URL'), 'owner ', { ...guard, dryRun: !apply }),
      );
      await chatRelink({
        client: clients[0]!,
        orgSlug: slug,
        targetUrl: need('TARGET_DATABASE_URL'),
        ownerUrl: need('MIGRATION_DATABASE_URL'),
        source,
        dumpsDir,
        inbox: inboxOf(flags),
        apply,
        log: (l) => console.log(l),
      });
      return 0;
    }
    case 'chat-status': {
      // status of the conversations an earlier load wrote open that Waboo has closed (see load/chatstatus.ts); DRY RUN unless --apply
      if (clients.length !== 1) return usage();
      const slug = flags.get('org-slug') ? String(flags.get('org-slug')) : '';
      if (!slug) return usage();
      const apply = flags.has('apply');
      if (apply && String(flags.get('confirm-org-slug') ?? '') !== slug) {
        console.error('chat-status --apply needs --confirm-org-slug <the same org slug>');
        return 2;
      }
      console.log(
        assertTargetAllowed(need('TARGET_DATABASE_URL'), 'target', { ...guard, dryRun: !apply }),
      );
      console.log(
        assertTargetAllowed(need('MIGRATION_DATABASE_URL'), 'owner ', { ...guard, dryRun: !apply }),
      );
      await chatStatus({
        client: clients[0]!,
        orgSlug: slug,
        targetUrl: need('TARGET_DATABASE_URL'),
        ownerUrl: need('MIGRATION_DATABASE_URL'),
        source,
        dumpsDir,
        inbox: inboxOf(flags),
        apply,
        log: (l) => console.log(l),
      });
      return 0;
    }
    case 'campaign-link': {
      // template_id of the campaigns an earlier load wrote with NULL (see load/campaignlink.ts); DRY RUN unless --apply
      if (clients.length !== 1) return usage();
      const slug = flags.get('org-slug') ? String(flags.get('org-slug')) : '';
      if (!slug) return usage();
      const apply = flags.has('apply');
      if (apply && String(flags.get('confirm-org-slug') ?? '') !== slug) {
        console.error('campaign-link --apply needs --confirm-org-slug <the same org slug>');
        return 2;
      }
      console.log(
        assertTargetAllowed(need('TARGET_DATABASE_URL'), 'target', { ...guard, dryRun: !apply }),
      );
      console.log(
        assertTargetAllowed(need('MIGRATION_DATABASE_URL'), 'owner ', { ...guard, dryRun: !apply }),
      );
      await campaignLink({
        client: clients[0]!,
        orgSlug: slug,
        targetUrl: need('TARGET_DATABASE_URL'),
        ownerUrl: need('MIGRATION_DATABASE_URL'),
        source,
        apply,
        log: (l) => console.log(l),
      });
      return 0;
    }
    case 'permission-catalogue': {
      if (clients.length === 0) return usage();
      const cfg = loadAccessConfig();
      for (const c of clients) {
        const rows = await permissionCatalogue(source, c, cfg);
        const todo = rows.filter((r) => r.status !== 'mapped').length;
        console.log(
          `${c}: ${rows.length} Waboo permissions, ${todo} unmapped (grant nothing) -> ${writeCatalogue(c, rows, outDir)}`,
        );
      }
      return 0;
    }
    case 'reconcile': {
      let code = 0;
      console.log(
        assertTargetAllowed(need('TARGET_DATABASE_URL'), 'target', { ...guard, dryRun: true }),
      );
      for (const c of clients) {
        const r = await reconcile({
          source,
          dumpsDir,
          client: c,
          targetUrl: need('TARGET_DATABASE_URL'),
          outDir,
          seed: flags.get('seed') ? Number(flags.get('seed')) : 1,
          sampleSize: flags.get('sample') ? Number(flags.get('sample')) : 200,
          skipHash: flags.has('skip-hash'),
          allowExtraRows: flags.has('allow-extra-rows'),
          defaultCountryCode: flags.get('default-cc') ? String(flags.get('default-cc')) : null,
          inbox: inboxOf(flags),
          broadcast: broadcastOf(flags),
          credits: creditsOf(flags),
          flows: flowsOf(flags),
        });
        console.log(toMarkdown(r).split('\n').slice(0, 40).join('\n'));
        console.log(
          `\nreport: ${resolve(outDir, c, 'reconcile.md')}  result: ${r.ok ? 'PASS' : 'FAIL'}`,
        );
        if (!r.ok) code = 1;
      }
      return clients.length ? code : usage();
    }
    default:
      return usage();
  }
}

function usage(): number {
  console.error(
    'usage: cli.ts <coverage|manifest|init|run|permission-catalogue|reconcile> --client <name> | --all  (see the header of cli.ts)',
  );
  return 2;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    // never the raw driver text: it carries bound parameters (other contacts' emails and phones)
    console.error(sanitizeError(err));
    process.exit(
      err instanceof RunLockedError
        ? 3
        : err instanceof PricingError
          ? 5
          : err instanceof InboxConfigError ||
              err instanceof BroadcastConfigError ||
              err instanceof CreditsConfigError ||
              err instanceof FlowsConfigError ||
              err instanceof StepsError
            ? 4
            : 1,
    );
  },
);
