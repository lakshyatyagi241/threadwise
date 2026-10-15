import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deref, diffDocuments } from './openapi-diff.mjs';

const ok = (schema) => ({ 200: { content: { 'application/json': { schema } } } });
const doc = (paths, schemas = {}) => ({ openapi: '3.0.0', paths, components: { schemas } });
const tag = (extra = {}) => ({
  type: 'object',
  required: ['id', 'name'],
  properties: { id: { type: 'string' }, name: { type: 'string' }, ...extra },
});
const get = (schema, params = []) => ({
  '/public/v1/tags': { get: { parameters: params, responses: ok(schema) } },
});
const msgs = (d, sev = 'breaking') => d.filter((x) => x.severity === sev).map((x) => x.message);

test('an identical document has no differences', () => {
  assert.deepEqual(diffDocuments(doc(get(tag())), doc(get(tag()))), []);
});
test('a removed path, method and success status are breaking', () => {
  const base = doc({
    '/a': { get: { responses: ok({ type: 'object' }) }, post: { responses: { 201: {} } } },
  });
  const head = doc({ '/a': { get: { responses: { 204: {} } } } });
  assert.deepEqual(msgs(diffDocuments(base, head)).sort(), [
    'method removed',
    'success status code removed',
  ]);
  assert.deepEqual(msgs(diffDocuments(base, doc({}))), ['path removed']);
});
test('a response property removed, retyped or made optional is breaking', () => {
  const base = doc(get(tag()));
  assert.deepEqual(
    msgs(diffDocuments(base, doc(get({ ...tag(), properties: { id: { type: 'string' } } })))),
    ['property removed from the response'],
  );
  assert.deepEqual(msgs(diffDocuments(base, doc(get(tag({ name: { type: 'integer' } }))))), [
    'type changed from string to integer',
  ]);
  assert.deepEqual(msgs(diffDocuments(base, doc(get({ ...tag(), required: ['id'] })))), [
    'required response property became optional',
  ]);
});
test('a new response property is not breaking', () => {
  assert.deepEqual(
    msgs(diffDocuments(doc(get(tag())), doc(get(tag({ color: { type: 'string' } }))))),
    [],
  );
});
test('a new required parameter is breaking, a new optional one is a warning', () => {
  const base = doc(get(tag()));
  assert.deepEqual(
    msgs(
      diffDocuments(
        base,
        doc(get(tag(), [{ name: 'q', in: 'query', required: true, schema: { type: 'string' } }])),
      ),
    ),
    ['new required parameter'],
  );
  assert.deepEqual(
    msgs(
      diffDocuments(
        base,
        doc(get(tag(), [{ name: 'q', in: 'query', schema: { type: 'string' } }])),
      ),
      'warning',
    ),
    ['new optional parameter'],
  );
});
test('request body: new required property and a required body are breaking, lost enum value too', () => {
  const body = (props, required = [], bodyRequired = false) => ({
    '/x': {
      post: {
        requestBody: {
          required: bodyRequired,
          content: {
            'application/json': { schema: { type: 'object', required, properties: props } },
          },
        },
        responses: { 201: {} },
      },
    },
  });
  const base = doc(body({ a: { type: 'string' }, k: { type: 'string', enum: ['x', 'y'] } }));
  assert.deepEqual(
    msgs(
      diffDocuments(
        base,
        doc(
          body(
            {
              a: { type: 'string' },
              k: { type: 'string', enum: ['x', 'y'] },
              b: { type: 'string' },
            },
            ['b'],
          ),
        ),
      ),
    ),
    ['new required request property'],
  );
  assert.deepEqual(
    msgs(
      diffDocuments(base, doc(body({ a: { type: 'string' }, k: { type: 'string', enum: ['x'] } }))),
    ),
    ['request enum lost ["y"]'],
  );
  assert.deepEqual(
    msgs(
      diffDocuments(
        base,
        doc(body({ a: { type: 'string' }, k: { type: 'string', enum: ['x', 'y'] } }, [], true)),
      ),
    ),
    ['request body became required'],
  );
});
test('a response enum that gains a value is only a warning', () => {
  const e = (v) => get({ type: 'object', properties: { s: { type: 'string', enum: v } } });
  const d = diffDocuments(doc(e(['a'])), doc(e(['a', 'b'])));
  assert.deepEqual(msgs(d), []);
  assert.deepEqual(msgs(d, 'warning'), ['response enum gained ["b"]']);
});
test('$ref schemas are followed, and a cycle does not loop', () => {
  const ref = { $ref: '#/components/schemas/Tag' };
  const base = doc(get(ref), { Tag: tag({ parent: { $ref: '#/components/schemas/Tag' } }) });
  const head = doc(get(ref), {
    Tag: {
      ...tag({ parent: { $ref: '#/components/schemas/Tag' } }),
      properties: { id: { type: 'string' }, parent: { $ref: '#/components/schemas/Tag' } },
    },
  });
  assert.deepEqual(msgs(diffDocuments(base, head)), ['property removed from the response']);
  assert.deepEqual(deref(base, { $ref: '#/components/schemas/Missing' }), {});
});
test('the prefix limits the check to the external contract', () => {
  const base = doc({
    '/internal/a': { get: { responses: ok({ type: 'object' }) } },
    ...get(tag()),
  });
  const head = doc(get(tag()));
  assert.equal(msgs(diffDocuments(base, head)).length, 1);
  assert.equal(msgs(diffDocuments(base, head, { prefix: '/public/v1' })).length, 0);
});
