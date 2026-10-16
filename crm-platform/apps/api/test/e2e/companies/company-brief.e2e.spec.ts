import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiKeyResolver } from '../../../src/modules/ai-keys-usage-admin';
import {
  DealsApi,
  startHarness,
  type Grant,
  type Harness,
  type Tenant,
} from '../deals-pipelines/support';

/**
 * "Generate brief" (BL-194) end to end through HTTP with a fake model: a local server that answers the OpenAI chat-completions dialect,
 * so the real adapter, key choice, metering, record scopes, cache, cooldown and audit all run, and no real AI call is ever made. What the
 * model is sent is read back from what the fake received.
 */
let h: Harness;
let api: DealsApi;
let t: Tenant;
let fake: Server;
let received: Array<{
  auth: string | undefined;
  body: { messages: Array<{ role: string; content: string }> };
}> = [];
let mode: 'ok' | 'http500' | 'prose' = 'ok';

const BRIEF = {
  summary: 'Acme is a logistics account with one open deal.',
  sections: [
    { key: 'deals', bullets: ['One open deal'] },
    { key: 'nextSteps', bullets: ['Call about the quote'] },
  ],
};

let keySource: 'workspace' | 'none' = 'workspace';

beforeAll(async () => {
  fake = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      received.push({ auth: req.headers.authorization, body: JSON.parse(raw || '{}') });
      if (mode === 'http500') {
        res.statusCode = 500;
        res.end('{}');
        return;
      }
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          choices: [
            {
              message: { content: mode === 'prose' ? 'Sure, here you go!' : JSON.stringify(BRIEF) },
            },
          ],
          usage: { prompt_tokens: 321, completion_tokens: 54 },
        }),
      );
    });
  });
  await new Promise<void>((ok) => fake.listen(0, '127.0.0.1', ok));
  process.env.FLR_AI_OPENAI_BASE_URL = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;

  h = await startHarness();
  api = new DealsApi(h);
  // Key storage is the AI keys domain's own test; here the choice of key is fixed so the brief's behaviour is what is under test.
  const resolver = h.app.get(AiKeyResolver);
  vi.spyOn(resolver, 'resolve').mockImplementation(async (_org, provider) =>
    keySource === 'workspace' && provider === 'openai'
      ? { key: 'sk-test-fake-0123456789', source: 'workspace', model: null }
      : { key: null, source: 'none', model: null },
  );
  t = await api.signup('brief');
}, 240_000);

afterAll(async () => {
  vi.restoreAllMocks();
  delete process.env.FLR_AI_OPENAI_BASE_URL;
  await new Promise((ok) => fake?.close(ok));
  await h?.stop();
});

beforeEach(() => {
  received = [];
  mode = 'ok';
  keySource = 'workspace';
});

const code = (res: { body: { code?: string } }) => res.body.code;
const sentToModel = () =>
  received.map((r) => r.body.messages.map((m) => m.content).join('\n')).join('\n');
let phone = 8_000_000;
const nextPhone = () => `+9198${String(phone++).padStart(8, '0')}`;

let acme: { id: string };
beforeAll(async () => {
  const section = await api
    .as(t.admin)
    .post('/v2/field-sections')
    .send({ moduleKey: 'companies', name: 'Account' });
  for (const body of [
    { key: 'tier', label: 'Tier', fieldType: 'text' },
    { key: 'secret', label: 'Secret', fieldType: 'text', isMasked: true },
  ]) {
    const res = await api
      .as(t.admin)
      .post('/v2/fields')
      .send({ moduleKey: 'companies', sectionId: section.body.id, ...body });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  }
  const created = await api
    .as(t.admin)
    .post('/v2/companies')
    .send({
      name: 'Acme Ltd',
      industry: 'Logistics',
      email: 'accounts@acme.example',
      phone: '+919800000001',
      address: '12 Hidden Street',
      notes: 'Ask for Aarav on aarav@acme.example or +91 98123 45678 about renewal',
      customFields: { tier: 'gold', secret: 'hunter2-top-secret' },
    });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  acme = created.body;
  for (const [name, email] of [
    ['Aarav Sharma', 'aarav@acme.example'],
    ['Priya Nair', 'priya@acme.example'],
  ]) {
    const c = await api
      .as(t.admin)
      .post('/v2/contacts')
      .send({ name, email, phone: nextPhone(), companyId: acme.id });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
  }
  const { pipeline } = await api.defaultPipeline(t.admin);
  await api.deal(t.admin, {
    title: 'Renewal Q4 for Acme',
    value: '1500.00',
    pipelineId: pipeline.id,
    companyId: acme.id,
  });
  const task = await api
    .as(t.admin)
    .post('/v2/tasks')
    .send({ title: 'Send the quote', companyId: acme.id, dueAt: '2026-01-01T09:00:00.000Z' });
  expect(task.status, JSON.stringify(task.body)).toBe(201);
}, 120_000);

/** Moves the briefs back in time (the touch trigger stamps every update, so it is switched off for this one statement). */
async function ageBriefs() {
  await h.owner.query(`ALTER TABLE company_briefs DISABLE TRIGGER trg_company_briefs_touch`);
  await h.owner.query(
    `UPDATE company_briefs SET updated_at = now() - interval '5 minutes' WHERE org_id = $1`,
    [t.orgId],
  );
  await h.owner.query(`ALTER TABLE company_briefs ENABLE TRIGGER trg_company_briefs_touch`);
}
const state = (token = t.admin, id = acme.id) => api.as(token).get(`/v2/companies/${id}/brief`);
const generate = (body: object = {}, token = t.admin, id = acme.id) =>
  api.as(token).post(`/v2/companies/${id}/brief`).send(body);

describe('Generate brief', () => {
  it('says a brief can be written and that there is none yet, calling no model', async () => {
    const res = await state();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.available).toBe(true);
    expect(res.body.brief).toBeNull();
    expect(res.body.sources).toEqual({
      properties: true,
      contacts: true,
      deals: true,
      tasks: true,
      conversations: true,
    });
    expect(received).toHaveLength(0);
  });

  it('writes a brief with the workspace key, and sends the model facts without any personal detail', async () => {
    const res = await generate();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.cached).toBe(false);
    expect(res.body.brief.content.summary).toBe(BRIEF.summary);
    expect(res.body.brief.content.sections.map((s: { key: string }) => s.key)).toEqual([
      'deals',
      'nextSteps',
    ]);
    expect(res.body.brief.stale).toBe(false);

    expect(received).toHaveLength(1);
    expect(received[0]!.auth).toBe('Bearer sk-test-fake-0123456789');
    const sent = sentToModel();
    // what the brief is about
    expect(sent).toContain('Acme Ltd');
    expect(sent).toContain('Renewal Q4 for Acme');
    expect(sent).toContain('Send the quote');
    expect(sent).toContain('gold');
    // what must never leave: contact names, emails, phones, the company's own email, phone, address, a masked property
    for (const secret of [
      'Aarav',
      'Priya',
      'Sharma',
      'acme.example',
      '98123',
      '9800000001',
      '12 Hidden Street',
      'hunter2',
    ]) {
      expect(sent, secret).not.toContain(secret);
    }
    // the company notes (free text that names people) are not sent at all
    expect(sent).not.toContain('renewal about');
    expect(sent).not.toContain('Ask for');
  });

  it('meters the tokens against the workspace and audits the generation without the facts', async () => {
    const ledger = await h.owner.query(
      `SELECT provider, prompt_tokens, completion_tokens, billed_against FROM ai_token_usage WHERE org_id = $1 ORDER BY id DESC LIMIT 1`,
      [t.orgId],
    );
    expect(ledger.rows[0]).toMatchObject({
      provider: 'openai',
      prompt_tokens: 321,
      completion_tokens: 54,
      billed_against: 'workspace',
    });
    const audit = await h.owner.query(
      `SELECT delta FROM audit_log WHERE org_id = $1 AND module = 'company_briefs' ORDER BY id DESC LIMIT 1`,
      [t.orgId],
    );
    expect(JSON.stringify(audit.rows[0].delta)).not.toContain('Acme');
    expect(JSON.stringify(audit.rows[0].delta)).toContain('billedAgainst');
  });

  it('returns the stored brief for the same facts without calling the model again', async () => {
    const again = await generate();
    expect(again.status).toBe(200);
    expect(again.body.cached).toBe(true);
    expect(received).toHaveLength(0);
    const s = await state();
    expect(s.body.brief.content.summary).toBe(BRIEF.summary);
  });

  it('a change in the CRM makes the stored brief stale, and a second generation within 30 seconds is refused', async () => {
    const task = await api
      .as(t.admin)
      .post('/v2/tasks')
      .send({ title: 'Prepare the renewal call', companyId: acme.id });
    expect(task.status).toBe(201);
    expect((await state()).body.brief.stale).toBe(true);
    const tooSoon = await generate({ regenerate: true });
    expect(tooSoon.status).toBe(429);
    expect(code(tooSoon)).toBe('COMPANY_BRIEF_RATE_LIMITED');
    expect(received).toHaveLength(0);
  });

  it('regenerates once the cooldown has passed, replacing the stored brief', async () => {
    await ageBriefs();
    const res = await generate({ regenerate: true });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.cached).toBe(false);
    expect(received).toHaveLength(1);
    expect(sentToModel()).toContain('Prepare the renewal call');
    expect(
      (
        await h.owner.query(`SELECT count(*)::int AS n FROM company_briefs WHERE org_id = $1`, [
          t.orgId,
        ])
      ).rows[0].n,
    ).toBe(1);
  });

  it('is the caller own: a colleague has no brief until they ask, and their record scopes decide what is counted', async () => {
    const rep = await api.member(t, 'briefrep', [
      ['record.companies.read'],
      ['record.contacts.read', 'own'],
    ] as Grant[]);
    const s = await state(rep.token);
    expect(s.status, JSON.stringify(s.body)).toBe(200);
    expect(s.body.brief).toBeNull();
    // no deal, task or conversation permission: those kinds are not read at all
    expect(s.body.sources).toEqual({
      properties: false,
      contacts: true,
      deals: false,
      tasks: false,
      conversations: false,
    });
    const res = await generate({}, rep.token);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const sent = sentToModel();
    expect(sent).toContain('Acme Ltd');
    expect(sent).not.toContain('Renewal Q4 for Acme');
    expect(sent).not.toContain('Send the quote');
    expect(sent).not.toContain('"gold"');
    // contacts the rep does not own are not counted
    expect(sent).toContain('"total":0');
  });

  it('a company outside the caller scope is 404, and a caller who cannot read companies is 403', async () => {
    const own = await api.member(t, 'ownonly', [['record.companies.read', 'own']] as Grant[]);
    const res = await state(own.token);
    expect(res.status).toBe(404);
    expect((await generate({}, own.token)).status).toBe(404);
    const nothing = await api.member(t, 'nothing', [['record.contacts.read']] as Grant[]);
    expect((await state(nothing.token)).status).toBe(403);
    expect((await generate({}, nothing.token)).status).toBe(403);
  });

  it('with no AI key it says so and sends nothing anywhere', async () => {
    keySource = 'none';
    const s = await state();
    expect(s.body.available).toBe(false);
    const res = await generate({ regenerate: true });
    expect(res.status).toBe(422);
    expect(code(res)).toBe('COMPANY_BRIEF_AI_UNAVAILABLE');
    expect(received).toHaveLength(0);
  });

  it('a failing provider is a 502 that keeps the stored brief', async () => {
    await ageBriefs();
    mode = 'http500';
    const res = await generate({ regenerate: true });
    expect(res.status).toBe(502);
    expect(code(res)).toBe('COMPANY_BRIEF_PROVIDER_FAILED');
    expect((await state()).body.brief.content.summary).toBe(BRIEF.summary);
  });

  it('an answer that is not a brief is a 502 too', async () => {
    await ageBriefs();
    mode = 'prose';
    const res = await generate({ regenerate: true });
    expect(res.status).toBe(502);
    expect(code(res)).toBe('COMPANY_BRIEF_PROVIDER_FAILED');
  });

  it('is removed with its company', async () => {
    const del = await api.as(t.admin).delete(`/v2/companies/${acme.id}`);
    expect(del.status).toBe(204);
    expect(
      (
        await h.owner.query(`SELECT count(*)::int AS n FROM company_briefs WHERE org_id = $1`, [
          t.orgId,
        ])
      ).rows[0].n,
    ).toBe(0);
  });
});
