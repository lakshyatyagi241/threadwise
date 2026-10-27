import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconnectingQuery } from './watcher.mjs';

/** A fake pg client: `fail` is the error its next query throws (once). */
function fakeOpener() {
  const made = [];
  const open = async (onDead) => {
    const c = { n: made.length + 1, ended: false, fail: null, onDead, async query() { if (this.fail) { const e = this.fail; this.fail = null; throw e; } return { rows: [{ client: this.n }] }; }, async end() { this.ended = true; } };
    made.push(c);
    return c;
  };
  return { made, open };
}

test('reuses one connection for every poll', async () => {
  const { made, open } = fakeOpener();
  const q = reconnectingQuery(open);
  for (let i = 0; i < 3; i++) assert.equal((await q('select 1')).rows[0].client, 1);
  assert.equal(made.length, 1);
});

test('replaces a connection that failed without a SQL code (the dead client that blinded the watcher for ever)', async () => {
  const { made, open } = fakeOpener();
  const q = reconnectingQuery(open);
  await q('select 1');
  made[0].fail = new Error('Client has encountered a connection error and is not queryable');
  await assert.rejects(q('select 1'), /not queryable/);
  assert.equal(made[0].ended, true);
  assert.equal((await q('select 1')).rows[0].client, 2); // the next poll runs on a fresh connection
  assert.equal(made.length, 2);
});

test('keeps the connection after an ordinary SQL error (it has a code)', async () => {
  const { made, open } = fakeOpener();
  const q = reconnectingQuery(open);
  await q('select 1');
  made[0].fail = Object.assign(new Error('relation does not exist'), { code: '42P01' });
  await assert.rejects(q('select 1'), /does not exist/);
  assert.equal(made[0].ended, false);
  assert.equal((await q('select 1')).rows[0].client, 1);
  assert.equal(made.length, 1);
});

test('replaces a connection that reports an error event', async () => {
  const { made, open } = fakeOpener();
  const q = reconnectingQuery(open);
  await q('select 1');
  made[0].onDead(new Error('terminating connection'));
  assert.equal((await q('select 1')).rows[0].client, 2);
});

test('retries opening on the next poll when the database is unreachable, and shares one open between concurrent polls', async () => {
  let attempts = 0;
  const q = reconnectingQuery(async () => {
    attempts++;
    if (attempts === 1) throw new Error('connect ECONNREFUSED');
    return { async query() { return { rows: [{ ok: 1 }] }; }, async end() {} };
  });
  await assert.rejects(q('select 1'), /ECONNREFUSED/);
  const [a, b] = await Promise.all([q('select 1'), q('select 1')]);
  assert.equal(a.rows[0].ok, 1);
  assert.equal(b.rows[0].ok, 1);
  assert.equal(attempts, 2); // one failed open, then ONE open for both concurrent polls
});
