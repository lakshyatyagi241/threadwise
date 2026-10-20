import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, startHarness, type Harness } from '../contacts-attributes-tags/support';
import { ROUNDS, race } from './support';

/**
 * QA Sheet3 #15, CC-LIM-07: a contact import and API creates running at the same time on a workspace near its contact cap. However they
 * interleave, the workspace never holds more contacts than the plan allows.
 */
let h: Harness;
let api: Api;
beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
}, 240_000);
afterAll(async () => {
  await h?.stop();
});

const csv = (tag: string, n: number) =>
  'name,country_code,mobile,email\n' +
  Array.from(
    { length: n },
    (_, i) => `${tag}${i},91,98${tag.length}${String(10000000 + i * 7)},${tag}${i}@example.com`,
  ).join('\n') +
  '\n';

describe('CC-LIM-07 import and API creates at the contact cap', () => {
  it('two imports of 10 rows and 8 API creates at once on a cap of 6 contacts: never more than 6 contacts', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const t = await api.signup('imp');
      await h.owner.query(
        `UPDATE org_plan_state SET overrides = '{"limits":{"contacts":6}}'::jsonb WHERE org_id = $1`,
        [t.orgId],
      );
      const res = await race(10, (i) =>
        i < 2
          ? api
              .as(t.admin)
              .post('/v2/contacts/import')
              .attach('file', Buffer.from(csv(`imp${round}x${i}`, 10)), 'p.csv')
          : api
              .as(t.admin)
              .post('/v2/contacts')
              .send({ name: `Api ${round} ${i}`, email: `api${round}-${i}@example.com` }),
      );
      for (const r of res) expect(r.status, JSON.stringify(r.body)).toBeLessThan(500);
      const n = Number(
        (
          await h.owner.query(`SELECT count(*)::int AS n FROM contacts WHERE org_id = $1`, [
            t.orgId,
          ])
        ).rows[0].n,
      );
      expect(n, `round ${round}`).toBeLessThanOrEqual(6);
      expect(n).toBeGreaterThan(0);
    }
  });
});
