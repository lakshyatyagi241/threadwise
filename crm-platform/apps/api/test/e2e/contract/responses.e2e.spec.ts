import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { companyResponseSchema, contactResponseSchema, tagResponseSchema } from '@crm/contracts';
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';
import { contractStats, expectContract } from '../../support/contract';

/**
 * API contract: success responses (QA task 8). Real requests through the full app, every response parsed with the zod
 * schema from @crm/contracts that the frontends use. Each parsed leaf value is one counted assertion
 * (see test/support/contract.ts); the total is printed so the 5,000-assertion target is measured.
 *
 * Rows: create, read one, list, update. Add a row to extend; the rest of the file does not change.
 */
let h: Harness;
let api: Api;
let t: Tenant;
beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  t = await api.signup('contract');
}, 240_000);
afterAll(async () => {
  console.log(
    `CONTRACT responses=${contractStats().responses} assertions=${contractStats().assertions} undeclaredFields=${contractStats().undeclaredFields}`,
  );
  await h?.stop();
});

const listOf = <T extends z.ZodTypeAny>(item: T) => z.object({ data: z.array(item) }).passthrough();

interface Resource {
  name: string;
  path: string;
  schema: z.ZodTypeAny;
  create: (n: number) => Record<string, unknown>;
  update: (n: number) => Record<string, unknown>;
}

const phone = (n: number) => `+9198${String(60000000 + n).padStart(8, '0')}`;
const RESOURCES: Resource[] = [
  {
    name: 'tag',
    path: '/v2/tags',
    schema: tagResponseSchema,
    create: (n) => ({ name: `Contract tag ${n}` }),
    update: (n) => ({ name: `Renamed tag ${n}` }),
  },
  {
    name: 'company',
    path: '/v2/companies',
    schema: companyResponseSchema,
    create: (n) => ({ name: `Contract co ${n}` }),
    update: (n) => ({ name: `Renamed co ${n}` }),
  },
  {
    name: 'contact',
    path: '/v2/contacts',
    schema: contactResponseSchema,
    create: (n) => ({ phone: phone(n) }),
    update: (n) => ({ firstName: `Name${n}` }),
  },
];

describe.each(RESOURCES)('$name responses match @crm/contracts', (r) => {
  let id: string;
  it('create answers 201 with the declared shape', async () => {
    const res = await api.as(t.admin).post(r.path).send(r.create(1));
    const body = expectContract(res, r.schema, { status: 201, label: `POST ${r.path}` });
    id = (body as { id: string }).id;
    expect(id).toBeTruthy();
  });
  it('read one answers 200 with the same shape', async () => {
    expectContract(await api.as(t.admin).get(`${r.path}/${id}`), r.schema, {
      status: 200,
      label: `GET ${r.path}/:id`,
    });
  });
  it('list answers 200 and every row has the declared shape', async () => {
    for (let n = 2; n <= 6; n++) await api.as(t.admin).post(r.path).send(r.create(n));
    const body = expectContract(await api.as(t.admin).get(`${r.path}?limit=50`), listOf(r.schema), {
      status: 200,
      label: `GET ${r.path}`,
    });
    expect(body.data.length).toBeGreaterThanOrEqual(6);
  });
  it('update answers 200 with the declared shape', async () => {
    const current = await api.as(t.admin).get(`${r.path}/${id}`);
    const res = await api
      .as(t.admin)
      .patch(`${r.path}/${id}`)
      .send({ ...r.update(1), rowVersion: current.body.rowVersion });
    expectContract(res, r.schema, { status: 200, label: `PATCH ${r.path}/:id` });
  });
});
