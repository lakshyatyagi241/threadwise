// Run: node --test tools/api-inventory/sql-shapes.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sqlShapes } from './sql-shapes.mjs';

const shapes = (src) => [...sqlShapes(src)].map((s) => s.shape);

test('flags a leading-wildcard search and OFFSET paging', () => {
  assert.ok(
    shapes(
      "const q = sql`SELECT id FROM contacts WHERE name ILIKE '%' || ${term} || '%'`;",
    ).includes('leading-wildcard LIKE'),
  );
  assert.deepEqual(shapes("sql`SELECT id FROM contacts WHERE name ILIKE ${term} || '%'`"), [
    'ILIKE on an expression',
  ]); // trailing wildcard only: an index can serve it
  assert.deepEqual(shapes('sql`SELECT id FROM t ORDER BY id LIMIT 20 OFFSET ${off}`'), [
    'OFFSET pagination',
  ]);
});

test('flags SELECT * and the FILTER aggregate', () => {
  assert.ok(shapes('sql`SELECT * FROM contacts WHERE org_id = ${o}`').includes('SELECT *'));
  assert.ok(
    shapes('sql`SELECT count(*) FILTER (WHERE a) AS n FROM conversations`').includes(
      'count(*) FILTER aggregate',
    ),
  );
});

test('a plain keyed read and non-SQL templates are not flagged', () => {
  assert.deepEqual(
    shapes('sql`SELECT id, name FROM contacts WHERE org_id = ${o} AND id = ${id}`'),
    [],
  );
  assert.deepEqual(shapes('sql`${a} AND ${b}`'), []);
  assert.deepEqual(shapes('const s = `SELECT * FROM x`;'), []); // not a sql tag
});

test('reports the line of the statement', () => {
  const [hit] = [...sqlShapes('a\nb\nsql`SELECT * FROM t`')];
  assert.equal(hit.line, 3);
});
