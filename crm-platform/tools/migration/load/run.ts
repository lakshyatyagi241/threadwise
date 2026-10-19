import { randomUUID } from 'node:crypto';
import { loadAccessConfig, type AccessConfig } from '../access/config';
import { coverage } from '../extract/coverage';
import { readManifest, verifyDump } from '../extract/manifest';
import type { Source } from '../extract/source';
import { STEPS } from '../transform';
import { buildIndex } from '../transform/source-index';
import {
  assertTargetAllowed,
  connect,
  schemaReady,
  sql,
  type Database,
  type GuardOptions,
} from './db';
import { IdMap, runStep, writeQuarantine, type Counts, type Env } from './engine';
import { recordQuarantineDigest } from './baseline';
import { ensureOrg, ORG_COLLECTION, type OrgInputs } from './org';
import { bumpRolesVersion, prepareAccess, seatWarning } from './access';
import { resolveInbox, type InboxOptions, type InboxSettings } from '../inbox/config';
import { installInboxLoader } from './inbox';
import { installBroadcastLoader } from './broadcast';
import { installFlowsLoader } from './flows';
import { resolveFlows, type FlowOptions } from '../flows/config';
import { installCreditsLoader, finishCredits, recordCreditOptions } from './credits';
import { resolveCredits, type CreditOptions } from '../credits/config';
import { buildCreditsPlan, describePlan } from '../credits/plan';
import { resolveBroadcast, type BroadcastOptions } from '../broadcast/config';
import {
  missingPrerequisites,
  recordSelection,
  selectSteps,
  StepsError,
  stepsLoaded,
} from './steps';

installInboxLoader();
installBroadcastLoader();
installCreditsLoader();
installFlowsLoader();

export interface RunOptions {
  source: Source;
  dumpsDir: string;
  client: string;
  /** crm_worker_user login: every tenant write and read goes through it. */
  targetUrl: string;
  /** Owner login. Used only to create the organization (and by `init`). Defaults to targetUrl. */
  ownerUrl?: string;
  /** The organization to create or reuse. Defaults to the client key for name and slug. */
  org?: Partial<OrgInputs>;
  dryRun?: boolean;
  batchSize?: number;
  force?: boolean;
  /** Do not compare the dump's sha256 with manifest.json before loading (never for a real run). */
  skipHash?: boolean;
  /** How long to wait for another run of the SAME client to finish before giving up with a clear message (default 120). */
  lockWaitSeconds?: number;
  /** A lock holder silent for longer than this (seconds, default 15) is considered dead and its session is terminated. */
  lockStaleSeconds?: number;
  defaultCountryCode?: string | null;
  /** The reviewed permission map and role map (default: the checked-in files in access/). A bad map stops the run before anything is written. */
  access?: AccessConfig;
  /** The channel map and flags of the inbox step (chathistory): required when the dump has chat history. */
  inbox?: InboxOptions;
  /** The switches of the broadcast step (campaigns + recipient logs); the defaults are the recommended ones, see the README. */
  broadcast?: BroadcastOptions;
  /** The credits step: the confirmed opening balance file, --no-wallet, --credit-workspace-id (see README "Stage 2: credits"). */
  credits?: CreditOptions;
  /** The switches of the flows and widgets steps (--flow-version, --widgets-for-whatsapp-bots); the defaults are the recommended ones, see the README. */
  flows?: FlowOptions;
  /** Run only these steps (names or groups, see the `steps` command); the organization is always ensured first. */
  steps?: string[];
  /** Run every step except these. */
  skipSteps?: string[];
  /** Load users into an organization that has no Owner (nobody could administer it). Refused by default. */
  allowNoOwner?: boolean;
  guard?: Pick<GuardOptions, 'allowHosts' | 'confirmDbName'>;
  afterBatch?: Env['afterBatch'];
  midBatch?: Env['midBatch'];
  log?: (line: string) => void;
}

export interface RunSummary {
  client: string;
  orgId: number;
  dryRun: boolean;
  steps: Record<string, Counts>;
  warnings: string[];
}

class DryRunRollback extends Error {}

/** Another run (real or dry) of the same client holds the lock for longer than we are willing to wait. */
export class RunLockedError extends Error {
  constructor(client: string, seconds: number) {
    super(
      `another run is active for client ${client}: waited ${seconds}s for it to finish (pass --lock-wait-seconds to wait longer)`,
    );
  }
}

export type LockConn = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

const HEARTBEAT_MS = 2000;
const APP = 'waboo-migration';

/**
 * The lock holder proves it is alive by renaming its session every 2 s (`waboo-migration:<client>:<epoch seconds>`, visible in
 * pg_stat_activity, nothing is written to a table). After a SIGKILL the dead backend can linger on the server (Docker port proxies keep
 * the socket open); a waiter that sees a holder of the SAME role, with our application name for THIS client, idle, and silent for longer
 * than `staleSeconds` terminates that backend and takes the lock. Anything else (another role, another program) is never touched.
 */
export function startHeartbeat(conn: LockConn, client: string): () => void {
  const beat = (): void => {
    void conn
      .query("SELECT set_config('application_name', $1, false)", [
        `${APP}:${client}:${Math.floor(Date.now() / 1000)}`,
      ])
      .catch(() => undefined);
  };
  beat();
  const t = setInterval(beat, HEARTBEAT_MS);
  t.unref();
  return () => clearInterval(t);
}

async function reapStaleHolder(
  conn: LockConn,
  client: string,
  staleSeconds: number,
  log: (l: string) => void,
): Promise<boolean> {
  const h = await conn.query(
    `SELECT a.pid, a.application_name AS app, a.state, (a.usename = current_user) AS mine
     FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
     WHERE l.locktype = 'advisory' AND l.granted AND l.objsubid = 1
       AND ((l.classid::bigint << 32) | l.objid::bigint) = hashtext($1)::bigint AND a.pid <> pg_backend_pid()`,
    [`migration:run:${client}`],
  );
  for (const row of h.rows) {
    const m = new RegExp('^' + APP + ':(.+):(\\d+)$').exec(String(row.app));
    if (!m || m[1] !== client || row.mine !== true || row.state !== 'idle') continue;
    if (Date.now() / 1000 - Number(m[2]) <= staleSeconds) continue;
    await conn.query('SELECT pg_terminate_backend($1)', [row.pid]);
    log(
      `a previous run of client ${client} died without releasing its lock (silent for more than ${staleSeconds}s): its session was terminated`,
    );
    return true;
  }
  return false;
}

export async function acquireRunLock(
  conn: LockConn,
  client: string,
  waitSeconds: number,
  staleSeconds: number,
  log: (l: string) => void,
): Promise<void> {
  const deadline = Date.now() + waitSeconds * 1000;
  let told = false;
  for (;;) {
    const r = await conn.query('SELECT pg_try_advisory_lock(hashtext($1)) AS ok', [
      `migration:run:${client}`,
    ]);
    if (r.rows[0]?.ok) return;
    if (await reapStaleHolder(conn, client, staleSeconds, log)) continue;
    if (Date.now() >= deadline) throw new RunLockedError(client, waitSeconds);
    if (!told) {
      log(
        `another run is active for client ${client}: waiting up to ${waitSeconds}s for it to finish`,
      );
      told = true;
    }
    await new Promise((res) => setTimeout(res, 500));
  }
}

export async function runClient(opts: RunOptions): Promise<RunSummary> {
  const log = opts.log ?? ((l: string) => console.log(l));
  const { source, client } = opts;

  // production guard: say where we are about to write, and refuse anything that does not look like a scratch database
  const guard = { ...opts.guard, dryRun: opts.dryRun };
  log(assertTargetAllowed(opts.targetUrl, 'target', guard));
  if (opts.ownerUrl && opts.ownerUrl !== opts.targetUrl)
    log(assertTargetAllowed(opts.ownerUrl, 'owner ', guard));

  // the registry gate: an unlisted collection is an alarm, not something to skip
  const unknown = (await coverage(source, opts.dumpsDir, client)).filter(
    (r) => r.status === 'UNKNOWN',
  );
  if (unknown.length > 0) {
    throw new Error(
      `${client}: collections not in the registry: ${unknown.map((u) => u.collection).join(', ')}. Add them to registry/index.ts first.`,
    );
  }
  // the reviewed maps: validated up front, so a map that asks for the Owner role (or lacks its approver) writes nothing
  const accessConfig = opts.access ?? loadAccessConfig();
  // the dump is what the manifest says it is
  const manifest = readManifest(opts.dumpsDir, client);
  if (!manifest)
    throw new Error(
      `${client}: NO_MANIFEST: run \`manifest --client ${client}\` first so the dump is fixed`,
    );
  if (!opts.skipHash) {
    const problems = await verifyDump(source, opts.dumpsDir, client);
    if (problems.length > 0)
      throw new Error(
        `${client}: the dump does not match manifest.json (use --skip-hash only if you mean it):\n  ${problems.join('\n  ')}`,
      );
  }

  // the steps to run: an unknown name stops the run before anything is written
  const sel = selectSteps(opts.steps, opts.skipSteps);
  const chosen = new Set(sel.selected);
  const creditStep = ['credit_wallet', 'credit_tokens', 'usage_charges'].some((h) => chosen.has(h));

  // a bad broadcast switch stops the run before anything is written
  const bcastSettings = resolveBroadcast(opts.broadcast);
  const flowSettings = resolveFlows(opts.flows);

  // credits: the confirmed opening balance is REQUIRED for the wallet part, and the plan (pass 1, from the dump alone) can refuse too
  const creditDocs = manifest.collections.find((c) => c.collection === 'credit_logs')?.docs ?? 0;
  const creditSettings = creditStep
    ? resolveCredits(opts.credits, opts.dumpsDir, client, creditDocs)
    : undefined;
  const creditsPlan = creditSettings
    ? await buildCreditsPlan({
        source,
        client,
        settings: creditSettings,
        referenceAt: manifest.generatedAt,
      })
    : undefined;
  if (creditSettings && creditsPlan && (creditDocs > 0 || creditSettings.opening))
    log(`credits: ${describePlan(creditsPlan)}`);

  // chat history needs the operator's channel map: refuse BEFORE anything is written (dry runs included)
  let inboxSettings: InboxSettings | undefined;
  const chatDocs = manifest.collections.find((c) => c.collection === 'chathistory')?.docs ?? 0;
  if (chatDocs > 0 && chosen.has('inbox'))
    inboxSettings = resolveInbox(opts.inbox, opts.dumpsDir, client);

  const target = connect(opts.targetUrl, 'target');
  const owner =
    opts.ownerUrl && opts.ownerUrl !== opts.targetUrl ? connect(opts.ownerUrl, 'owner') : null;
  // one run per client at a time: a second run waits here, then finds everything done
  const lockConn = await target.pool.connect();
  let stopBeat: () => void = () => undefined;
  try {
    await acquireRunLock(
      lockConn as LockConn,
      client,
      opts.lockWaitSeconds ?? 120,
      opts.lockStaleSeconds ?? 15,
      log,
    );
    stopBeat = startHeartbeat(lockConn as LockConn, client);
    if (!(await schemaReady(target.db)))
      throw new Error(
        'migration schema is missing: run `init` once as the owner (MIGRATION_DATABASE_URL) first',
      );
    // a selected step whose prerequisite is neither selected nor loaded is refused BEFORE the organization is written
    const missing = missingPrerequisites({
      selected: sel.selected,
      loaded: await stepsLoaded(target.db, client),
      source,
      client,
    });
    if (missing.length > 0) throw new StepsError(missing.join('; '));
    log(`${opts.dryRun ? 'DRY RUN ' : ''}${client}: indexing source`);
    const fallbackAt = manifest.generatedAt;
    const idx = await buildIndex(source, client, fallbackAt);
    const steps: Record<string, Counts> = {};
    const org: OrgInputs = {
      name: opts.org?.name || client,
      slug: opts.org?.slug || client,
      plan: opts.org?.plan ?? null,
      ownerEmail: opts.org?.ownerEmail ?? null,
      ownerName: opts.org?.ownerName ?? null,
      trialDays: opts.org?.trialDays ?? null,
      ownerVerified: opts.org?.ownerVerified ?? false,
      timezone: opts.org?.timezone ?? null,
    };

    const body = async (db: Database, ownerDb: Database): Promise<RunSummary> => {
      const idmap = new IdMap();
      const made = await ensureOrg({
        client,
        db,
        ownerDb,
        idmap,
        org,
        dryRun: Boolean(opts.dryRun),
        log,
      });
      for (const w of made.warnings) log(`  WARNING: ${w}`);
      await idmap.load(db, client);
      const hasUsers = source.collections(client).includes('user');
      const noOwner = made.warnings.some((w) => w.startsWith('THE ORGANIZATION HAS NO OWNER'));
      if (hasUsers && noOwner && !opts.allowNoOwner)
        throw new Error(
          `${client}: the organization has no Owner and the dump has users: re-run with --owner-email (or --allow-no-owner if nobody needs to administer it)`,
        );
      const ownerEmail =
        org.ownerEmail?.trim().toLowerCase() ??
        (
          (
            await db.execute(
              sql`SELECT counts->>'ownerEmail' AS e FROM migration.run_log WHERE source_client = ${client} AND collection = ${ORG_COLLECTION} AND step = 'org'`,
            )
          ).rows[0] as { e: string | null } | undefined
        )?.e ??
        null;
      const prepared = await prepareAccess({
        source,
        client,
        db,
        orgId: made.orgId,
        config: accessConfig,
        ownerEmail,
      });
      for (const n of prepared.notes) {
        log(`  access             ${n}`);
        if (n.startsWith('PLAN GAP')) made.warnings.push(n);
      }
      const env: Env = {
        access: prepared.access,
        inbox: inboxSettings,
        bcastSettings,
        flowSettings,
        creditSettings,
        credits: creditsPlan,
        ownerDb,
        ownerEmail,
        source,
        client,
        dumpsDir: opts.dumpsDir,
        db,
        orgId: made.orgId,
        idmap,
        idx,
        batchSize: opts.batchSize ?? 1000,
        defaultCountryCode: opts.defaultCountryCode ?? null,
        fallbackAt,
        pkCache: new Map(),
        force: Boolean(opts.force),
        runId: randomUUID(),
        afterBatch: opts.afterBatch,
        midBatch: opts.midBatch,
        log,
      };
      if (creditsPlan) await recordCreditOptions(env, creditsPlan);
      await recordSelection(db, client, env.runId, sel);
      for (const spec of STEPS)
        if (chosen.has(spec.handler)) steps[`${spec.handler}`] = await runStep(env, spec);
        else log(`  ${spec.handler.padEnd(18)} not selected`);
      const fin = chosen.has('credit_wallet') ? await finishCredits(env) : { wallet: null };
      if (fin.wallet !== null && creditSettings)
        log(
          `  credits            wallet ${creditSettings.opening!.currency} balance ${fin.wallet} (= the sum of its ledger)`,
        );

      // RBAC caches grants per organization under roles_version: bump it once when roles, grants or assignments were written
      const touched = (steps.roles?.migrated ?? 0) + (steps.users?.migrated ?? 0) > 0;
      const bump = await bumpRolesVersion({
        client,
        orgId: made.orgId,
        ownerDb,
        touched,
        inserted: (steps.roles?.inserted ?? 0) + (steps.users?.inserted ?? 0) > 0,
      });
      if (bump.bumped)
        log(`  access             roles_version ${bump.before} -> ${bump.after} (RBAC cache key)`);
      const seats = await seatWarning(db, made.orgId);
      if (seats) {
        log(`  WARNING: ${seats}`);
        made.warnings.push(seats);
      }

      // lines that could not be parsed (a truncated last line, say) are quarantined, never dropped; the run then fails loudly
      const bad = source.badLines(client);
      await writeQuarantine(
        db,
        client,
        bad.map((b) => ({
          collection: b.collection,
          source_key: `line:${b.line}`,
          reason_code: 'PARSE_ERROR',
          reason: `${b.file.split(/[\\/]/).pop()} line ${b.line}: ${b.error}`,
          doc: { bytes: b.bytes },
        })),
      );
      // the state of the quarantine table as this run leaves it; reconcile notices any later change
      await recordQuarantineDigest(db, client, ORG_COLLECTION);
      return {
        client,
        orgId: made.orgId,
        dryRun: Boolean(opts.dryRun),
        steps,
        warnings: made.warnings,
      };
    };

    let summary: RunSummary | null = null;
    if (!opts.dryRun) {
      summary = await body(target.db, (owner ?? target).db);
    } else {
      // dry run: everything inside ONE outer transaction (withTenant becomes savepoints), rolled back at the end
      try {
        await target.db.transaction(async (outer) => {
          summary = await body(outer as unknown as Database, outer as unknown as Database);
          throw new DryRunRollback();
        });
      } catch (e) {
        if (!(e instanceof DryRunRollback)) throw e;
      }
      log(formatPlan(summary!));
    }
    const bad = source.badLines(client);
    if (bad.length > 0) {
      throw new Error(
        `${client}: ${bad.length} line(s) could not be parsed and were quarantined as PARSE_ERROR (the rest was loaded): ` +
          bad
            .slice(0, 5)
            .map((b) => `${b.file.split(/[\\/]/).pop()} line ${b.line}: ${b.error}`)
            .join('; '),
      );
    }
    return summary!;
  } finally {
    stopBeat();
    await lockConn.query('SELECT pg_advisory_unlock_all()').catch(() => undefined);
    lockConn.release();
    await target.close();
    await owner?.close();
  }
}

export function formatPlan(s: RunSummary): string {
  const lines = [
    `DRY RUN plan for ${s.client} (rolled back; nothing was written)`,
    'step                 read  migrated  quarantined  excluded  soft-issues',
  ];
  for (const [step, c] of Object.entries(s.steps)) {
    lines.push(
      `${step.padEnd(18)} ${String(c.read).padStart(6)} ${String(c.migrated).padStart(9)} ${String(c.quarantined).padStart(12)} ${String(c.excluded).padStart(9)} ${String(c.softIssues).padStart(12)}`,
    );
  }
  return lines.join('\n');
}
