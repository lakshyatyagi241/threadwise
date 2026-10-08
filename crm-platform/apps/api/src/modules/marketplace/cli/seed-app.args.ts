import { marketMoneyIsPositive, normaliseMarketMoney } from '@crm/contracts';
import type { SeedAppConfig } from './seed-app.config';

/**
 * Argument parsing and safety guards of the Marketplace seed commands (`seed:appointments`, `seed:forms`). Pure (no I/O, no Nest), so the rules that keep a local-development
 * tool away from a real database are unit tested on their own.
 */

export interface SeedAppOptions {
  /** Monthly price in major units, normalised ("499" -> "499.00"). */
  price: string;
  /** Upper-case ISO code. */
  currency: string;
  /** Print what would change, write nothing. */
  dryRun: boolean;
  /** Replace an operator-set price, and enable the add-on on plans an operator left out. */
  force: boolean;
  /** Comp just this workspace (by slug) instead of the default (the workspaces already using the feature, or nobody). */
  workspace: string | null;
  /** Dev convenience: comp every workspace. Needs `yes` for a real run. */
  allWorkspaces: boolean;
  /** Confirms `allWorkspaces`. */
  yes: boolean;
}

export type ParsedArgs =
  | { kind: 'help' }
  | { kind: 'options'; options: SeedAppOptions }
  | { kind: 'error'; message: string };

export function usage(config: SeedAppConfig): string {
  const defaultComp = config.grandfatherExisting
    ? `comp just this workspace instead of every workspace already using ${config.usageNoun}`
    : 'comp just this workspace (it gets a comped subscription, so the menu appears)';
  const doing = config.grandfatherExisting
    ? `sets the price, creates the add-on that sells it, comps the workspaces already using ${config.usageNoun}, and publishes the listing.`
    : 'sets the price, creates the add-on that sells it, publishes the listing and shows it on every active plan. Nobody used it before it existed, so nobody is comped unless you pick workspaces below.';
  return `usage: pnpm --filter @crm/api build && pnpm --filter @crm/api ${config.command} [-- options]

Makes the ${config.label} Marketplace app visible and sellable on a LOCAL development database, doing what the platform operator does in
the console: ${doing}

options
  --price <amount>      monthly price in major units (default ${config.defaultPrice})
  --currency <code>     three-letter currency code, enabled on the platform (default ${config.defaultCurrency})
  --workspace <slug>    ${defaultComp}
  --all-workspaces      comp EVERY workspace (development only; lists them, and needs --yes)
  --yes                 confirm --all-workspaces
  --dry-run             show what would change, write nothing
  --force               replace a price an operator already set, and enable the add-on on plans left out
  --help                this text

Refuses to run with NODE_ENV=production or when the database is not on this machine. Safe to run again: it never overwrites what an
operator set unless you pass --force.`;
}

const FLAGS_WITH_VALUE = new Set(['price', 'currency', 'workspace']);
const FLAGS_BOOLEAN = new Set(['dry-run', 'force', 'help', 'all-workspaces', 'yes']);

/** `--name value` and `--name=value`; anything else is an error naming it. `argv` is what follows the script path. */
export function parseArgs(argv: readonly string[], config: SeedAppConfig): ParsedArgs {
  const values = new Map<string, string>();
  const bools = new Set<string>();
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i]!;
    // pnpm passes the `--` separator through to the script on some versions.
    if (raw === '--') continue;
    if (!raw.startsWith('--')) return { kind: 'error', message: `unexpected argument "${raw}"` };
    const eq = raw.indexOf('=');
    const name = eq === -1 ? raw.slice(2) : raw.slice(2, eq);
    if (FLAGS_BOOLEAN.has(name)) {
      if (eq !== -1) return { kind: 'error', message: `--${name} takes no value` };
      bools.add(name);
    } else if (FLAGS_WITH_VALUE.has(name)) {
      const value = eq === -1 ? argv[(i += 1)] : raw.slice(eq + 1);
      if (value === undefined || value === '' || value.startsWith('--'))
        return { kind: 'error', message: `--${name} needs a value` };
      values.set(name, value);
    } else {
      return { kind: 'error', message: `unknown option --${name}` };
    }
  }
  if (bools.has('help')) return { kind: 'help' };

  const priceRaw = (values.get('price') ?? config.defaultPrice).trim();
  if (!marketMoneyIsPositive(priceRaw))
    return {
      kind: 'error',
      message: `--price must be a number above zero with at most two decimals (got "${priceRaw}")`,
    };
  const currency = (values.get('currency') ?? config.defaultCurrency).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency))
    return {
      kind: 'error',
      message: `--currency must be a three-letter code (got "${values.get('currency')}")`,
    };
  const workspace = values.get('workspace')?.trim() ?? null;
  if (workspace !== null && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(workspace))
    return { kind: 'error', message: `--workspace must be a workspace slug (got "${workspace}")` };
  const allWorkspaces = bools.has('all-workspaces');
  if (allWorkspaces && workspace !== null)
    return { kind: 'error', message: '--all-workspaces and --workspace cannot be combined' };
  if (bools.has('yes') && !allWorkspaces)
    return { kind: 'error', message: '--yes only confirms --all-workspaces' };
  // A dry run writes nothing, so it may list the workspaces without the confirmation; a real run may not.
  if (allWorkspaces && !bools.has('yes') && !bools.has('dry-run'))
    return {
      kind: 'error',
      message:
        '--all-workspaces comps every workspace on this database: add --yes to confirm (or --dry-run to only list them)',
    };

  return {
    kind: 'options',
    options: {
      price: normaliseMarketMoney(priceRaw),
      currency,
      dryRun: bools.has('dry-run'),
      force: bools.has('force'),
      workspace,
      allWorkspaces,
      yes: bools.has('yes'),
    },
  };
}

// --- guards -------------------------------------------------------------------------------------------------------------------------

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1', 'host.docker.internal']);

/** Local means this machine: loopback, Docker's name for the host, or a `.local` name. Anything else is somebody else's database. */
export function isLocalHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return LOCAL_HOSTS.has(h) || h.endsWith('.local');
}

/** The host(s) a connection string connects to, or null when it cannot be read (then it is not trusted). */
export function hostsOfDatabaseUrl(url: string): string[] | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') return null;
  // libpq lets `?host=` / `?hostaddr=` override the authority, so the effective target is the override.
  const override = [u.searchParams.get('host'), u.searchParams.get('hostaddr')].filter(
    (v): v is string => v !== null && v !== '',
  );
  if (override.length > 0) return override.flatMap((v) => v.split(','));
  // `postgres:///db` (no host) means the local socket.
  return u.hostname === '' ? ['localhost'] : [u.hostname];
}

export type GuardResult = { ok: true; databaseUrl: string } | { ok: false; reason: string };

/**
 * Whether the command may run at all: never in production, and only when every database URL the application would use points at this
 * machine. `DATABASE_URL` is what the application connects with; `MIGRATION_DATABASE_URL`, when set, is checked too.
 */
export function checkGuards(env: NodeJS.ProcessEnv): GuardResult {
  if (env.NODE_ENV === 'production')
    return {
      ok: false,
      reason: 'refusing to run with NODE_ENV=production (local development only)',
    };
  const url = env.DATABASE_URL;
  if (!url) return { ok: false, reason: 'DATABASE_URL is not set' };
  for (const [name, value] of [
    ['DATABASE_URL', url],
    ['MIGRATION_DATABASE_URL', env.MIGRATION_DATABASE_URL],
  ] as const) {
    if (!value) continue;
    const hosts = hostsOfDatabaseUrl(value);
    if (!hosts || hosts.length === 0)
      return {
        ok: false,
        reason: `${name} is not a readable postgres URL, so it cannot be shown to be local`,
      };
    const remote = hosts.find((h) => !isLocalHost(h));
    if (remote)
      return {
        ok: false,
        reason: `refusing to run: ${name} points at "${remote}", which is not this machine (allowed: localhost, 127.0.0.1, host.docker.internal, *.local)`,
      };
  }
  return { ok: true, databaseUrl: url };
}
