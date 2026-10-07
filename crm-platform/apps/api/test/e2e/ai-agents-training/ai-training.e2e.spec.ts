import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseService } from '../../../src/infra/db/database.service';
import type {
  TrainingUrlFetcher,
  TrainingUrlResult,
} from '../../../src/infra/providers/ai-agents-training/training-url-fetcher.port';
import { SourceIngestConsumer } from '../../../src/modules/ai-agents-training/source-ingest.consumer';
import { SOURCE_REQUESTED } from '../../../src/modules/ai-agents-training/source-events';
import { SourcesRepository } from '../../../src/modules/ai-agents-training/sources.repository';
import { SqlAssistantDirectory } from '../../../src/modules/chatbot-widget/_shims/sql-assistant-directory';
import { OutboxSubscriberRegistry } from '../../../src/kernel/outbox/outbox-subscribers';
import { makeDocx, makePdf } from '../../unit/ai-agents-training/fixtures';
import {
  TrainingApi,
  assistantBody,
  fileOnDisk,
  filesUnder,
  startHarness,
  uuidRe,
  type AssistantJson,
  type Harness,
  type SourceJson,
  type Tenant,
} from './support';

/**
 * AI Training end to end through HTTP (WD-AIAG-001..013): permissions, plan gate, the save rules, sources of every kind, duplicate,
 * delete with its files, tenant isolation, the responder mode, and the readers (flow AI node and chat widget) seeing what is written.
 * One app, one throw-away database; each block works in organizations of its own.
 */
let h: Harness;
let api: TrainingApi;
const mediaRoot = mkdtempSync(join(tmpdir(), 'aiag-e2e-'));

beforeAll(async () => {
  process.env.MEDIA_LOCAL_DIR = mediaRoot;
  h = await startHarness();
  api = new TrainingApi(h);
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

const code = (res: { body: { code?: string } }) => res.body.code;
const AS = '/v2/ai-training/assistants';

describe('permissions and plan gate (WD-AIAG-014)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('aip');
  });

  it('without a sign-in every route is 401', async () => {
    for (const [verb, path] of [
      ['get', AS],
      ['get', `${AS}/picker`],
      ['post', AS],
      ['get', '/v2/ai-training/responder'],
      ['put', '/v2/ai-training/responder'],
    ] as const) {
      expect((await api.http()[verb](path)).status, path).toBe(401);
    }
  });

  it('a member with no key is refused with 403 on reads and writes', async () => {
    const a = await api.assistant(t.admin);
    const none = await api.member(t, 'nokeys', [['record.contacts.read']]);
    for (const [verb, path] of [
      ['get', AS],
      ['get', `${AS}/${a.id}`],
      ['get', `${AS}/${a.id}/sources`],
      ['get', '/v2/ai-training/responder'],
    ] as const) {
      expect((await api.as(none.token)[verb](path)).status, path).toBe(403);
    }
    expect((await api.as(none.token).post(AS).send(assistantBody())).status).toBe(403);
  });

  it('each action has its own key', async () => {
    const a = await api.assistant(t.admin, { name: 'Keys' });
    const reader = await api.member(t, 'reader', [['aiag.training.read']]);
    expect((await api.as(reader.token).get(AS)).status).toBe(200);
    expect((await api.as(reader.token).get(`${AS}/${a.id}`)).status).toBe(200);
    expect((await api.as(reader.token).get('/v2/ai-training/responder')).status).toBe(200);
    expect((await api.as(reader.token).post(AS).send(assistantBody())).status).toBe(403);
    expect((await api.as(reader.token).post(`${AS}/${a.id}/duplicate`)).status).toBe(403);
    expect(
      (
        await api
          .as(reader.token)
          .patch(`${AS}/${a.id}`)
          .send({ ...assistantBody(), rowVersion: 1 })
      ).status,
    ).toBe(403);
    expect(
      (
        await api
          .as(reader.token)
          .post(`${AS}/${a.id}/sources`)
          .send({ kind: 'text', label: 'x', content: 'y' })
      ).status,
    ).toBe(403);
    expect((await api.as(reader.token).delete(`${AS}/${a.id}`)).status).toBe(403);
    expect(
      (await api.as(reader.token).put('/v2/ai-training/responder').send({ mode: 'wadesk_only' }))
        .status,
    ).toBe(403);

    const maker = await api.member(t, 'maker', [['aiag.training.read'], ['aiag.training.create']]);
    expect(
      (
        await api
          .as(maker.token)
          .post(AS)
          .send(assistantBody({ name: 'By maker' }))
      ).status,
    ).toBe(201);
    expect((await api.as(maker.token).post(`${AS}/${a.id}/duplicate`)).status).toBe(201);
    expect((await api.as(maker.token).delete(`${AS}/${a.id}`)).status).toBe(403);

    const editor = await api.member(t, 'editor', [
      ['aiag.training.read'],
      ['aiag.training.update'],
    ]);
    expect(
      (
        await api
          .as(editor.token)
          .post(`${AS}/${a.id}/sources`)
          .send({ kind: 'text', label: 'x', content: 'y' })
      ).status,
    ).toBe(201);
    expect((await api.as(editor.token).delete(`${AS}/${a.id}`)).status).toBe(403);

    const deleter = await api.member(t, 'deleter', [
      ['aiag.training.read'],
      ['aiag.training.delete'],
    ]);
    expect((await api.as(deleter.token).delete(`${AS}/${a.id}`)).status).toBe(204);

    const boss = await api.member(t, 'boss', [['aiag.training.read'], ['aiag.responder.manage']]);
    expect(
      (await api.as(boss.token).put('/v2/ai-training/responder').send({ mode: 'wadesk_only' }))
        .status,
    ).toBe(200);
  });

  it('the organization admin holds every key, including the ones this migration seeded', async () => {
    const res = await h.owner.query(
      `SELECT key FROM permission_defs WHERE key LIKE 'aiag.%' ORDER BY key`,
    );
    expect(res.rows.map((r) => r.key)).toEqual([
      'aiag.responder.manage',
      'aiag.training.create',
      'aiag.training.delete',
      'aiag.training.read',
      'aiag.training.update',
    ]);
    expect((await api.as(t.admin).get(AS)).status).toBe(200);
  });

  it('with the plan feature off every route is 422 PLAN_FEATURE_LOCKED and nothing is written', async () => {
    const x = await api.signup('aiplan');
    const a = await api.assistant(x.admin, { name: 'Before the lock' });
    await h.owner.query(`UPDATE org_plan_state SET overrides = $2::jsonb WHERE org_id = $1`, [
      x.orgId,
      JSON.stringify({ features: { ai_assistants: false } }),
    ]);
    for (const res of [
      await api.as(x.admin).get(AS),
      await api.as(x.admin).get(`${AS}/${a.id}`),
      await api
        .as(x.admin)
        .post(AS)
        .send(assistantBody({ name: 'Blocked' })),
      await api.as(x.admin).post(`${AS}/${a.id}/duplicate`),
      await api.as(x.admin).delete(`${AS}/${a.id}`),
      await api.as(x.admin).get('/v2/ai-training/responder'),
    ]) {
      expect(res.status).toBe(422);
      expect(code(res)).toBe('PLAN_FEATURE_LOCKED');
    }
    expect(
      await api.count(`SELECT count(*)::int AS n FROM ai_chat_assistants WHERE org_id = $1`, [
        x.orgId,
      ]),
    ).toBe(1);
  });
});

describe('save an assistant (WD-AIAG-002, 003)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('ais');
  });

  it('a name alone creates an assistant with the wizard defaults, a slug and uuid ids', async () => {
    const res = await api.as(t.admin).post(AS).send({ name: 'Pricing concierge' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const a = res.body as AssistantJson;
    expect(a.id).toMatch(uuidRe);
    expect(a).toMatchObject({
      slug: 'pricing-concierge',
      status: 'active',
      tone: 'helpful',
      language: 'en',
      aiProvider: 'openai',
      aiModel: 'gpt-4o-mini',
      replyMaxTokens: 400,
      temperature: 0.7,
      handoffEnabled: true,
      sourceCount: 0,
      rowVersion: 1,
    });
    expect(JSON.stringify(a)).not.toMatch(/"(org_?id|userId|user_id)"/);
    const row = await h.owner.query(
      `SELECT user_id FROM ai_chat_assistants WHERE org_id = $1 AND uuid = $2`,
      [t.orgId, a.id],
    );
    expect(Number(row.rows[0].user_id)).toBe(t.adminUserId);
  });

  it('a write leaves one audit row and one outbox event in the same transaction', async () => {
    const before = await api.auditCount(t.orgId, 'ai_chat_assistants', 'insert');
    const eventsBefore = (await api.events(t.orgId, 'ai_assistant.created')).length;
    await api.assistant(t.admin, { name: 'Audited' });
    expect(await api.auditCount(t.orgId, 'ai_chat_assistants', 'insert')).toBe(before + 1);
    expect((await api.events(t.orgId, 'ai_assistant.created')).length).toBe(eventsBefore + 1);
  });

  it('the same name twice gets -2, then -3; a name with no letters gets a random slug', async () => {
    const a = await api.assistant(t.admin, { name: 'Support bot' });
    const b = await api.assistant(t.admin, { name: 'Support bot' });
    const c = await api.assistant(t.admin, { name: 'Support bot' });
    expect([a.slug, b.slug, c.slug]).toEqual(['support-bot', 'support-bot-2', 'support-bot-3']);
    const d = await api.assistant(t.admin, { name: '!!!' });
    expect(d.slug).toMatch(/^assistant-[0-9a-f]{6}$/);
  });

  it('two saves of one name racing both succeed with different slugs', async () => {
    const [x, y] = await Promise.all([
      api.as(t.admin).post(AS).send({ name: 'Race' }),
      api.as(t.admin).post(AS).send({ name: 'Race' }),
    ]);
    expect([x.status, y.status]).toEqual([201, 201]);
    expect(new Set([x.body.slug, y.body.slug]).size).toBe(2);
  });

  it.each([
    ['an empty name', { name: '   ' }, 'name'],
    ['a name over 120 characters', { name: 'n'.repeat(121) }, 'name'],
    ['fewer than 50 reply tokens', { replyMaxTokens: 49 }, 'replyMaxTokens'],
    ['more than 4000 reply tokens', { replyMaxTokens: 4001 }, 'replyMaxTokens'],
    ['a fractional token count', { replyMaxTokens: 400.5 }, 'replyMaxTokens'],
    ['a temperature below 0', { temperature: -0.1 }, 'temperature'],
    ['a temperature above 2', { temperature: 2.1 }, 'temperature'],
    ['an unknown provider', { aiProvider: 'skynet' }, 'aiProvider'],
    ['a voice-only provider', { aiProvider: 'deepgram' }, 'aiProvider'],
    ['a status that is not active or paused', { status: 'deleted' }, 'status'],
    ['a model over 80 characters', { aiModel: 'm'.repeat(81) }, 'aiModel'],
    ['a greeting over 1000 characters', { greeting: 'g'.repeat(1001) }, 'greeting'],
    ['a system prompt over 8000 characters', { systemPrompt: 'p'.repeat(8001) }, 'systemPrompt'],
    ['a handoff keyword over 60 characters', { handoffKeyword: 'k'.repeat(61) }, 'handoffKeyword'],
    ['a field the form does not have', { orgId: 1 }, ''],
  ])('%s is refused with 422 and nothing is written', async (_label, over, path) => {
    const before = await api.count(
      `SELECT count(*)::int AS n FROM ai_chat_assistants WHERE org_id = $1`,
      [t.orgId],
    );
    const res = await api.as(t.admin).post(AS).send(assistantBody(over));
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(code(res)).toBe('VALIDATION_FAILED');
    if (path) expect(JSON.stringify(res.body.errors)).toContain(path);
    expect(
      await api.count(`SELECT count(*)::int AS n FROM ai_chat_assistants WHERE org_id = $1`, [
        t.orgId,
      ]),
    ).toBe(before);
  });

  it('the boundaries are accepted: 50 and 4000 tokens, 0 and 2 creativity, a 120-character name', async () => {
    for (const over of [
      { replyMaxTokens: 50, temperature: 0 },
      { replyMaxTokens: 4000, temperature: 2 },
      { name: 'n'.repeat(120) },
    ]) {
      await api.assistant(t.admin, over);
    }
  });

  it('markup in a name is stored as text, never interpreted', async () => {
    const a = await api.assistant(t.admin, { name: '<img src=x onerror=alert(1)>' });
    expect(a.name).toBe('<img src=x onerror=alert(1)>');
    expect(a.slug).toBe('img-src-x-onerror-alert-1');
  });

  it('a NUL character in a text field is a 422, not a 500', async () => {
    const res = await api
      .as(t.admin)
      .post(AS)
      .send(assistantBody({ systemPrompt: 'a\u0000b' }));
    expect(res.status).toBe(422);
  });

  it('an update changes the form, keeps the slug and bumps the row version', async () => {
    const a = await api.assistant(t.admin, { name: 'Before rename' });
    const res = await api
      .as(t.admin)
      .patch(`${AS}/${a.id}`)
      .send({
        ...assistantBody({ name: 'After rename', status: 'paused', temperature: 1.25 }),
        rowVersion: a.rowVersion,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      name: 'After rename',
      slug: a.slug,
      status: 'paused',
      temperature: 1.25,
      rowVersion: a.rowVersion + 1,
    });
    const audit = await h.owner.query(
      `SELECT delta FROM audit_log WHERE org_id = $1 AND module = 'ai_chat_assistants' AND action = 'update' ORDER BY id DESC LIMIT 1`,
      [t.orgId],
    );
    expect(audit.rows[0].delta).toMatchObject({
      name: { old: 'Before rename', new: 'After rename' },
      status: { old: 'active', new: 'paused' },
    });
  });

  it('the prompt text is not copied into the audit trail, only the fact that it changed', async () => {
    const a = await api.assistant(t.admin, { name: 'Prompted', systemPrompt: 'TOP-SECRET-PROMPT' });
    await api
      .as(t.admin)
      .patch(`${AS}/${a.id}`)
      .send({
        ...assistantBody({ name: 'Prompted', systemPrompt: 'NEW-SECRET-PROMPT' }),
        rowVersion: a.rowVersion,
      });
    const all = await h.owner.query(
      `SELECT delta::text AS d FROM audit_log WHERE org_id = $1 AND module = 'ai_chat_assistants'`,
      [t.orgId],
    );
    const text = all.rows.map((r) => r.d).join('\n');
    expect(text).not.toContain('SECRET-PROMPT');
    expect(text).toContain('[changed]');
  });

  it('a field left out of an update keeps its value; one sent blank clears it', async () => {
    const a = await api.assistant(t.admin, {
      name: 'Partial',
      fallbackMessage: 'Keep me',
      greeting: 'Hello',
    });
    const res = await api
      .as(t.admin)
      .patch(`${AS}/${a.id}`)
      .send({ name: 'Partial', greeting: '  ', rowVersion: a.rowVersion });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.fallbackMessage).toBe('Keep me');
    expect(res.body.greeting).toBeNull();
  });

  it('a stale row version is 409 ROW_VERSION_CONFLICT and the second editor changes nothing', async () => {
    const a = await api.assistant(t.admin, { name: 'Contended' });
    const first = await api
      .as(t.admin)
      .patch(`${AS}/${a.id}`)
      .send({ ...assistantBody({ name: 'First' }), rowVersion: a.rowVersion });
    expect(first.status).toBe(200);
    const second = await api
      .as(t.admin)
      .patch(`${AS}/${a.id}`)
      .send({ ...assistantBody({ name: 'Second' }), rowVersion: a.rowVersion });
    expect(second.status).toBe(409);
    expect(code(second)).toBe('ROW_VERSION_CONFLICT');
    expect((await api.as(t.admin).get(`${AS}/${a.id}`)).body.name).toBe('First');
  });

  it('an id that is not in the workspace is 404 (WaDesk created a new assistant)', async () => {
    const before = await api.count(
      `SELECT count(*)::int AS n FROM ai_chat_assistants WHERE org_id = $1`,
      [t.orgId],
    );
    const res = await api
      .as(t.admin)
      .patch(`${AS}/00000000-0000-4000-8000-000000000000`)
      .send({ ...assistantBody(), rowVersion: 1 });
    expect(res.status).toBe(404);
    expect(
      await api.count(`SELECT count(*)::int AS n FROM ai_chat_assistants WHERE org_id = $1`, [
        t.orgId,
      ]),
    ).toBe(before);
    expect((await api.as(t.admin).patch(`${AS}/not-a-uuid`).send({})).status).toBe(422);
  });
});

describe('list, stats and picker (WD-AIAG-001, 004)', () => {
  let t: Tenant;
  const ids: string[] = [];
  beforeAll(async () => {
    t = await api.signup('ail');
    for (let i = 1; i <= 25; i++) {
      ids.push((await api.assistant(t.admin, { name: `Bot ${String(i).padStart(2, '0')}` })).id);
    }
    const paused = ids[0]!;
    const a = (await api.as(t.admin).get(`${AS}/${paused}`)).body as AssistantJson;
    await api
      .as(t.admin)
      .patch(`${AS}/${paused}`)
      .send({ ...assistantBody({ name: a.name, status: 'paused' }), rowVersion: a.rowVersion });
    await api.textSource(t.admin, ids[24]!, 'One');
    await api.textSource(t.admin, ids[24]!, 'Two');
  }, 120_000);

  it('25 assistants: 20 newest first, then the remaining 5 by cursor', async () => {
    const p1 = await api.as(t.admin).get(AS);
    expect(p1.status).toBe(200);
    expect(p1.body.data).toHaveLength(20);
    expect(p1.body.data[0].name).toBe('Bot 25');
    expect(p1.body.page.hasMore).toBe(true);
    const p2 = await api
      .as(t.admin)
      .get(`${AS}?cursor=${encodeURIComponent(p1.body.page.nextCursor)}`);
    expect(p2.body.data).toHaveLength(5);
    expect(p2.body.page.hasMore).toBe(false);
    const names = [...p1.body.data, ...p2.body.data].map((a: AssistantJson) => a.name);
    expect(new Set(names).size).toBe(25);
  });

  it('the stat cards are workspace-wide and ignore the page', async () => {
    const res = await api.as(t.admin).get(`${AS}?limit=2`);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.stats).toEqual({ all: 25, active: 24, sources: 2, ready: 2 });
    expect(res.body.data[0].sourceCount).toBe(2);
  });

  it('the picker lists only active assistants by name, with ready entries counted', async () => {
    await h.owner.query(
      `INSERT INTO ai_training_sources (org_id, assistant_id, kind, label, content, status) VALUES ($1, NULL, 'text', 'Everyone', 'shared', 'ready')`,
      [t.orgId],
    );
    await h.owner.query(
      `INSERT INTO ai_training_sources (org_id, assistant_id, kind, label, content, status) VALUES ($1, NULL, 'url', 'Still reading', NULL, 'processing')`,
      [t.orgId],
    );
    const res = await api.as(t.admin).get(`${AS}/picker`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(24);
    expect(res.body.data[0].name).toBe('Bot 02');
    const withTwo = res.body.data.find((x: { name: string }) => x.name === 'Bot 25');
    expect(withTwo.sources).toBe(3);
    expect(res.body.data.find((x: { name: string }) => x.name === 'Bot 02').sources).toBe(1);
    expect(res.body.data.some((x: { name: string }) => x.name === 'Bot 01')).toBe(false);
  });

  it('an empty workspace lists nothing, with zero stats', async () => {
    const x = await api.signup('aiempty');
    const res = await api.as(x.admin).get(AS);
    expect(res.body.data).toEqual([]);
    expect(res.body.stats).toEqual({ all: 0, active: 0, sources: 0, ready: 0 });
  });

  it('a limit above 100 or below 1 is refused', async () => {
    expect((await api.as(t.admin).get(`${AS}?limit=101`)).status).toBe(422);
    expect((await api.as(t.admin).get(`${AS}?limit=0`)).status).toBe(422);
  });
});

describe('knowledge entries: text, Q&A and URL (WD-AIAG-005..007)', () => {
  let t: Tenant;
  let a: AssistantJson;
  beforeAll(async () => {
    t = await api.signup('aisrc');
    a = await api.assistant(t.admin, { name: 'Sources' });
  });
  const add = (body: Record<string, unknown>) =>
    api.as(t.admin).post(`${AS}/${a.id}/sources`).send(body);

  it('text is ready at once with its token estimate (characters over four, rounded up)', async () => {
    const res = await add({ kind: 'text', label: 'Policy', content: 'x'.repeat(401) });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      kind: 'text',
      label: 'Policy',
      status: 'ready',
      tokensEstimate: 101,
      error: null,
      hasFile: false,
      assistantId: a.id,
    });
    expect(res.body.id).toMatch(uuidRe);
  });

  it('a Q&A pair is ready with the estimate of both sides', async () => {
    const res = await add({
      kind: 'qa',
      label: 'Refunds',
      question: 'How long?',
      answer: 'Five days.',
    });
    expect(res.body).toMatchObject({ status: 'ready', tokensEstimate: Math.ceil((9 + 10) / 4) });
  });

  it.each([
    ['a missing label', { kind: 'text', content: 'x' }, 'label'],
    ['a blank label', { kind: 'text', label: '  ', content: 'x' }, 'label'],
    [
      'a label over 200 characters',
      { kind: 'text', label: 'l'.repeat(201), content: 'x' },
      'label',
    ],
    ['blank text', { kind: 'text', label: 'L', content: '  \n ' }, 'content'],
    ['a Q&A with no answer', { kind: 'qa', label: 'L', question: 'Q?', answer: ' ' }, 'answer'],
    ['a Q&A with no question', { kind: 'qa', label: 'L', answer: 'A' }, 'question'],
    ['a URL entry with no URL', { kind: 'url', label: 'L' }, 'url'],
    [
      'a URL over 1024 characters',
      { kind: 'url', label: 'L', url: `https://e.com/${'p'.repeat(1030)}` },
      'url',
    ],
    ['a kind that does not exist', { kind: 'video', label: 'L' }, ''],
    ['the file kind through the JSON route', { kind: 'file', label: 'L' }, ''],
  ])('%s is refused with 422', async (_l, body, _path) => {
    const before = await api.count(
      `SELECT count(*)::int AS n FROM ai_training_sources WHERE org_id = $1`,
      [t.orgId],
    );
    const res = await add(body);
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(
      await api.count(`SELECT count(*)::int AS n FROM ai_training_sources WHERE org_id = $1`, [
        t.orgId,
      ]),
    ).toBe(before);
  });

  it('a long paste is accepted up to the platform request cap and refused with 413 beyond it', async () => {
    const ok = await add({ kind: 'text', label: 'Big', content: 'y'.repeat(90_000) });
    expect(ok.status).toBe(201);
    expect(ok.body.tokensEstimate).toBe(22_500);
    // WaDesk allowed 200 000 characters of pasted text; the JSON body parser's default cap (100 KiB, platform-infrastructure) is lower.
    const tooBig = await add({ kind: 'text', label: 'Huge', content: 'y'.repeat(200_000) });
    expect(tooBig.status).toBe(413);
    expect(code(tooBig)).toBe('PAYLOAD_TOO_LARGE');
  });

  it('a URL entry starts processing, is never fetched in the request, and queues an outbox event', async () => {
    const res = await add({ kind: 'url', label: 'Pricing', url: 'https://example.com/pricing' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      kind: 'url',
      status: 'processing',
      url: 'https://example.com/pricing',
      tokensEstimate: null,
    });
    const queued = await h.owner.query(
      `SELECT aggregate_id FROM event_outbox WHERE org_id = $1 AND event_type = $2`,
      [t.orgId, SOURCE_REQUESTED],
    );
    expect(queued.rows.length).toBeGreaterThanOrEqual(1);
  });

  it('an entry on an assistant of another workspace is 404 and writes nothing', async () => {
    const x = await api.signup('aisrcx');
    const res = await api
      .as(x.admin)
      .post(`${AS}/${a.id}/sources`)
      .send({ kind: 'text', label: 'Intruder', content: 'x' });
    expect(res.status).toBe(404);
    expect(
      await api.count(
        `SELECT count(*)::int AS n FROM ai_training_sources WHERE label = 'Intruder'`,
      ),
    ).toBe(0);
  });

  it("the list shows the assistant's entries newest first, plus workspace-wide ones", async () => {
    await h.owner.query(
      `INSERT INTO ai_training_sources (org_id, assistant_id, kind, label, content, status) VALUES ($1, NULL, 'text', 'Workspace wide', 'x', 'ready')`,
      [t.orgId],
    );
    const other = await api.assistant(t.admin, { name: 'Other assistant' });
    await api.textSource(t.admin, other.id, 'Only on other');
    const res = await api.as(t.admin).get(`${AS}/${a.id}/sources`);
    expect(res.status).toBe(200);
    const labels = res.body.data.map((s: SourceJson) => s.label);
    expect(labels).toContain('Workspace wide');
    expect(labels).toContain('Policy');
    expect(labels).not.toContain('Only on other');
    const ws = res.body.data.find((s: SourceJson) => s.label === 'Workspace wide');
    expect(ws.assistantId).toBeNull();
    expect(JSON.stringify(res.body)).not.toMatch(/file_?path|content|"question"|"answer"/i);
  });

  it('deleting an entry removes it, leaves one audit row, and a second delete is 404', async () => {
    const s = await api.textSource(t.admin, a.id, 'Temporary');
    expect((await api.as(t.admin).delete(`/v2/ai-training/sources/${s.id}`)).status).toBe(204);
    expect((await api.as(t.admin).delete(`/v2/ai-training/sources/${s.id}`)).status).toBe(404);
    expect(await api.auditCount(t.orgId, 'ai_training_sources', 'delete')).toBeGreaterThanOrEqual(
      1,
    );
  });

  it('a workspace-wide entry can be deleted from the assistant screen (as in WaDesk)', async () => {
    const list = await api.as(t.admin).get(`${AS}/${a.id}/sources`);
    const ws = list.body.data.find((s: SourceJson) => s.label === 'Workspace wide');
    expect((await api.as(t.admin).delete(`/v2/ai-training/sources/${ws.id}`)).status).toBe(204);
  });
});

describe('the worker reads a URL entry (WD-AIAG-007)', () => {
  let t: Tenant;
  let a: AssistantJson;
  let consumer: SourceIngestConsumer;
  let reply: TrainingUrlResult;
  const calls: string[] = [];

  const sourceId = async (uuid: string) =>
    Number(
      (
        await h.owner.query(`SELECT id FROM ai_training_sources WHERE org_id = $1 AND uuid = $2`, [
          t.orgId,
          uuid,
        ])
      ).rows[0].id,
    );
  const event = async (uuid: string) => ({
    id: '1',
    orgId: t.orgId,
    aggregateModule: 'ai_training_sources',
    aggregateId: String(await sourceId(uuid)),
    eventType: SOURCE_REQUESTED,
    payload: {},
  });
  const row = async (uuid: string) =>
    (
      await h.owner.query(
        `SELECT status, content, tokens_estimate, error FROM ai_training_sources WHERE org_id = $1 AND uuid = $2`,
        [t.orgId, uuid],
      )
    ).rows[0];
  const addUrl = async (url: string) =>
    (await api.as(t.admin).post(`${AS}/${a.id}/sources`).send({ kind: 'url', label: 'Page', url }))
      .body as SourceJson;

  beforeAll(async () => {
    t = await api.signup('aiurl');
    a = await api.assistant(t.admin, { name: 'Reader' });
    const fetcher: TrainingUrlFetcher = {
      fetch: async (url) => {
        calls.push(url);
        return reply;
      },
    };
    consumer = new SourceIngestConsumer(
      new OutboxSubscriberRegistry(),
      h.app.get(DatabaseService),
      new SourcesRepository(),
      fetcher,
    );
  });

  it('a page becomes ready with its text and token estimate', async () => {
    reply = {
      ok: true,
      contentType: 'text/html',
      body: '<style>x{}</style><h1>Pricing</h1><script>1</script><p>Plans start at ten dollars.</p>',
    };
    const s = await addUrl('https://example.com/pricing');
    await consumer.handle(await event(s.id));
    const r = await row(s.id);
    expect(r.status).toBe('ready');
    expect(r.content).toBe('Pricing Plans start at ten dollars.');
    expect(r.tokens_estimate).toBe(Math.ceil('Pricing Plans start at ten dollars.'.length / 4));
    expect(r.error).toBeNull();
    const listed = (await api.as(t.admin).get(`${AS}/${a.id}/sources`)).body.data as SourceJson[];
    expect(listed.find((x) => x.id === s.id)).toMatchObject({ status: 'ready', error: null });
  });

  it('a refused or failed fetch settles as failed with the reason, and the event is done', async () => {
    reply = { ok: false, error: 'host resolves to a private/reserved IP: refusing to fetch' };
    const s = await addUrl('http://10.0.0.1/admin');
    await consumer.handle(await event(s.id));
    expect(await row(s.id)).toMatchObject({
      status: 'failed',
      content: null,
      error: 'host resolves to a private/reserved IP: refusing to fetch',
    });
  });

  it('a page with no text fails with "fetched page contained no text"', async () => {
    reply = { ok: true, contentType: null, body: '<div><img src=a></div>' };
    const s = await addUrl('https://example.com/empty');
    await consumer.handle(await event(s.id));
    expect(await row(s.id)).toMatchObject({
      status: 'failed',
      error: 'fetched page contained no text',
    });
  });

  it('a delivered-twice event settles once; an entry already settled is not fetched again', async () => {
    reply = { ok: true, contentType: null, body: '<p>First answer</p>' };
    const s = await addUrl('https://example.com/twice');
    const ev = await event(s.id);
    const before = calls.length;
    await consumer.handle(ev);
    reply = { ok: true, contentType: null, body: '<p>Second answer</p>' };
    await consumer.handle(ev);
    expect(calls.length).toBe(before + 1);
    expect((await row(s.id)).content).toBe('First answer');
  });

  it('an entry deleted while it was being read is left deleted and nothing throws', async () => {
    reply = { ok: true, contentType: null, body: '<p>Late</p>' };
    const s = await addUrl('https://example.com/late');
    const ev = await event(s.id);
    await api.as(t.admin).delete(`/v2/ai-training/sources/${s.id}`);
    await expect(consumer.handle(ev)).resolves.toBeUndefined();
    expect(
      await api.count(`SELECT count(*)::int AS n FROM ai_training_sources WHERE uuid = $1`, [s.id]),
    ).toBe(0);
  });

  it("an event for another workspace's entry does nothing (the transaction is the tenant)", async () => {
    reply = { ok: true, contentType: null, body: '<p>Cross</p>' };
    const s = await addUrl('https://example.com/cross');
    const ev = { ...(await event(s.id)), orgId: t.orgId + 999_999 };
    await consumer.handle(ev);
    expect((await row(s.id)).status).toBe('processing');
  });

  it('a non-numeric aggregate id is ignored', async () => {
    await expect(
      consumer.handle({
        id: '1',
        orgId: t.orgId,
        aggregateModule: 'x',
        aggregateId: 'abc',
        eventType: SOURCE_REQUESTED,
        payload: {},
      }),
    ).resolves.toBeUndefined();
  });
});

describe('file upload (WD-AIAG-008)', () => {
  let t: Tenant;
  let a: AssistantJson;
  beforeAll(async () => {
    t = await api.signup('aifile');
    a = await api.assistant(t.admin, { name: 'Files' });
  });

  it.each([
    [
      'notes.txt',
      Buffer.from('Opening hours are nine to five.'),
      'Opening hours are nine to five.',
    ],
    ['README.md', Buffer.from('# Guide\n\nStep one.'), '# Guide'],
    ['prices.csv', Buffer.from('plan,price\nPro,10'), 'plan,price'],
    ['page.html', Buffer.from('<script>1</script><p>Visible words</p>'), 'Visible words'],
    ['handbook.docx', makeDocx(['Warranty is one year.']), 'Warranty is one year.'],
    ['manual.pdf', makePdf('Returns within thirty days'), 'Returns within thirty days'],
    ['UPPER.TXT', Buffer.from('Case does not matter.'), 'Case does not matter.'],
  ])('%s is read and stored; the response has no path', async (name, data, expected) => {
    const res = await api.upload(t.admin, a.id, { name, data }, `Label for ${name}`);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      kind: 'file',
      status: 'ready',
      hasFile: true,
      label: `Label for ${name}`,
    });
    expect(JSON.stringify(res.body)).not.toMatch(/ai-training\/|file_?path/i);
    const row = await h.owner.query(
      `SELECT content, file_path, tokens_estimate FROM ai_training_sources WHERE org_id = $1 AND uuid = $2`,
      [t.orgId, res.body.id],
    );
    expect(row.rows[0].content).toContain(expected);
    expect(row.rows[0].tokens_estimate).toBe(Math.ceil(row.rows[0].content.trim().length / 4));
    expect(row.rows[0].file_path).toMatch(
      new RegExp(`^ai-training/${t.orgId}/[0-9a-f]{32}\\.[a-z]+$`),
    );
    expect(fileOnDisk(mediaRoot, row.rows[0].file_path)).toBe(true);
  });

  it('the stored name never comes from the client (a traversal in the file name changes nothing)', async () => {
    const res = await api.upload(t.admin, a.id, {
      name: '../../etc/passwd.txt',
      data: Buffer.from('harmless'),
    });
    expect(res.status).toBe(201);
    const keys = await api.fileKeys(t.orgId, a.id);
    for (const k of keys) expect(k).toMatch(/^ai-training\/\d+\/[0-9a-f]{32}\.[a-z]+$/);
  });

  it('a legacy .doc is refused with the re-save hint; other types with the list', async () => {
    const doc = await api.upload(t.admin, a.id, { name: 'old.doc', data: Buffer.from('x') });
    expect(doc.status).toBe(422);
    expect(code(doc)).toBe('AIAG_FILE_TYPE_UNSUPPORTED');
    expect(doc.body.detail ?? doc.body.title).toMatch(/docx/i);
    for (const name of ['run.exe', 'photo.png', 'archive.zip', 'noextension']) {
      const res = await api.upload(t.admin, a.id, { name, data: Buffer.from('x') });
      expect(res.status, name).toBe(422);
      expect(code(res), name).toBe('AIAG_FILE_TYPE_UNSUPPORTED');
    }
  });

  it('a file with no text is 422 AIAG_FILE_NO_TEXT and nothing is stored', async () => {
    const before = (await api.fileKeys(t.orgId)).length;
    for (const [name, data] of [
      ['blank.txt', Buffer.from('   \n  ')],
      ['empty-doc.docx', makeDocx([''])],
      ['markup.html', Buffer.from('<script>1</script>')],
    ] as const) {
      const res = await api.upload(t.admin, a.id, { name, data });
      expect(res.status, name).toBe(422);
      expect(code(res), name).toBe('AIAG_FILE_NO_TEXT');
    }
    expect((await api.fileKeys(t.orgId)).length).toBe(before);
  });

  it('a zero-byte file, a corrupt document and a text file that is binary are refused', async () => {
    expect(
      (await api.upload(t.admin, a.id, { name: 'zero.txt', data: Buffer.alloc(0) })).status,
    ).toBe(422);
    const corrupt = await api.upload(t.admin, a.id, {
      name: 'bad.docx',
      data: Buffer.from('not a zip'),
    });
    expect(corrupt.status).toBe(422);
    expect(code(corrupt)).toBe('AIAG_FILE_UNREADABLE');
    const badPdf = await api.upload(t.admin, a.id, {
      name: 'bad.pdf',
      data: Buffer.from('%PDF-1.4 junk'),
    });
    expect(code(badPdf)).toBe('AIAG_FILE_UNREADABLE');
    const bin = await api.upload(t.admin, a.id, {
      name: 'img.txt',
      data: Buffer.from([0x89, 0x50, 0, 1, 2]),
    });
    expect(code(bin)).toBe('AIAG_FILE_UNREADABLE');
  });

  it('over 10 MB is 413 AIAG_FILE_TOO_LARGE; exactly 10 MB of text is accepted and cut at 200 000 characters', async () => {
    const big = await api.upload(t.admin, a.id, {
      name: 'big.txt',
      data: Buffer.alloc(10 * 1024 * 1024 + 1, 0x61),
    });
    expect(big.status).toBe(413);
    expect(code(big)).toBe('AIAG_FILE_TOO_LARGE');
    const edge = await api.upload(t.admin, a.id, {
      name: 'edge.txt',
      data: Buffer.alloc(10 * 1024 * 1024, 0x61),
    });
    expect(edge.status, JSON.stringify(edge.body)).toBe(201);
    expect(edge.body.tokensEstimate).toBe(50_000);
  }, 60_000);

  it('a missing label or missing file is 422 and stores nothing', async () => {
    const before = (await api.fileKeys(t.orgId)).length;
    expect(
      (await api.upload(t.admin, a.id, { name: 'x.txt', data: Buffer.from('hello') }, null)).status,
    ).toBe(422);
    const noFile = await api
      .as(t.admin)
      .post(`${AS}/${a.id}/sources/file`)
      .field('label', 'No file');
    expect(noFile.status).toBe(422);
    expect((await api.fileKeys(t.orgId)).length).toBe(before);
  });

  it("an upload to another workspace's assistant is 404 and stores nothing", async () => {
    const x = await api.signup('aifilex');
    const res = await api.upload(x.admin, a.id, { name: 'x.txt', data: Buffer.from('hello') });
    expect(res.status).toBe(404);
    expect(filesUnder(mediaRoot, x.orgId)).toEqual([]);
  });

  it('removing the entry removes its stored file', async () => {
    const res = await api.upload(t.admin, a.id, { name: 'gone.txt', data: Buffer.from('bye') });
    const [key] = (await api.fileKeys(t.orgId, a.id)).slice(-1);
    expect(fileOnDisk(mediaRoot, key!)).toBe(true);
    expect((await api.as(t.admin).delete(`/v2/ai-training/sources/${res.body.id}`)).status).toBe(
      204,
    );
    expect(fileOnDisk(mediaRoot, key!)).toBe(false);
  });
});

describe('duplicate and delete (WD-AIAG-003, 004)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('aidup');
  });

  it('a copy is named "(copy)", paused, has a fresh slug and every entry of the original', async () => {
    const a = await api.assistant(t.admin, { name: 'FAQ bot', tone: 'formal', temperature: 1.1 });
    await api.textSource(t.admin, a.id, 'Hours', 'Nine to five');
    await api
      .as(t.admin)
      .post(`${AS}/${a.id}/sources`)
      .send({ kind: 'qa', label: 'Refunds', question: 'Q?', answer: 'A.' });
    const res = await api.as(t.admin).post(`${AS}/${a.id}/duplicate`);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const copy = res.body as AssistantJson;
    expect(copy).toMatchObject({
      name: 'FAQ bot (copy)',
      status: 'paused',
      tone: 'formal',
      temperature: 1.1,
      sourceCount: 2,
      rowVersion: 1,
    });
    expect(copy.id).not.toBe(a.id);
    expect(copy.slug).toMatch(/^faq-bot-copy-[0-9a-f]{4}$/);
    const sources = (await api.as(t.admin).get(`${AS}/${copy.id}/sources`)).body
      .data as SourceJson[];
    expect(sources.map((s) => s.label).sort()).toEqual(['Hours', 'Refunds']);
    expect((await api.as(t.admin).get(`${AS}/${a.id}/sources`)).body.data).toHaveLength(2);
    expect(await api.events(t.orgId, 'ai_assistant.created')).toEqual(
      expect.arrayContaining([expect.objectContaining({ duplicatedFrom: a.id })]),
    );
  });

  it('a copy gets its own stored file: deleting one entry never deletes the file under the other', async () => {
    const a = await api.assistant(t.admin, { name: 'With file' });
    await api.upload(t.admin, a.id, { name: 'doc.txt', data: Buffer.from('shared words') });
    const copy = (await api.as(t.admin).post(`${AS}/${a.id}/duplicate`)).body as AssistantJson;
    const [orig] = await api.fileKeys(t.orgId, a.id);
    const [dup] = await api.fileKeys(t.orgId, copy.id);
    expect(dup).not.toBe(orig);
    expect(fileOnDisk(mediaRoot, orig!) && fileOnDisk(mediaRoot, dup!)).toBe(true);
    const copySources = (await api.as(t.admin).get(`${AS}/${copy.id}/sources`)).body
      .data as SourceJson[];
    await api.as(t.admin).delete(`/v2/ai-training/sources/${copySources[0]!.id}`);
    expect(fileOnDisk(mediaRoot, dup!)).toBe(false);
    expect(fileOnDisk(mediaRoot, orig!)).toBe(true);
  });

  it('a URL entry still being read is copied as processing and queued for the copy as well', async () => {
    const a = await api.assistant(t.admin, { name: 'Reading' });
    await api
      .as(t.admin)
      .post(`${AS}/${a.id}/sources`)
      .send({ kind: 'url', label: 'Page', url: 'https://example.com/x' });
    const copy = (await api.as(t.admin).post(`${AS}/${a.id}/duplicate`)).body as AssistantJson;
    const sources = (await api.as(t.admin).get(`${AS}/${copy.id}/sources`)).body
      .data as SourceJson[];
    expect(sources[0]).toMatchObject({ status: 'processing', kind: 'url' });
    const internal = await api.internalId(t.orgId, copy.id);
    const queued = await h.owner.query(
      `SELECT count(*)::int AS n FROM event_outbox e
         JOIN ai_training_sources s ON s.org_id = e.org_id AND s.id = e.aggregate_id::bigint
       WHERE e.org_id = $1 AND e.event_type = $2 AND s.assistant_id = $3`,
      [t.orgId, SOURCE_REQUESTED, internal],
    );
    expect(queued.rows[0].n).toBe(1);
  });

  it('duplicating one that is not in the workspace is 404 and creates nothing', async () => {
    const before = await api.count(
      `SELECT count(*)::int AS n FROM ai_chat_assistants WHERE org_id = $1`,
      [t.orgId],
    );
    expect(
      (await api.as(t.admin).post(`${AS}/00000000-0000-4000-8000-000000000000/duplicate`)).status,
    ).toBe(404);
    expect(
      await api.count(`SELECT count(*)::int AS n FROM ai_chat_assistants WHERE org_id = $1`, [
        t.orgId,
      ]),
    ).toBe(before);
  });

  it('deleting an assistant removes its entries and their files, leaves workspace-wide entries, and bound widgets keep working', async () => {
    const a = await api.assistant(t.admin, { name: 'To delete' });
    const other = await api.assistant(t.admin, { name: 'Survivor' });
    await api.textSource(t.admin, a.id, 'Mine');
    await api.upload(t.admin, a.id, { name: 'f.txt', data: Buffer.from('to be removed') });
    await api.textSource(t.admin, other.id, 'Theirs');
    await h.owner.query(
      `INSERT INTO ai_training_sources (org_id, assistant_id, kind, label, content, status) VALUES ($1, NULL, 'text', 'Everyone', 'x', 'ready')`,
      [t.orgId],
    );
    const internal = await api.internalId(t.orgId, a.id);
    const [key] = await api.fileKeys(t.orgId, a.id);
    expect(fileOnDisk(mediaRoot, key!)).toBe(true);

    expect((await api.as(t.admin).delete(`${AS}/${a.id}`)).status).toBe(204);
    expect((await api.as(t.admin).get(`${AS}/${a.id}`)).status).toBe(404);
    expect(
      await api.count(
        `SELECT count(*)::int AS n FROM ai_training_sources WHERE org_id = $1 AND assistant_id = $2`,
        [t.orgId, internal],
      ),
    ).toBe(0);
    expect(fileOnDisk(mediaRoot, key!)).toBe(false);
    expect(
      await api.count(
        `SELECT count(*)::int AS n FROM ai_training_sources WHERE org_id = $1 AND label = 'Theirs'`,
        [t.orgId],
      ),
    ).toBe(1);
    expect(
      await api.count(
        `SELECT count(*)::int AS n FROM ai_training_sources WHERE org_id = $1 AND assistant_id IS NULL`,
        [t.orgId],
      ),
    ).toBe(1);
    expect((await api.as(t.admin).delete(`${AS}/${a.id}`)).status).toBe(404);
    expect(await api.auditCount(t.orgId, 'ai_chat_assistants', 'delete')).toBeGreaterThanOrEqual(1);
  });

  it('a widget bound to the deleted assistant is left unbound by the foreign key (set null), not deleted', async () => {
    const a = await api.assistant(t.admin, { name: 'Bound' });
    const internal = await api.internalId(t.orgId, a.id);
    const w = await h.owner.query(
      `INSERT INTO chatbot_widgets (org_id, assistant_id, name, slug, embed_token, mode) VALUES ($1,$2,'W','w-bound-aiag','t-aiag-${Date.now()}','ai') RETURNING id`,
      [t.orgId, internal],
    );
    expect((await api.as(t.admin).delete(`${AS}/${a.id}`)).status).toBe(204);
    const row = await h.owner.query(
      `SELECT assistant_id FROM chatbot_widgets WHERE org_id = $1 AND id = $2`,
      [t.orgId, w.rows[0].id],
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].assistant_id).toBeNull();
  });
});

describe('tenant isolation (WD-AIAG-014)', () => {
  let a: Tenant;
  let b: Tenant;
  let mine: AssistantJson;
  let source: SourceJson;
  beforeAll(async () => {
    a = await api.signup('aita');
    b = await api.signup('aitb');
    mine = await api.assistant(a.admin, { name: 'Org A private' });
    source = await api.textSource(a.admin, mine.id, 'A secret', 'only for org A');
  });

  it('another organization cannot see, edit, duplicate, delete or add to the assistant (404, never 403)', async () => {
    const as = api.as(b.admin);
    expect((await as.get(`${AS}/${mine.id}`)).status).toBe(404);
    expect((await as.get(`${AS}/${mine.id}/sources`)).status).toBe(404);
    expect(
      (
        await as
          .patch(`${AS}/${mine.id}`)
          .send({ ...assistantBody({ name: 'Hijacked' }), rowVersion: 1 })
      ).status,
    ).toBe(404);
    expect((await as.post(`${AS}/${mine.id}/duplicate`)).status).toBe(404);
    expect((await as.delete(`${AS}/${mine.id}`)).status).toBe(404);
    expect((await as.delete(`/v2/ai-training/sources/${source.id}`)).status).toBe(404);
    const row = await h.owner.query(
      `SELECT name FROM ai_chat_assistants WHERE org_id = $1 AND uuid = $2`,
      [a.orgId, mine.id],
    );
    expect(row.rows[0].name).toBe('Org A private');
    expect(
      await api.count(
        `SELECT count(*)::int AS n FROM ai_training_sources WHERE org_id = $1 AND uuid = $2`,
        [a.orgId, source.id],
      ),
    ).toBe(1);
  });

  it('the lists, the picker and the stats of the other organization hold nothing of this one', async () => {
    const list = await api.as(b.admin).get(AS);
    expect(list.body.data).toEqual([]);
    expect(list.body.stats).toEqual({ all: 0, active: 0, sources: 0, ready: 0 });
    expect((await api.as(b.admin).get(`${AS}/picker`)).body.data).toEqual([]);
  });

  it("the database refuses a source that points at another organization's assistant", async () => {
    const internal = await api.internalId(a.orgId, mine.id);
    await expect(
      h.owner.query(
        `INSERT INTO ai_training_sources (org_id, assistant_id, kind, label, content) VALUES ($1, $2, 'text', 'x', 'y')`,
        [b.orgId, internal],
      ),
    ).rejects.toThrow(/foreign key|violates/i);
  });
});

describe('who answers WhatsApp: the responder mode (WD-AIAG-013)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('airesp');
  });

  it('a workspace that never chose answers with our AI and the Meta switch off', async () => {
    const res = await api.as(t.admin).get('/v2/ai-training/responder');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ mode: 'wadesk_only', metaAgentEnabled: false });
  });

  it.each(['wadesk_only', 'meta_agent_only', 'meta_agent_then_handoff'])(
    'saves %s with the switch on and off',
    async (mode) => {
      for (const metaAgentEnabled of [true, false]) {
        const res = await api
          .as(t.admin)
          .put('/v2/ai-training/responder')
          .send({ mode, metaAgentEnabled });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body).toEqual({ mode, metaAgentEnabled });
        expect((await api.as(t.admin).get('/v2/ai-training/responder')).body).toEqual({
          mode,
          metaAgentEnabled,
        });
        const row = await h.owner.query(
          `SELECT ai_responder_mode, meta_agent_enabled FROM workspace_settings WHERE org_id = $1`,
          [t.orgId],
        );
        expect(row.rows[0]).toEqual({
          ai_responder_mode: mode,
          meta_agent_enabled: metaAgentEnabled,
        });
      }
    },
  );

  it('a switch left out is off (an unticked box)', async () => {
    await api
      .as(t.admin)
      .put('/v2/ai-training/responder')
      .send({ mode: 'meta_agent_only', metaAgentEnabled: true });
    const res = await api
      .as(t.admin)
      .put('/v2/ai-training/responder')
      .send({ mode: 'meta_agent_only' });
    expect(res.body).toEqual({ mode: 'meta_agent_only', metaAgentEnabled: false });
  });

  it.each([
    [{ mode: 'both' }],
    [{ mode: '' }],
    [{}],
    [{ mode: 'wadesk_only', metaAgentEnabled: 'yes' }],
    [{ mode: 'wadesk_only', extra: 1 }],
  ])('%j is refused with 422 and nothing changes', async (body) => {
    await api
      .as(t.admin)
      .put('/v2/ai-training/responder')
      .send({ mode: 'wadesk_only', metaAgentEnabled: false });
    const res = await api.as(t.admin).put('/v2/ai-training/responder').send(body);
    expect(res.status).toBe(422);
    expect((await api.as(t.admin).get('/v2/ai-training/responder')).body.mode).toBe('wadesk_only');
  });

  it('a change is audited with old and new, an unchanged save is not, and it is per workspace', async () => {
    const x = await api.signup('airespx');
    const before = await api.auditCount(x.orgId, 'workspace_settings', 'update');
    await api
      .as(x.admin)
      .put('/v2/ai-training/responder')
      .send({ mode: 'meta_agent_then_handoff', metaAgentEnabled: true });
    expect(await api.auditCount(x.orgId, 'workspace_settings', 'update')).toBe(before + 1);
    await api
      .as(x.admin)
      .put('/v2/ai-training/responder')
      .send({ mode: 'meta_agent_then_handoff', metaAgentEnabled: true });
    expect(await api.auditCount(x.orgId, 'workspace_settings', 'update')).toBe(before + 1);
    const audit = await h.owner.query(
      `SELECT delta FROM audit_log WHERE org_id = $1 AND module = 'workspace_settings' ORDER BY id DESC LIMIT 1`,
      [x.orgId],
    );
    expect(audit.rows[0].delta).toMatchObject({
      aiResponderMode: { old: 'wadesk_only', new: 'meta_agent_then_handoff' },
      metaAgentEnabled: { old: false, new: true },
    });
    expect((await api.as(t.admin).get('/v2/ai-training/responder')).body.mode).not.toBe(
      'meta_agent_then_handoff',
    );
  });

  it('saving keeps the other settings of the row (an existing row is updated, not replaced)', async () => {
    const x = await api.signup('airespy');
    await h.owner.query(
      `INSERT INTO workspace_settings (org_id, default_language) VALUES ($1, 'fr')`,
      [x.orgId],
    );
    await api
      .as(x.admin)
      .put('/v2/ai-training/responder')
      .send({ mode: 'meta_agent_only', metaAgentEnabled: true });
    const row = await h.owner.query(
      `SELECT default_language FROM workspace_settings WHERE org_id = $1`,
      [x.orgId],
    );
    expect(row.rows[0].default_language).toBe('fr');
  });
});

describe('the readers see what is written (WD-AIAG-015)', () => {
  it('the flow AI node and the chat widget read ready entries of the assistant and the workspace, never failed, processing or foreign ones', async () => {
    const t = await api.signup('airead');
    const other = await api.signup('aireadx');
    const a = await api.assistant(t.admin, { name: 'Reader' });
    const b = await api.assistant(t.admin, { name: 'Another' });
    await api.textSource(t.admin, a.id, 'Hours', 'Nine to five');
    await api
      .as(t.admin)
      .post(`${AS}/${a.id}/sources`)
      .send({ kind: 'qa', label: 'Refunds', question: 'How long?', answer: 'Five days.' });
    await api.upload(t.admin, a.id, { name: 'f.txt', data: Buffer.from('From a file') });
    await api
      .as(t.admin)
      .post(`${AS}/${a.id}/sources`)
      .send({ kind: 'url', label: 'Pending page', url: 'https://example.com/' });
    await api.textSource(t.admin, b.id, 'Not for Reader', 'x');
    const otherA = await api.assistant(other.admin, { name: 'Foreign' });
    await api.textSource(other.admin, otherA.id, 'Foreign entry', 'x');
    await h.owner.query(
      `INSERT INTO ai_training_sources (org_id, assistant_id, kind, label, content, status, error) VALUES ($1, NULL, 'text', 'Workspace wide', 'Shared', 'ready', NULL), ($1, $2, 'url', 'Broken', NULL, 'failed', 'HTTP 404')`,
      [t.orgId, await api.internalId(t.orgId, a.id)],
    );

    const rows = await h.app
      .get(DatabaseService)
      .txAs({ orgId: t.orgId }, (tx) => new SqlAssistantDirectory().knowledge(tx, t.orgId, 0));
    expect(rows).toEqual([expect.objectContaining({ label: 'Workspace wide' })]);

    const internal = await api.internalId(t.orgId, a.id);
    const forReader = await h.app
      .get(DatabaseService)
      .txAs({ orgId: t.orgId }, (tx) =>
        new SqlAssistantDirectory().knowledge(tx, t.orgId, internal),
      );
    expect(forReader.map((r) => r.label).sort()).toEqual(
      ['Hours', 'A file', 'Refunds', 'Workspace wide'].sort(),
    );
    const qa = forReader.find((r) => r.label === 'Refunds')!;
    expect(qa).toMatchObject({ kind: 'qa', question: 'How long?', answer: 'Five days.' });

    const picker = (await api.as(t.admin).get(`${AS}/picker`)).body.data as Array<{
      name: string;
      sources: number;
    }>;
    expect(picker.find((p) => p.name === 'Reader')!.sources).toBe(4);
  });
});
