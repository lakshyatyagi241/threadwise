import { afterAll, beforeAll, describe, it } from 'vitest';
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';
import { expectProblem } from '../../support/contract';

/**
 * API contract: error responses (QA task 8). One row per status class and endpoint class. Every error must be a
 * problem+json body with a code from ERROR_CODES, a `status` equal to the HTTP status, and no stack trace
 * (`expectProblem`). 429 is not covered here: the rate limits have their own specs, and a generic matrix cannot trip them
 * without making the run slow and order dependent.
 */
let h: Harness;
let api: Api;
let t: Tenant;
let noGrants: string;
beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  t = await api.signup('errors');
  noGrants = (await api.member(t, 'nogrants', [])).token;
}, 240_000);
afterAll(async () => {
  await h?.stop();
});

const GHOST = '99999999-9999-4999-8999-999999999999';
const READS = ['/v2/tags', '/v2/companies', '/v2/contacts', '/v2/tasks'];
const WRITES = [
  { path: '/v2/tags', ok: { name: 'Dup' } },
  { path: '/v2/companies', ok: { name: 'Dup' } },
];

describe.each(READS)('GET %s', (path) => {
  it('401 without a token', async () => {
    expectProblem(await api.http().get(path), 401, { label: `GET ${path} no token` });
  });
  it('401 with a garbage token', async () => {
    expectProblem(await api.as('not.a.token').get(path), 401, { label: `GET ${path} bad token` });
  });
  it('403 for a member without the permission', async () => {
    expectProblem(await api.as(noGrants).get(path), 403, { label: `GET ${path} no grants` });
  });
  it('404 for an id that does not exist', async () => {
    expectProblem(await api.as(t.admin).get(`${path}/${GHOST}`), 404, {
      label: `GET ${path}/:id ghost`,
    });
  });
  it('a malformed id is refused, not a 500', async () => {
    expectProblem(await api.as(t.admin).get(`${path}/not-an-id`), [400, 404, 422], {
      label: `GET ${path}/:id malformed`,
    });
  });
});

describe.each(WRITES)('POST $path', ({ path, ok }) => {
  it('422 for an empty body, with field errors', async () => {
    expectProblem(await api.as(t.admin).post(path).send({}), 422, {
      code: 'VALIDATION_FAILED',
      label: `POST ${path} empty`,
    });
  });
  it('401 without a token', async () => {
    expectProblem(await api.http().post(path).send(ok), 401, { label: `POST ${path} no token` });
  });
  it('403 for a member without the permission', async () => {
    expectProblem(await api.as(noGrants).post(path).send(ok), 403, {
      label: `POST ${path} no grants`,
    });
  });
  it('404 when updating an id that does not exist', async () => {
    expectProblem(
      await api.as(t.admin).patch(`${path}/${GHOST}`).send({ name: 'x', rowVersion: 1 }),
      404,
      { label: `PATCH ${path}/:id ghost` },
    );
  });
});

describe('409', () => {
  it('a duplicate tag name is a conflict with a registered code', async () => {
    const first = await api.as(t.admin).post('/v2/tags').send({ name: 'Unique once' });
    if (first.status !== 201) throw new Error(`arranging the tag failed: ${first.status}`);
    expectProblem(await api.as(t.admin).post('/v2/tags').send({ name: 'Unique once' }), 409, {
      label: 'POST /v2/tags duplicate',
    });
  });
  it('a stale row version is 409 ROW_VERSION_CONFLICT', async () => {
    const created = await api.as(t.admin).post('/v2/tags').send({ name: 'Stale me' });
    const id = created.body.id as string;
    await api
      .as(t.admin)
      .patch(`/v2/tags/${id}`)
      .send({ name: 'Stale me 2', rowVersion: created.body.rowVersion });
    expectProblem(
      await api
        .as(t.admin)
        .patch(`/v2/tags/${id}`)
        .send({ name: 'Stale me 3', rowVersion: created.body.rowVersion }),
      409,
      { code: 'ROW_VERSION_CONFLICT', label: 'PATCH /v2/tags/:id stale' },
    );
  });
});
