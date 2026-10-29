import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  workspacePricing,
  WorkspacePricingError,
  type WorkspacePricingOptions,
} from '../pricing/workspace-seed';
import { priceFromMargin } from '../pricing/workspace-margins';
import { asOwner, cloneDb, customDumps, type Dumps, type TestDb } from './helpers';
import { O } from './fixtures';

type J = Record<string, unknown>;
const cat = (price: number, margin: number): J => ({ price, margin });
const wa = (a: J, m: J, s: J, u: J): J => ({
  authentication: a,
  marketing: m,
  service: s,
  utility: u,
});
const country = (n: number, name: string, code: string | undefined, w: J): J => ({
  _id: O(n),
  name,
  ...(code ? { code } : {}),
  whatsapp: w,
});

/** INVENTED: two workspaces with the SAME Meta cost but their own price and markup. */
const wsA = (): J[] => [
  country(1, 'India', 'IN', wa(cat(0.115, 0), cat(0.7846, 0.2154), cat(0, 0), cat(0.115, 0.03))),
  country(2, 'Singapore', 'SG', wa(cat(1, 0), cat(5.366, 0.59), cat(0, 0), cat(1.173, 0.352))),
];
const wsB = (): J[] => [
  country(1, 'India', 'IN', wa(cat(0.115, 0), cat(0.7846, 0.9), cat(0, 0), cat(0.115, 0.5))),
  country(2, 'Singapore', 'SG', wa(cat(1, 0), cat(5.366, 2), cat(0, 0), cat(1.173, 1))),
];

let dumps: Dumps;
let db: TestDb;
beforeAll(async () => {
  dumps = await customDumps({
    wsa: { credits_mapping_new: wsA() },
    wsb: { credits_mapping_new: wsB() },
  });
  db = await cloneDb('pw-base');
  // Meta's cost as the application holds it (millionths of a unit), same for both workspaces
  await asOwner(db, async (d) => {
    await d.execute(sql`DELETE FROM message_rates`);
    await d.execute(sql`
      INSERT INTO message_rates (country_code, category, credits, meta_cost_micros) VALUES
      ('IN','marketing',100,784600), ('IN','utility',12,115000), ('IN','authentication',12,115000), ('IN','service',0,10000),
      ('SG','marketing',600,5366000), ('SG','utility',150,1173000), ('SG','authentication',100,1000000), ('SG','service',0,10000)`);
  });
  // the organizations the tool made for each client (what `run` leaves behind: slug + settings.legacy.waboo.client)
  await asOwner(db, async (d) => {
    for (const c of ['wsa', 'wsb'])
      await d.execute(sql`
        INSERT INTO organizations (name, slug, settings)
        VALUES (${c}, ${c}, ${JSON.stringify({ legacy: { waboo: { client: c } } })}::jsonb)`);
  });
}, 900_000);
afterAll(async () => {
  await db.drop();
  dumps.cleanup();
});

const run = (
  client: 'wsa' | 'wsb',
  o: Partial<WorkspacePricingOptions> = {},
  lines: string[] = [],
) =>
  workspacePricing({
    source: dumps.source,
    client,
    orgSlug: client,
    apply: false,
    verify: false,
    skipConflicts: false,
    ownerUrl: db.ownerUrl,
    log: (l) => lines.push(l),
    ...o,
  });
const stored = (slug: string) =>
  asOwner(
    db,
    async (d) =>
      (
        await d.execute(sql`
          SELECT m.country_code, m.category, m.margin_bps, m.set_by FROM workspace_message_margins m
          JOIN organizations o ON o.id = m.org_id WHERE o.slug = ${slug} ORDER BY 1, 2`)
      ).rows as Array<{
        country_code: string;
        category: string;
        margin_bps: number;
        set_by: string;
      }>,
  );

describe("pricing-workspace: the workspace's own price + markup -> workspace_message_margins", () => {
  it('dry run writes nothing and warns nothing is exact without a factor', async () => {
    const lines: string[] = [];
    const r = await run('wsa', {}, lines);
    expect(r.new).toHaveLength(8);
    expect(await stored('wsa')).toEqual([]);
    expect(lines.join('\n')).toMatch(/DRY RUN \(nothing is written\)/);
    expect(lines.join('\n')).toMatch(/ASSUMED 1/);
  });

  it('refuses to apply without a factor or without the typed phrase', async () => {
    await expect(run('wsa', { apply: true, confirm: async (p) => p })).rejects.toThrow(
      /explicit --factor/,
    );
    await expect(
      run('wsa', { apply: true, factor: '1', confirm: async () => 'yes' }),
    ).rejects.toThrow(/confirmation does not match/);
    expect(await stored('wsa')).toEqual([]);
  });

  it('refuses a workspace this tool did not make', async () => {
    await expect(run('wsa', { orgSlug: 'nobody' })).rejects.toThrow(WorkspacePricingError);
  });

  it('applies each workspace its OWN markup and the application then charges exactly what Waboo charged', async () => {
    for (const c of ['wsa', 'wsb'] as const) {
      const r = await run(c, { apply: true, factor: '1', confirm: async (p) => p });
      expect(r.applied).toBe(8);
      expect(r.verdict?.ok).toBe(true);
    }
    const a = await stored('wsa');
    const b = await stored('wsb');
    expect(a.every((x) => x.set_by === 'waboo-migration')).toBe(true);
    const bps = (rows: typeof a, cc: string, k: string): number =>
      rows.find((x) => x.country_code === cc && x.category === k)!.margin_bps;
    expect(bps(b, 'SG', 'marketing')).toBeGreaterThan(bps(a, 'SG', 'marketing'));
    // SG marketing: 5.366 + 0.59 = 5.956 -> 5.96 ; 5.366 + 2 = 7.366 -> 7.37
    expect(priceFromMargin(5_366_000, bps(a, 'SG', 'marketing'))).toBe(596);
    expect(priceFromMargin(5_366_000, bps(b, 'SG', 'marketing'))).toBe(737);
    // SG utility: 1.173 + 0.352 = 1.525 -> 1.53
    expect(priceFromMargin(1_173_000, bps(a, 'SG', 'utility'))).toBe(153);
    // free stays free
    expect(bps(a, 'IN', 'service')).toBe(-10_000);
  });

  it('a second run is a no-op, --verify is clean, and a changed row is caught and never overwritten', async () => {
    const again = await run('wsa', { apply: true, factor: '1', confirm: async (p) => p });
    expect(again.applied).toBe(0);
    expect(again.same).toHaveLength(8);
    expect((await run('wsa', { verify: true })).verdict?.ok).toBe(true);
    await asOwner(db, (d) =>
      d.execute(sql`UPDATE workspace_message_margins SET margin_bps = margin_bps + 700
                    WHERE country_code = 'SG' AND category = 'marketing' AND org_id = (SELECT id FROM organizations WHERE slug = 'wsa')`),
    );
    // --verify fails (non-zero exit) when the table no longer matches Waboo
    await expect(run('wsa', { verify: true })).rejects.toThrow(/does not match Waboo/);
    const dry = await run('wsa');
    expect(dry.conflicts).toHaveLength(1);
    await expect(run('wsa', { apply: true, factor: '1', confirm: async (p) => p })).rejects.toThrow(
      /already hold a different margin/,
    );
  });

  it('--skip-conflicts writes the missing keys, leaves the conflict and an unrelated override alone, and does not fail the read-back', async () => {
    // wsa still holds the changed SG marketing row from the test above; remove one planned row and add an override outside the plan
    await asOwner(db, async (d) => {
      await d.execute(sql`DELETE FROM workspace_message_margins
                          WHERE country_code = 'IN' AND category = 'utility' AND org_id = (SELECT id FROM organizations WHERE slug = 'wsa')`);
      await d.execute(sql`INSERT INTO workspace_message_margins (org_id, country_code, category, margin_bps, note)
                          SELECT id, 'FR', 'utility', 123, 'an operator override' FROM organizations WHERE slug = 'wsa'`);
    });
    const r = await run('wsa', {
      apply: true,
      factor: '1',
      skipConflicts: true,
      confirm: async (p) => p,
    });
    expect(r.applied).toBe(1);
    expect(r.verdict?.ok).toBe(true);
    const rows = await stored('wsa');
    expect(rows.find((x) => x.country_code === 'FR')?.margin_bps).toBe(123); // untouched
    expect(rows.find((x) => x.country_code === 'IN' && x.category === 'utility')).toBeTruthy();
  });
});
