import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, startHarness, type Harness } from '../contacts-attributes-tags/support';
import { STEPS, type Ctx, type Role } from './steps';

/**
 * End-to-end journeys (QA task 9). The runs come from docs/quality/journeys/journeys.json, expanded by
 * tools/quality/journeys.mjs (the same code `node tools/quality/journeys.mjs` counts with), so the number that is
 * printed is the number that runs. Every run is a fresh workspace and walks the journey's steps in order.
 *
 *   JOURNEY_FILTER=regex   only runs whose id matches, e.g. 'J-002' or 'role=reader-own'
 *   JOURNEY_PRIORITY=P0    only journeys of that priority (the PR run uses P0, the nightly run all)
 */
const ROOT = resolve(__dirname, '../../../../..');
const catalogue = JSON.parse(
  readFileSync(resolve(ROOT, 'docs/quality/journeys/journeys.json'), 'utf8'),
) as {
  journeys: Array<{ id: string; title: string; steps: string[] }>;
};
const fixtures = JSON.parse(
  readFileSync(resolve(ROOT, 'tools/quality/unicode-fixtures.json'), 'utf8'),
) as { valid: Array<{ id: string; text: string }> };
const textOf = (id: string) => fixtures.valid.find((s) => s.id === id)?.text ?? id;

interface Run {
  id: string;
  journey: string;
  priority: string;
  variant: { role?: Role; text?: string };
}

let h: Harness;
let api: Api;
let runs: Run[] = [];
let done = 0;

beforeAll(async () => {
  // Plain JavaScript, loaded by path so the type checker needs no declaration for it.
  const mod = (await import(/* @vite-ignore */ resolve(ROOT, 'tools/quality/journeys.mjs'))) as {
    expand: (c: unknown, f: unknown) => Run[];
  };
  const filter = process.env.JOURNEY_FILTER ? new RegExp(process.env.JOURNEY_FILTER) : null;
  const priority = process.env.JOURNEY_PRIORITY;
  runs = mod
    .expand(catalogue, fixtures)
    .filter((r) => (!filter || filter.test(r.id)) && (!priority || r.priority === priority));
  h = await startHarness();
  api = new Api(h);
}, 240_000);

afterAll(async () => {
  console.log(`JOURNEYS runs=${runs.length} completed=${done}`);
  await h?.stop();
});

describe.each(catalogue.journeys)('$id $title', (journey) => {
  it('runs every variant to the end', async () => {
    const mine = runs.filter((r) => r.journey === journey.id);
    const failures: string[] = [];
    for (const run of mine) {
      const ctx: Ctx = {
        api,
        role: run.variant.role ?? 'admin',
        text: textOf(run.variant.text ?? 'emoji-plain'),
      };
      try {
        for (const step of journey.steps) await STEPS[step]!(ctx);
        done += 1;
      } catch (e) {
        failures.push(`${run.id}: ${(e as Error).message.split('\n')[0]}`);
      }
    }
    // One test per journey keeps the report readable; the message names every failing run.
    expect(failures, `${failures.length} of ${mine.length} runs failed`).toEqual([]);
  }, 1_800_000);
});
