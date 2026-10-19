// Run: node --test tools/api-inventory/resolve-params.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { candidates, paramPools, resolveUrl } from './resolve-params.mjs';

const pools = new Map([
  ['contacts', ['c-1']],
  ['sales_docs', ['sd-1']],
  ['conversations', ['cv-1']],
  ['companies', ['co-1']],
]);

test('a named parameter maps to its table, singular or plural, camelCase or snake', () => {
  assert.deepEqual(resolveUrl('/v2/contacts/:contactId/notes', pools), {
    url: '/v2/contacts/c-1/notes',
    resolved: true,
  });
  assert.equal(resolveUrl('/v2/x/:companyId', pools).resolved, true); // company -> companies
  assert.equal(resolveUrl('/v2/x/:companyId', pools).url, '/v2/x/co-1');
});

test(':id takes the table from the nearest static segment before it', () => {
  assert.equal(resolveUrl('/v2/crm/sales-docs/:id', pools).url, '/v2/crm/sales-docs/sd-1');
  assert.equal(
    resolveUrl('/v2/inbox/conversations/:id/messages', pools).url,
    '/v2/inbox/conversations/cv-1/messages',
  );
});

test('an unknown parameter is marked unresolved and gets a placeholder', () => {
  const r = resolveUrl('/v2/things/:id', pools);
  assert.equal(r.resolved, false);
  assert.match(r.url, /00000000-0000-4000-8000-000000000001$/);
  assert.equal(resolveUrl('/v2/p/:slug', pools).url, '/v2/p/x');
});

test('candidates put the parameter itself before looser guesses', () => {
  assert.deepEqual(candidates('contactId', []).slice(0, 2), ['contact', 'contacts']);
  assert.equal(candidates('id', ['v2', 'inbox', 'conversations'])[0], 'conversations');
});

test('paramPools only interpolates plain table names and groups uuids by table', () => {
  const calls = [];
  const psql = (sql) => {
    calls.push(sql);
    if (sql.includes('FROM organizations')) return 'ws-uuid';
    if (sql.startsWith('SELECT table_name')) return 'contacts\nevil; DROP TABLE x\nsales_docs';
    return 'contacts\tu1\ncontacts\tu2\nsales_docs\tu3';
  };
  const p = paramPools(psql, 7);
  assert.deepEqual([...p.keys()].sort(), ['contacts', 'organizations', 'sales_docs']);
  assert.deepEqual(p.get('organizations'), ['ws-uuid']);
  assert.deepEqual(p.get('contacts'), ['u1', 'u2']);
  assert.ok(!calls.some((c) => c.includes('DROP TABLE')));
  assert.ok(calls[1].includes('org_id = 7'));
});
