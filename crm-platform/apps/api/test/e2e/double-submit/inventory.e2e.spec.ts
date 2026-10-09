import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from '../contacts-attributes-tags/support';
import { mutatingRoutes } from './routes';

/**
 * Which mutating routes accept an Idempotency-Key (QA task 16, with the rule from task 71).
 *
 * `non-idempotent-post-routes.json` is the list of POST routes that do NOT carry `@Idempotent()` today (many are safe by their own
 * rules: a state change that refuses a second call, a unique name, a read written as a POST). It is a ratchet:
 *  - a NEW POST route without `@Idempotent()` fails here until it is decorated or added to the list on purpose;
 *  - a route that gained `@Idempotent()` (or was removed) fails here until it is taken off the list, so the list only shrinks.
 * Regenerate with `QA_UPDATE=1 pnpm --filter @crm/api exec vitest run test/e2e/double-submit/inventory.e2e.spec.ts`.
 */
const BASELINE = resolve(__dirname, 'non-idempotent-post-routes.json');

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
}, 240_000);
afterAll(async () => {
  await h?.stop();
});

describe('which mutating routes accept an Idempotency-Key', () => {
  it('no new POST route is added without @Idempotent(), and the list of those that lack it only shrinks', async () => {
    const routes = await mutatingRoutes(h.app);
    const posts = routes.filter((r) => r.method === 'POST');
    const lacking = posts.filter((r) => !r.idempotent).map((r) => r.route);
    console.log(
      `INVENTORY mutating=${routes.length} post=${posts.length} idempotent=${routes.filter((r) => r.idempotent).length} postIdempotent=${posts.filter((r) => r.idempotent).length} postLacking=${lacking.length}`,
    );
    if (process.env.QA_OUT) writeFileSync(process.env.QA_OUT, JSON.stringify(routes, null, 1));
    if (process.env.QA_UPDATE) {
      writeFileSync(BASELINE, JSON.stringify(lacking, null, 1) + '\n');
      return;
    }
    const known = new Set<string>(JSON.parse(readFileSync(BASELINE, 'utf8')) as string[]);
    const added = lacking.filter((r) => !known.has(r));
    const fixed = [...known].filter((r) => !lacking.includes(r));
    expect(added, 'POST routes without @Idempotent() that are not on the list').toEqual([]);
    expect(
      fixed,
      'routes on the list that now have @Idempotent() or no longer exist: remove them from the list',
    ).toEqual([]);
  });
});
