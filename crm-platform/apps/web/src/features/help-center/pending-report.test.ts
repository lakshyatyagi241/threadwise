import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import { PLAN_FEATURE_KEYS } from '@crm/contracts';
import { HELP_DOCS } from '@/features/_registry/help.generated';
import { NAV } from '@/features/_registry/nav.generated';
import { SETTINGS } from '@/features/_registry/settings.generated';
import { coverage, type PendingEntry } from './coverage';
import { renderPending, type PendingRow } from './report';

const WEB = join(__dirname, '..', '..', '..');
const REPO = join(WEB, '..', '..');
const FEATURES = join(WEB, 'src', 'features');

/** The `features/<domain>` folder whose `nav.ts` or `settings.ts` declares the unit's id ("plan features" belong to the plans domain). */
function domainOf(unit: string): string {
  const [kind, id] = [unit.slice(0, unit.indexOf(':')), unit.slice(unit.indexOf(':') + 1)];
  if (kind === 'feature') return 'plans-subscriptions-trials';
  const file = kind === 'nav' ? 'nav.ts' : 'settings.ts';
  for (const domain of readdirSync(FEATURES)) {
    const path = join(FEATURES, domain, file);
    if (!existsSync(path)) continue;
    const ids = [...readFileSync(path, 'utf8').matchAll(/\bid:\s*['"]([^'"]+)['"]/g)].map(
      (m) => m[1],
    );
    if (ids.includes(id)) return domain;
  }
  return 'unknown';
}

/**
 * Writes `docs/help-pending.md` (gitignored): every built screen and plan feature with no guide and no pending entry, grouped by
 * owner. Run by `.claude/skills/help-docs-sync/scripts/pending.sh` (after every pull, and by the gate); it only reports and never
 * fails, so a pull is never blocked. A plain `pnpm test` skips it.
 */
it.runIf(process.env.HELP_WRITE_PENDING === '1')('writes docs/help-pending.md', () => {
  const pending = (
    JSON.parse(readFileSync(join(__dirname, 'pending.json'), 'utf8')) as { pending: PendingEntry[] }
  ).pending;
  const report = coverage({
    nav: NAV,
    tiles: SETTINGS,
    docs: HELP_DOCS,
    planFeatureKeys: PLAN_FEATURE_KEYS,
    pending,
  });

  const ownership = JSON.parse(
    readFileSync(join(REPO, 'docs', 'threadwise-port', 'ownership.json'), 'utf8'),
  ) as { domains: Record<string, { owner?: string }> };
  const rows: PendingRow[] = report.undocumented.map((unit) => {
    const domain = domainOf(unit);
    return { unit, domain, owner: ownership.domains[domain]?.owner ?? 'unowned' };
  });

  writeFileSync(
    join(REPO, 'docs', 'help-pending.md'),
    renderPending(rows, { stale: report.stalePending, bad: report.badPending }),
  );
});
