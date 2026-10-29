import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { tupleDiff } from '../reconcile/set-diff';
import { asOwner, cloneDb, type TestDb } from './helpers';

// What the reconcile compares: the tuples a Postgres query returns against the independent list, as NUL-joined strings.
const SEP = '\u0000';
const got = sql`SELECT * FROM (VALUES ('f1','a','f2','x'), ('f1','b','f2','y'), ('f1','b','f2','y')) AS t(pf, pv, cf, cv)`;
const COLS = ['pf', 'pv', 'cf', 'cv'];

describe('tupleDiff: Postgres counts what differs, only two numbers come back', () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await cloneDb('setdiff');
  });
  afterAll(async () => {
    await db.drop();
  });

  const run = (want: string[]) =>
    asOwner(db, (d) => tupleDiff(d, new Set(want.map((w) => w.split(',').join(SEP))), got, COLS));

  it('equal sets: nothing missing, nothing unexpected (a repeated row is one tuple)', async () => {
    expect(await run(['f1,a,f2,x', 'f1,b,f2,y'])).toEqual({ missing: 0, unexpected: 0 });
  });

  it('a tuple the database lacks is missing', async () => {
    expect(await run(['f1,a,f2,x', 'f1,b,f2,y', 'f1,c,f2,z'])).toEqual({ missing: 1, unexpected: 0 });
  });

  it('a tuple the independent list lacks is unexpected', async () => {
    expect(await run(['f1,a,f2,x'])).toEqual({ missing: 0, unexpected: 1 });
  });

  it('a changed value is one missing and one unexpected; an empty list is everything unexpected', async () => {
    expect(await run(['f1,a,f2,x', 'f1,b,f2,CHANGED'])).toEqual({ missing: 1, unexpected: 1 });
    expect(await run([])).toEqual({ missing: 0, unexpected: 2 });
  });

  it('quotes, backslashes and unicode survive the trip', async () => {
    // String.raw: a plain template would turn \b into a backspace before Postgres sees it
    const odd = sql.raw(
      String.raw`SELECT * FROM (VALUES ('it''s', 'a\b', '"q"', 'é✓')) AS t(pf, pv, cf, cv)`,
    );
    const r = await asOwner(db, (d) =>
      tupleDiff(d, new Set([["it's", 'a\\b', '"q"', 'é✓'].join(SEP)]), odd, COLS),
    );
    expect(r).toEqual({ missing: 0, unexpected: 0 });
  });
});
