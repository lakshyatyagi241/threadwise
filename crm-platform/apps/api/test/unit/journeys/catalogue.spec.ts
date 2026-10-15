import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STEPS } from '../../e2e/journeys/steps';

/** The journey catalogue and its step implementations must agree (QA task 9). Runs in the unit suite: no database. */
const ROOT = resolve(__dirname, '../../../../..');
const catalogue = JSON.parse(
  readFileSync(resolve(ROOT, 'docs/quality/journeys/journeys.json'), 'utf8'),
) as {
  steps: Record<string, string>;
  journeys: Array<{ id: string; steps: string[]; priority: string }>;
};

describe('journey catalogue', () => {
  it('describes every implemented step, and implements every described step', () => {
    expect(Object.keys(STEPS).sort()).toEqual(Object.keys(catalogue.steps).sort());
  });
  it('uses only steps that are implemented', () => {
    const used = new Set(catalogue.journeys.flatMap((j) => j.steps));
    expect([...used].filter((s) => !(s in STEPS))).toEqual([]);
  });
  it('starts every journey by creating a workspace', () => {
    for (const j of catalogue.journeys) expect(j.steps[0], j.id).toBe('workspace.signup');
  });
  it('has P0 journeys', () => {
    expect(catalogue.journeys.filter((j) => j.priority === 'P0').length).toBeGreaterThan(0);
  });
});
