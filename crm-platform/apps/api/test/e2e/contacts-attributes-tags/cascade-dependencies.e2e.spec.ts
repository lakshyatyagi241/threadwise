import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, startHarness, type Harness, type Tenant } from './support';

/**
 * Cascading choices (Waboo's dependent fields), end to end through HTTP: a cascade is a field-level link with no option and no value,
 * plus option pairs that say which child choices each parent choice allows. The link never hides the child.
 */
let h: Harness;
let api: Api;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
}, 600_000);

afterAll(async () => {
  await h?.stop();
});

const code = (res: { body: { code?: string } }) => res.body.code;

describe('cascading choices', () => {
  let t: Tenant;
  let sectionId: string;
  const ids: Record<string, string> = {};
  const optionIds: Record<string, Record<string, string>> = {};

  async function select(key: string, values: string[]) {
    const res = await api
      .as(t.admin)
      .post('/v2/fields')
      .send({
        moduleKey: 'contacts',
        sectionId,
        key,
        label: key,
        fieldType: 'select',
        options: values.map((v) => ({ value: v, label: v })),
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    ids[key] = res.body.id;
    optionIds[key] = Object.fromEntries(
      (res.body.options as Array<{ id: string; value: string }>).map((o) => [o.value, o.id]),
    );
  }

  const pair = (parent: string, p: string, child: string, c: string) => ({
    parentOptionId: optionIds[parent]![p]!,
    childOptionId: optionIds[child]![c]!,
  });

  const putCascade = (child: string, body: Record<string, unknown>) =>
    api.as(t.admin).put(`/v2/fields/${ids[child]}/cascade`).send(body);

  beforeAll(async () => {
    t = await api.signup('cascade');
    const section = await api
      .as(t.admin)
      .post('/v2/field-sections')
      .send({ moduleKey: 'contacts', name: 'Location' });
    expect(section.status, JSON.stringify(section.body)).toBe(201);
    sectionId = section.body.id;
    await select('region', ['north', 'south']);
    await select('city', ['delhi', 'mumbai', 'chennai']);
    await select('state', ['up', 'tn']);
  });

  it('a cascade is listed with its link and its option pairs, under the field ids of both properties', async () => {
    const res = await putCascade('city', {
      dependsOnFieldId: ids.region,
      optionPairs: [
        pair('region', 'north', 'city', 'delhi'),
        pair('region', 'north', 'city', 'mumbai'),
        pair('region', 'south', 'city', 'chennai'),
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(204);

    const pairs = await api.as(t.admin).get('/v2/fields/option-dependencies?moduleKey=contacts');
    expect(pairs.status, JSON.stringify(pairs.body)).toBe(200);
    const mine = pairs.body.filter((p: { childFieldId: string }) => p.childFieldId === ids.city);
    expect(mine).toHaveLength(3);
    expect(mine.every((p: { parentFieldId: string }) => p.parentFieldId === ids.region)).toBe(true);

    const links = await api.as(t.admin).get('/v2/fields/dependencies?moduleKey=contacts');
    const link = links.body.find((d: { fieldId: string }) => d.fieldId === ids.city);
    expect(link).toMatchObject({
      dependsOnFieldId: ids.region,
      dependsOnOptionId: null,
      dependsOnValue: null,
    });
  });

  it('replacing a cascade replaces its pairs: the new set is all that is stored for the child', async () => {
    const res = await putCascade('city', {
      dependsOnFieldId: ids.region,
      optionPairs: [pair('region', 'south', 'city', 'chennai')],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(204);
    const pairs = await api.as(t.admin).get('/v2/fields/option-dependencies?moduleKey=contacts');
    const mine = pairs.body.filter((p: { childFieldId: string }) => p.childFieldId === ids.city);
    expect(mine.map((p: { childOptionId: string }) => p.childOptionId)).toEqual([
      optionIds.city!.chennai,
    ]);
    const links = await api.as(t.admin).get('/v2/fields/dependencies?moduleKey=contacts');
    expect(links.body.filter((d: { fieldId: string }) => d.fieldId === ids.city)).toHaveLength(1);
  });

  it('a pair whose option is not a choice of the named field is 422, and nothing is stored', async () => {
    const res = await putCascade('city', {
      dependsOnFieldId: ids.region,
      optionPairs: [pair('state', 'up', 'city', 'delhi')],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(code(res)).toBe('VALIDATION_FAILED');
    const pairs = await api.as(t.admin).get('/v2/fields/option-dependencies?moduleKey=contacts');
    expect(
      pairs.body.filter((p: { childFieldId: string }) => p.childFieldId === ids.city),
    ).toHaveLength(1);
  });

  it('a cascade that would make two properties wait for each other is 409 DEPENDENCY_CYCLE_DETECTED', async () => {
    // city now depends on region, so region may not depend on city
    const res = await api.as(t.admin).put(`/v2/fields/${ids.region}/cascade`).send({
      dependsOnFieldId: ids.city,
      optionPairs: [],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(code(res)).toBe('DEPENDENCY_CYCLE_DETECTED');
  });

  it('a cascade child that is required must always be answered, since its link names no condition', async () => {
    const before = await api.as(t.admin).get(`/v2/fields/${ids.city}`);
    const required = await api
      .as(t.admin)
      .patch(`/v2/fields/${ids.city}`)
      .send({ isRequired: true, rowVersion: before.body.rowVersion });
    expect(required.status, JSON.stringify(required.body)).toBe(200);
    const res = await api
      .as(t.admin)
      .post('/v2/contacts')
      .send({ phone: `+9197${Math.floor(10000000 + Math.random() * 89999999)}`, customFields: {} });
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(code(res)).toBe('CON_REQUIRED_PROPERTY_MISSING');
    expect(res.body.errors).toEqual([{ path: 'customFields.city', message: 'required' }]);
    const after = await api.as(t.admin).get(`/v2/fields/${ids.city}`);
    const back = await api
      .as(t.admin)
      .patch(`/v2/fields/${ids.city}`)
      .send({ isRequired: false, rowVersion: after.body.rowVersion });
    expect(back.status).toBe(200);
  });

  it('removing a cascade takes its link and its pairs; "show only when" rules of the child stay', async () => {
    const gate = await api.as(t.admin).post('/v2/fields/dependencies').send({
      fieldId: ids.city,
      dependsOnFieldId: ids.state,
      dependsOnOptionId: optionIds.state!.up,
    });
    expect(gate.status, JSON.stringify(gate.body)).toBe(201);

    const res = await api.as(t.admin).delete(`/v2/fields/${ids.city}/cascade`);
    expect(res.status, JSON.stringify(res.body)).toBe(204);

    const pairs = await api.as(t.admin).get('/v2/fields/option-dependencies?moduleKey=contacts');
    expect(pairs.body.some((p: { childFieldId: string }) => p.childFieldId === ids.city)).toBe(
      false,
    );
    const links = await api.as(t.admin).get('/v2/fields/dependencies?moduleKey=contacts');
    const left = links.body.filter((d: { fieldId: string }) => d.fieldId === ids.city);
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({
      dependsOnFieldId: ids.state,
      dependsOnOptionId: optionIds.state!.up,
    });
  });

  it('removing the link of a cascade also removes its pairs', async () => {
    const put = await putCascade('city', {
      dependsOnFieldId: ids.region,
      optionPairs: [pair('region', 'north', 'city', 'delhi')],
    });
    expect(put.status, JSON.stringify(put.body)).toBe(204);
    const links = await api.as(t.admin).get('/v2/fields/dependencies?moduleKey=contacts');
    const link = links.body.find(
      (d: { fieldId: string; dependsOnOptionId: string | null; dependsOnValue: string | null }) =>
        d.fieldId === ids.city && d.dependsOnOptionId === null && d.dependsOnValue === null,
    );
    expect(link).toBeDefined();
    const res = await api.as(t.admin).delete(`/v2/fields/dependencies/${link.id}`);
    expect(res.status, JSON.stringify(res.body)).toBe(204);
    const pairs = await api.as(t.admin).get('/v2/fields/option-dependencies?moduleKey=contacts');
    expect(pairs.body.some((p: { childFieldId: string }) => p.childFieldId === ids.city)).toBe(
      false,
    );
  });
});
