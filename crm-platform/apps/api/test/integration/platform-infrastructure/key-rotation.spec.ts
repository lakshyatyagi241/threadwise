import { resolve } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { ConfigService } from '@nestjs/config';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@crm/db';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import { isDone, rotateKeys } from '../../../src/modules/platform-infrastructure';

/**
 * Key rotation against a real Postgres, as the restricted application role (a superuser would bypass row-level security and
 * make the privileged-mode assertions vacuous). The real schema supplies the awkward cases: a partitioned table with RLS
 * (`event_outbox`) and jsonb secrets (`platform_settings`); a few tables of our own supply the rest.
 */
const key = (fill: number) => Buffer.alloc(32, fill).toString('base64');
const ring = (current: number, previous: number[] = []) =>
  new CryptoService({
    get: (k: string) =>
      k === 'CREDENTIALS_ENCRYPTION_KEY'
        ? key(current)
        : k === 'CREDENTIALS_ENCRYPTION_PREVIOUS_KEYS'
          ? previous.map(key).join(',')
          : undefined,
  } as unknown as ConfigService<never, true>);

const OLD = ring(1);
const NEW_ONLY = ring(2); // can open only blobs sealed with key 2
const ROTATED = ring(2, [1]); // the ring during a rotation: new key, old one for reading
const LOST = ring(9); // a key nobody has any more

let container: StartedPostgreSqlContainer;
let owner: Client;
let reader: Client;
let writer: Client;
let url: string;

const connectApp = async (privileged = true): Promise<Client> => {
  const c = new Client({ connectionString: url });
  await c.connect();
  if (privileged) await c.query(`SELECT set_config('app.privileged', 'on', false)`);
  return c;
};

beforeAll(async () => {
  container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
    .withDatabase('crm')
    .withUsername('crm')
    .withPassword('crm')
    .start();
  owner = new Client({ connectionString: container.getConnectionUri() });
  await owner.connect();
  await owner.query(
    `CREATE ROLE crm_app_user LOGIN PASSWORD 'test' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`,
  );
  await runMigrations(container.getConnectionUri(), {
    dir: resolve(__dirname, '../../../../../packages/db/migrations'),
    log: () => undefined,
  });
  await owner.query(`
    CREATE TABLE rot_text    (id serial PRIMARY KEY, secret text, note text);
    CREATE TABLE rot_varchar (id serial PRIMARY KEY, secret varchar(600));
    CREATE TABLE rot_doc     (id serial PRIMARY KEY, doc jsonb);
    CREATE TABLE rot_part    (id bigint, ts date NOT NULL, secret text) PARTITION BY RANGE (ts);
    CREATE TABLE rot_part_a  PARTITION OF rot_part FOR VALUES FROM ('2026-01-01') TO ('2026-07-01');
    CREATE TABLE rot_part_b  PARTITION OF rot_part FOR VALUES FROM ('2026-07-01') TO ('2027-01-01');
    GRANT ALL ON rot_text, rot_varchar, rot_doc, rot_part, rot_part_a, rot_part_b TO crm_app_user;
    GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO crm_app_user;
  `);
  url = container.getConnectionUri().replace('crm:crm@', 'crm_app_user:test@');
  reader = await connectApp();
  writer = await connectApp();
}, 240_000);

afterAll(async () => {
  await Promise.all([reader?.end(), writer?.end(), owner?.end()]);
  await container?.stop();
});

const seed = async () => {
  await owner.query(`TRUNCATE rot_text, rot_varchar, rot_doc, rot_part RESTART IDENTITY`);
  await owner.query(`DELETE FROM event_outbox`);
  await owner.query(`DELETE FROM platform_settings WHERE key LIKE 'rot.%'`);
};
const get = async (sql: string) => (await owner.query(sql)).rows;

describe('key rotation', () => {
  it('finds sealed values wherever they are, moves them to the current key, and then says it is done', async () => {
    await seed();
    const a = OLD.encrypt('alpha');
    const b = OLD.encrypt('bravo');
    const already = ROTATED.encrypt('charlie'); // already under the new key
    await owner.query(
      `INSERT INTO rot_text (secret, note) VALUES ($1,'n1'),($2,'n2'),($3,'n3'),(NULL,'n4'),('','n5')`,
      [a, b, already],
    );
    await owner.query(`INSERT INTO rot_varchar (secret) VALUES ($1)`, [OLD.encrypt('delta')]);
    await owner.query(`INSERT INTO rot_doc (doc) VALUES ($1::jsonb)`, [
      JSON.stringify({
        token: OLD.encrypt('echo'),
        nested: { list: [OLD.encrypt('foxtrot'), 'plain', ROTATED.encrypt('golf')] },
        n: 1,
      }),
    ]);
    await owner.query(
      `INSERT INTO rot_part (id, ts, secret) VALUES (1,'2026-02-01',$1),(2,'2026-09-01',$2)`,
      [OLD.encrypt('hotel'), OLD.encrypt('india')],
    );
    await owner.query(
      `INSERT INTO platform_settings (key, value, is_secret) VALUES ('rot.smtp', to_jsonb($1::text), true)`,
      [OLD.encrypt('juliet')],
    );
    await owner.query(
      `INSERT INTO event_outbox (org_id, aggregate_module, aggregate_id, event_type, payload)
       VALUES (1,'x',1,'x.created', $1::jsonb)`,
      [JSON.stringify({ credentials: OLD.encrypt('kilo'), other: 'v1:beta' })],
    );

    const dry = await rotateKeys(reader, writer, ROTATED, { dryRun: true, batchSize: 2 });
    const sum = (key: 'found' | 'current' | 'rewritten') => dry.reduce((n, r) => n + r[key], 0);
    expect(sum('found')).toBe(11);
    expect(sum('current')).toBe(2);
    expect(sum('rewritten')).toBe(9);
    expect(isDone(dry, true)).toBe(false);
    // a dry run changes nothing: the new-key-only ring still cannot open the old blobs
    const untouched = String(
      (await get(`SELECT secret FROM rot_text ORDER BY id LIMIT 1`))[0]!.secret,
    );
    expect(() => NEW_ONLY.decrypt(untouched)).toThrow();

    const real = await rotateKeys(reader, writer, ROTATED, { batchSize: 2 });
    expect(real.reduce((n, r) => n + r.rewritten, 0)).toBe(9);
    expect(isDone(real)).toBe(true);
    expect(real.flatMap((r) => r.failed)).toEqual([]);

    // everything now opens with the NEW key alone
    const texts = await get(`SELECT secret FROM rot_text WHERE secret <> '' ORDER BY id`);
    expect(texts.map((r) => NEW_ONLY.decrypt(String(r.secret)))).toEqual([
      'alpha',
      'bravo',
      'charlie',
    ]);
    expect(NEW_ONLY.decrypt(String((await get(`SELECT secret FROM rot_varchar`))[0]!.secret))).toBe(
      'delta',
    );
    const doc = (await get(`SELECT doc FROM rot_doc`))[0]!.doc as {
      token: string;
      nested: { list: string[] };
      n: number;
    };
    expect(NEW_ONLY.decrypt(doc.token)).toBe('echo');
    expect(NEW_ONLY.decrypt(doc.nested.list[0]!)).toBe('foxtrot');
    expect(doc.nested.list[1]).toBe('plain');
    expect(NEW_ONLY.decrypt(doc.nested.list[2]!)).toBe('golf');
    expect(doc.n).toBe(1);
    const parts = await get(`SELECT secret FROM rot_part ORDER BY id`); // both partitions
    expect(parts.map((r) => NEW_ONLY.decrypt(String(r.secret)))).toEqual(['hotel', 'india']);
    expect(
      NEW_ONLY.decrypt(
        String((await get(`SELECT value FROM platform_settings WHERE key = 'rot.smtp'`))[0]!.value),
      ),
    ).toBe('juliet');
    const outbox = (await get(`SELECT payload FROM event_outbox`))[0]!.payload as {
      credentials: string;
      other: string;
    };
    expect(NEW_ONLY.decrypt(outbox.credentials)).toBe('kilo');
    expect(outbox.other).toBe('v1:beta'); // text that is not a blob is left exactly as it was
    // untouched neighbours
    expect((await get(`SELECT note FROM rot_text ORDER BY id`)).map((r) => r.note)).toEqual([
      'n1',
      'n2',
      'n3',
      'n4',
      'n5',
    ]);

    const again = await rotateKeys(reader, writer, ROTATED, { batchSize: 2, dryRun: true });
    expect(isDone(again, true)).toBe(true);
    expect(again.reduce((n, r) => n + r.rewritten, 0)).toBe(0);
  });

  it('reports a blob sealed with a key nobody has, leaves it alone, and does not say it is done', async () => {
    await seed();
    const lost = LOST.encrypt('orphan');
    await owner.query(`INSERT INTO rot_text (secret) VALUES ($1), ($2)`, [
      lost,
      OLD.encrypt('fine'),
    ]);
    const reports = await rotateKeys(reader, writer, ROTATED);
    const r = reports.find((x) => x.column === 'rot_text.secret')!;
    expect(r.rewritten).toBe(1);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0]).toContain(LOST.currentKeyId);
    expect(isDone(reports)).toBe(false);
    expect(await get(`SELECT secret FROM rot_text WHERE secret = '${lost}'`)).toHaveLength(1);
  });

  it('reports a string that only looks like a blob instead of touching it', async () => {
    await seed();
    await owner.query(`INSERT INTO rot_text (secret) VALUES ('v1:aaaa:bbbb:cccc')`);
    const reports = await rotateKeys(reader, writer, ROTATED);
    expect(reports.find((x) => x.column === 'rot_text.secret')!.failed).toHaveLength(1);
    expect((await get(`SELECT secret FROM rot_text`))[0]!.secret).toBe('v1:aaaa:bbbb:cccc');
  });

  it('leaves a row alone that someone changed while the tool was working, and reports it', async () => {
    await seed();
    await owner.query(`INSERT INTO rot_text (secret) VALUES ($1)`, [OLD.encrypt('contested')]);
    // a writer that, just before its first UPDATE, lets another session edit the row
    let interfered = false;
    const racing = {
      query: async (text: string, params?: unknown[]) => {
        if (!interfered && text.startsWith('UPDATE')) {
          interfered = true;
          await owner.query(`UPDATE rot_text SET secret = $1`, [OLD.encrypt('edited by a user')]);
        }
        return writer.query(text, params);
      },
    };
    const first = await rotateKeys(reader, racing, ROTATED);
    const r = first.find((x) => x.column === 'rot_text.secret')!;
    expect(r.changed).toBe(1);
    expect(r.rewritten).toBe(0);
    expect(isDone(first)).toBe(false);
    expect(OLD.decrypt(String((await get(`SELECT secret FROM rot_text`))[0]!.secret))).toBe(
      'edited by a user',
    ); // the edit survived
    const second = await rotateKeys(reader, writer, ROTATED); // a rerun finishes the job
    expect(isDone(second)).toBe(true);
    expect(NEW_ONLY.decrypt(String((await get(`SELECT secret FROM rot_text`))[0]!.secret))).toBe(
      'edited by a user',
    );
  });

  it('honours --only and --exclude', async () => {
    await seed();
    await owner.query(`INSERT INTO rot_text (secret) VALUES ($1)`, [OLD.encrypt('a')]);
    await owner.query(`INSERT INTO rot_varchar (secret) VALUES ($1)`, [OLD.encrypt('b')]);
    const only = await rotateKeys(reader, writer, ROTATED, { only: ['rot_varchar'], dryRun: true });
    expect(only.map((r) => r.column)).toEqual(['rot_varchar.secret']);
    const excl = await rotateKeys(reader, writer, ROTATED, {
      exclude: ['rot_varchar', 'public.rot_part'],
      dryRun: true,
    });
    expect(excl.map((r) => r.column)).toEqual(['rot_text.secret']);
  });

  it('sees nothing in tenant tables without privileged mode: that is why the tool sets it', async () => {
    await seed();
    await owner.query(
      `INSERT INTO event_outbox (org_id, aggregate_module, aggregate_id, event_type, payload) VALUES (1,'x',1,'x.created',$1::jsonb)`,
      [JSON.stringify({ credentials: OLD.encrypt('hidden') })],
    );
    const plainReader = await connectApp(false);
    const plainWriter = await connectApp(false);
    try {
      const blind = await rotateKeys(plainReader, plainWriter, ROTATED, {
        only: ['event_outbox'],
        dryRun: true,
      });
      expect(blind).toEqual([]);
    } finally {
      await Promise.all([plainReader.end(), plainWriter.end()]);
    }
    const seen = await rotateKeys(reader, writer, ROTATED, {
      only: ['event_outbox'],
      dryRun: true,
    });
    expect(seen.map((r) => r.column)).toEqual(['event_outbox.payload']);
  });

  it('counts blobs by the key that sealed them, including ones written before key ids existed', async () => {
    await seed();
    const legacy = OLD.encrypt('old-format').split(':').slice(0, 4).join(':');
    await owner.query(`INSERT INTO rot_text (secret) VALUES ($1), ($2), ($3)`, [
      legacy,
      OLD.encrypt('x'),
      ROTATED.encrypt('y'),
    ]);
    const [r] = await rotateKeys(reader, writer, ROTATED, { only: ['rot_text'], dryRun: true });
    expect(r!.byKey).toEqual({ legacy: 1, [OLD.currentKeyId]: 1, [ROTATED.currentKeyId]: 1 });
    expect(r!.rewritten).toBe(2);
  });
});
