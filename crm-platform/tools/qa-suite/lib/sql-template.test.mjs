// Tests for the SQL template classifier (QA task 30). Run: node --test tools/qa-suite/lib/sql-template.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classify, templateOf } from './sql-template.mjs';

const consts = new Set(['TABLE', 'LIMIT']);

test('templateOf returns the template alone, not the argument array after it', () => {
  assert.equal(templateOf('.query(`SELECT 1 WHERE a = $1`, [a, b])'), '`SELECT 1 WHERE a = $1`');
  assert.equal(templateOf('no template here'), '');
  assert.equal(templateOf('`never closed'), '');
});

test('templateOf handles ${} holes, nested templates and escaped backticks', () => {
  assert.equal(templateOf('x(`a ${b} c`, y)'), '`a ${b} c`');
  assert.equal(templateOf('x(`a ${f(`inner ${z}`)} c`, y)'), '`a ${f(`inner ${z}`)} c`');
  assert.equal(templateOf('x(`a \\` b`, y)'), '`a \\` b`');
  assert.equal(templateOf('x(`a ${ {k: 1}.k } b`)'), '`a ${ {k: 1}.k } b`');
});

test('a parameterised query ($1, $2 ...) with no interpolation is safe: that is the form to encourage', () => {
  // This was flagged "review" before: the "$" of a placeholder and the argument array after the template both defeated the check.
  assert.equal(classify('`SELECT * FROM t WHERE id = $1 AND org_id = $2`', consts), 'safe');
  assert.equal(
    classify('`UPDATE t SET v = $3::jsonb WHERE k = $1 AND v = $2::jsonb RETURNING 1`', consts),
    'safe',
  );
  assert.equal(
    classify(templateOf('`SELECT $1::bigint IS NULL OR id > $1`, [after, limit]'), consts),
    'safe',
  );
});

test('plain string literals are safe; a dollar sign inside one is not trusted', () => {
  assert.equal(classify("'SELECT 1'", consts), 'safe');
  assert.equal(classify("'SELECT $1'", consts), 'review');
});

test('an interpolation of a module constant or a number is safe', () => {
  assert.equal(classify('`SELECT * FROM ${TABLE} LIMIT ${LIMIT}`', consts), 'safe');
  assert.equal(classify('`SELECT * FROM t LIMIT ${50}`', consts), 'safe');
});

test('an interpolation that reads request-shaped data is a likely injection', () => {
  assert.equal(classify('`SELECT * FROM t ORDER BY ${query.sort}`', consts), 'request');
  assert.equal(classify("`SELECT * FROM t WHERE name = '${req.body.name}'`", consts), 'request');
  assert.equal(classify('`SELECT ${column} FROM t`', consts), 'request');
});

test('any other interpolation needs a human', () => {
  assert.equal(classify('`UPDATE ${table} SET ${col} = $1`', consts), 'review');
  assert.equal(classify('`FETCH ${batch} FROM c`', consts), 'review');
});

test('an identifier is safe only when it is a module constant', () => {
  assert.equal(classify('TABLE', consts), 'safe');
  assert.equal(classify('someVariable', consts), 'review');
});

test('mixed: one safe and one request interpolation is a request finding, never hidden by the safe one', () => {
  assert.equal(classify('`SELECT * FROM ${TABLE} ORDER BY ${query.sort}`', consts), 'request');
});

test('the real code base: the query templates needing review are few, and none reads request data', async () => {
  const { default: task } = await import('../tasks/30-injection.mjs');
  const { checks } = await task.run();
  const byId = Object.fromEntries(checks.map((c) => [c.id, c]));
  assert.equal(byId['inj-concat-request'].status, 'pass');
  assert.equal(byId['inj-raw-request'].status, 'pass');
  // Parameterised queries are no longer reported, so what is left are real interpolations (a handful, not dozens).
  const left = Number(String(byId['inj-concat'].detail ?? '0').match(/\d+/)?.[0] ?? 0);
  assert.ok(left <= 12, `expected only real interpolations, got ${left}`);
});
