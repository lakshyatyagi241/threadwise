import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  WMIG_BATCH_STATUSES,
  WMIG_MODES,
  WMIG_READINESS_REASONS,
  WMIG_STATUSES,
  WMIG_STEP_NAMES,
  WMIG_STEP_STATUSES,
  WMIG_VERDICTS,
} from '@crm/contracts';

type Node = string | { [k: string]: Node };
const json = JSON.parse(
  readFileSync(join(process.cwd(), 'messages', 'en', 'waboo-migration.json'), 'utf8'),
) as { 'waboo-migration': Record<string, Record<string, Node>> };
const en = json['waboo-migration'];

/** Every `t('key')` / `t('a.b')` used by a namespace, resolved against the JSON. */
function lookup(ns: string, key: string): Node | undefined {
  let cur: Node | undefined = ns
    .split('.')
    .slice(1)
    .reduce<Node | undefined>(
      (n, p) => (typeof n === 'object' ? n[p] : undefined),
      en as unknown as Node,
    );
  for (const p of key.split('.')) cur = typeof cur === 'object' ? cur[p] : undefined;
  return cur;
}

describe('waboo-migration messages', () => {
  it('labels every mode, status, batch status, step, step status and verdict the API can return', () => {
    for (const m of WMIG_MODES) expect(en.mode![m], m).toBeTruthy();
    for (const s of WMIG_STATUSES) expect(en.status![s], s).toBeTruthy();
    for (const s of WMIG_BATCH_STATUSES) expect(en.batchStatus![s], s).toBeTruthy();
    for (const s of WMIG_STEP_NAMES) expect(en.step![s], s).toBeTruthy();
    for (const s of WMIG_STEP_STATUSES) expect(en.stepStatus![s], s).toBeTruthy();
    for (const v of WMIG_VERDICTS) {
      expect(en.verdict![v], v).toBeTruthy();
      expect((en.verdict!.short as Record<string, string>)[v], v).toBeTruthy();
    }
    for (const r of WMIG_READINESS_REASONS) expect(en.readiness![r], r).toBeTruthy();
  });

  it('has labels for the display-only statuses (scheduled, finished with errors, completed with alarms)', () => {
    for (const k of ['scheduled', 'completedRed', 'completedReview'])
      expect(en.status![k], k).toBeTruthy();
    // A red run must never read as plain "Completed".
    expect(en.status!.completedRed).not.toBe(en.status!.completed);
  });

  it('has a sentence for every error kind the page can show, one per stable WMIG code', () => {
    const errors = (en.common as { errors: Record<string, string> }).errors;
    for (const k of [
      'active',
      'dryRequired',
      'confirm',
      'notCancellable',
      'collision',
      'schedule',
      'forbidden',
      'validation',
      'notFound',
      'network',
      'request',
      'unexpected',
    ])
      expect(errors[k], k).toBeTruthy();
    expect(
      Object.keys(ERROR_CODES)
        .filter((c) => c.startsWith('WMIG_'))
        .sort(),
    ).toEqual([
      'WMIG_CLIENT_COLLISION',
      'WMIG_CONFIRM_MISMATCH',
      'WMIG_DRY_RUN_REQUIRED',
      'WMIG_NOT_CANCELLABLE',
      'WMIG_RUN_ACTIVE',
      'WMIG_SCHEDULE_INVALID',
    ]);
  });

  it('has the navigation labels and the schedule errors', () => {
    expect(en.nav!.group).toBeTruthy();
    expect(en.nav!.panel).toBeTruthy();
    for (const k of ['invalid', 'past', 'tooFar'])
      expect((en.schedule!.error as Record<string, string>)[k], k).toBeTruthy();
  });

  it('every message key used by the feature components exists', () => {
    const dir = join(process.cwd(), 'src', 'features', 'waboo-migration');
    const files = readdirSync(dir).filter((f) => f.endsWith('.tsx'));
    const missing: string[] = [];
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf8');
      const hooks = new Map<string, string>();
      for (const m of src.matchAll(/const (\w+) = useTranslations\(\s*(?:'([^']+)'|(\w+))\s*\)/g)) {
        const ns = m[2] ?? (m[3] === 'NS' ? (/const NS = '([^']+)'/.exec(src)?.[1] ?? '') : '');
        hooks.set(m[1]!, ns);
      }
      for (const [fn, ns] of hooks)
        for (const m of src.matchAll(new RegExp(`\\b${fn}\\('([A-Za-z0-9_.-]+)'`, 'g')))
          if (lookup(ns, m[1]!) === undefined) missing.push(`${f}: ${ns}.${m[1]}`);
    }
    expect(missing).toEqual([]);
  });
});
