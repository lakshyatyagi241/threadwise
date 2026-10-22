import { writeFileSync } from 'node:fs';
import { runFuzz, type Report, type Target } from './engine';
import { schemaTargets } from './targets/schemas';
import { netTargets } from './targets/net';
import { textTargets } from './targets/text';
import { signatureTargets } from './targets/signatures';
import { contractHelperTargets } from './targets/contract-helpers';

/** Inputs per profile. `ci` runs inside `pnpm test`; `full` is the scheduled run and must stay at or above the sheet's one million. */
export const PROFILES: Record<string, number> = { smoke: 2_000, ci: 20_000, full: 1_300_000 };

/** The seed of a run that was not given one. Printed on every run, so a failure can be replayed. */
export const freshSeed = (): number => Math.floor(Math.random() * 0xffffffff) >>> 0;

export function allTargets(): Target[] {
  return [
    ...schemaTargets(),
    ...netTargets(),
    ...textTargets(),
    ...signatureTargets(),
    ...contractHelperTargets(),
  ];
}

export interface ExecuteOptions {
  seed: number;
  profile: string;
  total?: number;
  only?: string;
  iter?: number;
  shard?: { index: number; of: number };
  budgetScale?: number;
  progressFile?: string;
  reportFile?: string;
  log?: (line: string) => void;
}

export async function execute(o: ExecuteOptions): Promise<Report> {
  const targets = allTargets();
  const total = o.total ?? PROFILES[o.profile];
  if (total === undefined) throw new Error(`unknown fuzz profile "${o.profile}"`);
  const report = await runFuzz({ ...o, targets, total });
  if (o.reportFile) writeFileSync(o.reportFile, JSON.stringify(report, null, 2));
  return report;
}
