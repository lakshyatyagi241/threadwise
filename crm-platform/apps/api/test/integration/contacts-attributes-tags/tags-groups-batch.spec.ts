import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations, schema, type Tx } from '@crm/db';
import { ContactGroupsRepository } from '../../../src/modules/crm/contact-groups/contact-groups.repository';
import { TagsRepository } from '../../../src/modules/crm/tags/tags.repository';

/**
 * The batched reads and the one-statement attach that replaced per-name and per-pair queries in the contact import, the form submit and
 * bulk tagging (QA task 43). They are SQL (citext `= ANY`, `lower(name) = ANY`, multi-row `ON CONFLICT DO NOTHING`), so they are proven on a
 * real Postgres with every migration applied.
 *
 * Rerun: pnpm --filter @crm/api exec vitest run test/integration/contacts-attributes-tags/tags-groups-batch.spec.ts --testTimeout=120000
 */
describe('tags and groups: batched lookups and attach', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let tx: Tx;
  let orgA: number;
  let orgB: number;
  const tags = new TagsRepository();
  const groups = new ContactGroupsRepository();

  const scalar = async (q: string, params: unknown[] = []) =>
    Number((await owner.query(q, params)).rows[0].id);

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('crm')
      .withUsername('crm')
      .withPassword('crm')
      .start();
    owner = new Client({ connectionString: container.getConnectionUri() });
    await owner.connect();
    await runMigrations(container.getConnectionUri(), {
      dir: resolve(__dirname, '../../../../../packages/db/migrations'),
      log: () => undefined,
    });
    tx = drizzle(owner, { schema }) as unknown as Tx;
    orgA = await scalar(
      `INSERT INTO organizations (slug,name,plan) VALUES ('ta','A','starter') RETURNING id`,
    );
    orgB = await scalar(
      `INSERT INTO organizations (slug,name,plan) VALUES ('tb','B','starter') RETURNING id`,
    );
  }, 240_000);

  afterAll(async () => {
    await owner?.end();
    await container?.stop();
  });

  const tag = (org: number, name: string) =>
    scalar(`INSERT INTO tags (org_id, name) VALUES ($1,$2) RETURNING id`, [org, name]);
  const group = (org: number, name: string) =>
    scalar(`INSERT INTO contact_groups (org_id, name) VALUES ($1,$2) RETURNING id`, [org, name]);
  const contact = (org: number, name: string) =>
    scalar(`INSERT INTO contacts (org_id, name) VALUES ($1,$2) RETURNING id`, [org, name]);

  describe('TagsRepository.findByNames', () => {
    it('finds tags by name, case-insensitively and trimmed, keyed by the lower-cased name', async () => {
      const vip = await tag(orgA, 'VIP');
      const lead = await tag(orgA, 'Hot Lead');
      const found = await tags.findByNames(tx, orgA, ['vip', '  HOT LEAD ', 'nope']);
      expect([...found.keys()].sort()).toEqual(['hot lead', 'vip']);
      expect(found.get('vip')!.id).toBe(vip);
      expect(found.get('hot lead')!.id).toBe(lead);
    });

    it("never returns another workspace's tag, even for the same name", async () => {
      const theirs = await tag(orgB, 'Shared');
      const mine = await tag(orgA, 'Shared');
      expect((await tags.findByNames(tx, orgA, ['Shared'])).get('shared')!.id).toBe(mine);
      expect((await tags.findByNames(tx, orgB, ['shared'])).get('shared')!.id).toBe(theirs);
    });

    it('ignores blanks and repeats, and an empty input asks nothing', async () => {
      expect((await tags.findByNames(tx, orgA, [])).size).toBe(0);
      expect((await tags.findByNames(tx, orgA, ['', '   '])).size).toBe(0);
      expect((await tags.findByNames(tx, orgA, ['vip', 'VIP', 'Vip'])).size).toBe(1);
    });

    it('takes a thousand names in one go', async () => {
      const names = Array.from({ length: 1000 }, (_, i) => `bulk-tag-${i}`);
      await tag(orgA, 'bulk-tag-500');
      const found = await tags.findByNames(tx, orgA, names);
      expect([...found.keys()]).toEqual(['bulk-tag-500']);
    });

    it('a name with quotes or SQL in it is only ever a value', async () => {
      const odd = await tag(orgA, `x'); DROP TABLE tags;--`);
      const found = await tags.findByNames(tx, orgA, [`x'); DROP TABLE tags;--`]);
      expect(found.get(`x'); drop table tags;--`)!.id).toBe(odd);
      expect((await owner.query(`SELECT count(*)::int AS n FROM tags`)).rows[0].n).toBeGreaterThan(
        0,
      );
    });
  });

  describe('ContactGroupsRepository.findByNames', () => {
    it('finds groups by name, case-insensitively and trimmed', async () => {
      const gold = await group(orgA, 'Gold');
      const found = await groups.findByNames(tx, orgA, ['gold', ' GOLD ', 'missing']);
      expect([...found.keys()]).toEqual(['gold']);
      expect(found.get('gold')!.id).toBe(gold);
    });

    it("never returns another workspace's group", async () => {
      await group(orgB, 'OnlyB');
      expect((await groups.findByNames(tx, orgA, ['onlyb'])).size).toBe(0);
    });

    it('an empty input asks nothing and a name that is only SQL is only a value', async () => {
      expect((await groups.findByNames(tx, orgA, [])).size).toBe(0);
      expect((await groups.findByNames(tx, orgA, [`' OR '1'='1`])).size).toBe(0);
    });
  });

  describe('TagsRepository.attach', () => {
    it('attaches every (contact, tag) pair in one go and returns exactly the pairs it added', async () => {
      const c1 = await contact(orgA, 'c1');
      const c2 = await contact(orgA, 'c2');
      const t1 = await tag(orgA, 'attach-1');
      const t2 = await tag(orgA, 'attach-2');
      const added = await tags.attach(tx, orgA, [c1, c2], [t1, t2], null);
      expect(added).toHaveLength(4);
      expect(added.map((a) => `${a.contactId}:${a.tagId}`).sort()).toEqual(
        [`${c1}:${t1}`, `${c1}:${t2}`, `${c2}:${t1}`, `${c2}:${t2}`].sort(),
      );
    });

    it('is idempotent: a pair that already exists is skipped and not returned', async () => {
      const c = await contact(orgA, 'idem');
      const t1 = await tag(orgA, 'idem-1');
      const t2 = await tag(orgA, 'idem-2');
      await tags.attach(tx, orgA, [c], [t1], null);
      const again = await tags.attach(tx, orgA, [c], [t1, t2], null);
      expect(again).toEqual([{ contactId: c, tagId: t2 }]);
      expect(await tags.attach(tx, orgA, [c], [t1, t2], null)).toEqual([]);
    });

    it('does nothing for an empty list of contacts or tags', async () => {
      const c = await contact(orgA, 'empty');
      expect(await tags.attach(tx, orgA, [], [1], null)).toEqual([]);
      expect(await tags.attach(tx, orgA, [c], [], null)).toEqual([]);
    });

    it('2,500 pairs go in as three statements and all land', async () => {
      const t = await tag(orgA, 'big-attach');
      const ids: number[] = [];
      for (let i = 0; i < 2500; i++) ids.push(await contact(orgA, `big-${i}`));
      const added = await tags.attach(tx, orgA, ids, [t], null);
      expect(added).toHaveLength(2500);
      const { rows } = await owner.query(
        `SELECT count(*)::int AS n FROM contact_tags WHERE tag_id = $1`,
        [t],
      );
      expect(rows[0].n).toBe(2500);
    }, 120_000);
  });
});
