import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Logger } from '@nestjs/common';
import {
  HELP_AGENT_LLM_PORT,
  HelpAgentLlmError,
  type HelpAgentLlmPort,
  type HelpAgentLlmRequest,
  type HelpAgentLlmResult,
} from '../../../src/infra/providers/help-agent/help-agent-llm.port';
import { KeyVault } from '../../../src/modules/ai-keys-usage-admin/key-vault';
import { Api, bearer, type Tenant } from '../contacts-attributes-tags/support';
import { installBodyLimits } from '../../../src/modules/platform-infrastructure/body-limits/body-limits';
import { startHarness, type Harness } from '../auth-registration-security/harness';

/**
 * The Help assistant end to end through HTTP: the real app, a real Postgres as the restricted role, real Redis, the real controllers,
 * guards, plan gate, permission check, key resolver, token meter and audit. Only the AI vendor is fake (a recording stand-in on the
 * port), so no request ever leaves the machine and no real key exists.
 */
const PLATFORM_KEY = 'sk-test-PLATFORM-help-agent-0123456789';
const PAGE_TEXT = 'Maria Lopez +44 20 7946 0958 maria@example.com';

let h: Harness;
let api: Api;
let admin: Tenant;

interface FakeLlm {
  calls: HelpAgentLlmRequest[];
  next: HelpAgentLlmResult | Error;
}
const llm: FakeLlm = { calls: [], next: reply() };

function reply(prompt = 120, completion = 30): HelpAgentLlmResult {
  return {
    completion: {
      id: 'fake-1',
      object: 'chat.completion',
      model: 'fake-model',
      choices: [
        {
          index: 0,
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              { id: 'c1', type: 'function', function: { name: 'AgentOutput', arguments: '{}' } },
            ],
          },
        },
      ],
      usage: {
        prompt_tokens: prompt,
        completion_tokens: completion,
        total_tokens: prompt + completion,
      },
    },
    promptTokens: prompt,
    completionTokens: completion,
  };
}

const body = (extra: Record<string, unknown> = {}) => ({
  model: 'attacker-chosen-model',
  messages: [
    { role: 'system', content: 'rules' },
    { role: 'user', content: PAGE_TEXT },
  ],
  tools: [{ type: 'function', function: { name: 'AgentOutput', parameters: { type: 'object' } } }],
  tool_choice: { type: 'function', function: { name: 'AgentOutput' } },
  ...extra,
});

async function planFeature(t: Tenant, on: boolean, limits: Record<string, number> = {}) {
  await h.owner.query(`UPDATE org_plan_state SET overrides = $2::jsonb WHERE org_id = $1`, [
    t.orgId,
    JSON.stringify({ features: { help_agent: on }, limits }),
  ]);
}
const flip = (t: Tenant, enabled: boolean) =>
  api.as(t.admin).put('/v2/help-agent/settings').send({ enabled });
const start = (token: string, route = '/contacts') =>
  api.as(token).post('/v2/help-agent/tasks').send({ locale: 'en', taskLength: 24, route });
const complete = (token: string, taskId: string, b: unknown = body()) =>
  api
    .http()
    .post('/v2/help-agent/chat/completions')
    .set(bearer(token))
    .set('x-help-agent-task', taskId)
    .send(b as object);

beforeAll(async () => {
  Object.assign(process.env, {
    HELP_AGENT_MAX_STEPS: '3',
    HELP_AGENT_TASKS_PER_MINUTE: '4',
    HELP_AGENT_TASKS_PER_USER_DAY: '50',
  });
  // main.ts installs the body-size classes before routing; the harness does not, so a spec that tests a size limit installs them.
  h = await startHarness({ configureApp: (app) => installBodyLimits(app as never) });
  api = new Api(h);
  const port = h.app.get<HelpAgentLlmPort>(HELP_AGENT_LLM_PORT as never);
  port.complete = async (req) => {
    llm.calls.push(req);
    if (llm.next instanceof Error) throw llm.next;
    return llm.next;
  };
  // The platform's OpenAI key, sealed the way the AI keys screen seals it.
  const sealed = h.app.get(KeyVault, { strict: false }).seal(PLATFORM_KEY);
  await h.owner.query(
    `UPDATE admin_ai_keys SET api_key = $1, key_last4 = $2, default_model = 'fake-model', is_active = true WHERE provider = 'openai'`,
    [sealed.cipher, sealed.last4],
  );
}, 300_000);

afterAll(async () => {
  await h?.stop();
});

beforeEach(async () => {
  llm.calls.length = 0;
  llm.next = reply();
  admin = await api.signup('hlp');
  await planFeature(admin, true);
});

describe('help agent: the three switches', () => {
  it('is invisible on a plan that does not include it', async () => {
    await planFeature(admin, false);
    for (const res of [
      await api.as(admin.admin).get('/v2/help-agent/status'),
      await start(admin.admin),
      await api.as(admin.admin).get('/v2/help-agent/settings'),
    ]) {
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('PLAN_FEATURE_LOCKED');
    }
  });

  it('is off in a workspace until the switch is turned on', async () => {
    const status = await api.as(admin.admin).get('/v2/help-agent/status');
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ available: false, enabled: false, canManage: true });
    const task = await start(admin.admin);
    expect(task.status).toBe(403);
    expect(task.body.code).toBe('HELP_AGENT_DISABLED');
    expect(llm.calls).toHaveLength(0);
  });

  it('is refused to a member without the permission, even with the switch on', async () => {
    await flip(admin, true);
    const nobody = await api.member(admin, 'nobody', [['record.contacts.read']]);
    expect((await api.as(nobody.token).get('/v2/help-agent/status')).status).toBe(403);
    expect((await start(nobody.token)).status).toBe(403);
    expect((await complete(nobody.token, '00000000-0000-4000-8000-000000000000')).status).toBe(403);
  });

  it('lets a member with only "use" work, but not turn the switch on or off', async () => {
    await flip(admin, true);
    const user = await api.member(admin, 'user', [['help.agent.use']]);
    expect((await start(user.token)).status).toBe(201);
    expect(
      (await api.as(user.token).put('/v2/help-agent/settings').send({ enabled: false })).status,
    ).toBe(403);
    expect((await api.as(user.token).get('/v2/help-agent/settings')).status).toBe(403);
    expect((await api.as(user.token).get('/v2/help-agent/status')).body).toMatchObject({
      available: true,
      canManage: false,
    });
  });

  it('audits the switch only when it changes', async () => {
    await flip(admin, true);
    await flip(admin, true);
    await flip(admin, false);
    expect(await api.auditCount(admin.orgId, 'help_agent_settings', 'update')).toBe(2);
    const rows = await h.owner.query(
      `SELECT delta FROM audit_log WHERE org_id = $1 AND module = 'help_agent_settings' ORDER BY id`,
      [admin.orgId],
    );
    expect(rows.rows[0].delta).toEqual({ enabled: { old: false, new: true } });
  });

  it('validates the settings body', async () => {
    expect(
      (await api.as(admin.admin).put('/v2/help-agent/settings').send({ enabled: 'yes' })).status,
    ).toBe(422);
  });
});

describe('help agent: a task', () => {
  beforeEach(async () => {
    await flip(admin, true);
  });

  it('opens on an ordinary screen and refuses the screens where customer text lives', async () => {
    const ok = await start(admin.admin, '/contacts?x=1#top');
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ maxSteps: 3 });
    expect(ok.body.taskId).toMatch(/^[0-9a-f-]{36}$/);
    const row = await h.owner.query(
      `SELECT route, task_length, status FROM help_agent_tasks WHERE org_id = $1`,
      [admin.orgId],
    );
    expect(row.rows).toEqual([{ route: '/contacts', task_length: 24, status: 'running' }]);
    for (const route of ['/inbox', '/inbox/12', '/team-chat', '/admin/plans']) {
      const res = await start(admin.admin, route);
      expect(res.status, route).toBe(403);
      expect(res.body.code).toBe('HELP_AGENT_DISABLED');
    }
  });

  it("answers a model call through the fake vendor with the server's own model and the platform key", async () => {
    const { taskId } = (await start(admin.admin)).body;
    const res = await complete(admin.admin, taskId);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.choices[0].message.tool_calls[0].function.name).toBe('AgentOutput');
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]).toMatchObject({
      provider: 'openai',
      model: 'fake-model',
      apiKey: PLATFORM_KEY,
    });
    expect(JSON.stringify(llm.calls[0]!.messages)).not.toContain('attacker-chosen-model');
    // the key never goes back to the browser
    expect(JSON.stringify(res.body)).not.toContain(PLATFORM_KEY);
  });

  it('writes one ledger row per call, billed to the platform, and counts the tokens on the task', async () => {
    const { taskId } = (await start(admin.admin)).body;
    await complete(admin.admin, taskId);
    await complete(admin.admin, taskId);
    const ledger = await h.owner.query(
      `SELECT provider, model, prompt_tokens, completion_tokens, total_tokens, billed_against FROM ai_token_usage WHERE org_id = $1 ORDER BY id`,
      [admin.orgId],
    );
    expect(ledger.rows).toEqual([
      {
        provider: 'openai',
        model: 'fake-model',
        prompt_tokens: 120,
        completion_tokens: 30,
        total_tokens: 150,
        billed_against: 'admin',
      },
      {
        provider: 'openai',
        model: 'fake-model',
        prompt_tokens: 120,
        completion_tokens: 30,
        total_tokens: 150,
        billed_against: 'admin',
      },
    ]);
    const task = await h.owner.query(
      `SELECT steps, prompt_tokens::int AS p, completion_tokens::int AS c FROM help_agent_tasks WHERE org_id = $1`,
      [admin.orgId],
    );
    expect(task.rows[0]).toEqual({ steps: 2, p: 240, c: 60 });
  });

  it('stops at the step budget on the server, whatever the browser says', async () => {
    const { taskId } = (await start(admin.admin)).body;
    for (let i = 0; i < 3; i++) expect((await complete(admin.admin, taskId)).status).toBe(200);
    const fourth = await complete(admin.admin, taskId);
    expect(fourth.status).toBe(429);
    expect(fourth.body.code).toBe('HELP_AGENT_STEP_LIMIT');
    expect(llm.calls).toHaveLength(3);
    expect(
      (
        await h.owner.query(`SELECT count(*)::int AS n FROM ai_token_usage WHERE org_id = $1`, [
          admin.orgId,
        ])
      ).rows[0].n,
    ).toBe(3);
  });

  it('caps task starts per minute, and a new task closes the earlier unfinished one', async () => {
    for (let i = 0; i < 4; i++) expect((await start(admin.admin)).status).toBe(201);
    const fifth = await start(admin.admin);
    expect(fifth.status).toBe(429);
    expect(fifth.body.code).toBe('HELP_AGENT_TASK_LIMIT');
    const states = await h.owner.query(
      `SELECT status, count(*)::int AS n FROM help_agent_tasks WHERE org_id = $1 GROUP BY status ORDER BY status`,
      [admin.orgId],
    );
    expect(states.rows).toEqual([
      { status: 'abandoned', n: 3 },
      { status: 'running', n: 1 },
    ]);
  });

  it('refuses a model call with no task, a bad task id, a finished task and a stream', async () => {
    const noHeader = await api.as(admin.admin).post('/v2/help-agent/chat/completions').send(body());
    expect(noHeader.status).toBe(400);
    expect(noHeader.body.code).toBe('HELP_AGENT_REQUEST_INVALID');
    expect((await complete(admin.admin, 'not-a-uuid')).status).toBe(400);
    const { taskId } = (await start(admin.admin)).body;
    const stream = await complete(admin.admin, taskId, body({ stream: true }));
    expect(stream.status).toBe(400);
    expect(stream.body.code).toBe('HELP_AGENT_REQUEST_INVALID');
    await api
      .as(admin.admin)
      .post(`/v2/help-agent/tasks/${taskId}/finish`)
      .send({ outcome: 'completed', steps: 0, confirmedActions: 0, deniedActions: 0 });
    const closed = await complete(admin.admin, taskId);
    expect(closed.status).toBe(409);
    expect(closed.body.code).toBe('HELP_AGENT_TASK_CLOSED');
    expect(llm.calls).toHaveLength(0);
  });

  it('reads a request of up to the contract size and refuses a bigger one before it reaches the service', async () => {
    const { taskId } = (await start(admin.admin)).body;
    const big = body({ messages: [{ role: 'user', content: 'x'.repeat(200_000) }] });
    const tooManyChars = await complete(admin.admin, taskId, big);
    expect(tooManyChars.status).toBe(400); // parsed (under 512 KiB), refused by the 120,000-character rule
    expect(tooManyChars.body.code).toBe('HELP_AGENT_REQUEST_INVALID');
    const huge = body({ messages: [{ role: 'user', content: 'x'.repeat(700_000) }] });
    expect((await complete(admin.admin, taskId, huge)).status).toBe(413);
    expect(llm.calls).toHaveLength(0);
  });

  it('turning the switch off stops a task that is running, at its next step', async () => {
    const { taskId } = (await start(admin.admin)).body;
    expect((await complete(admin.admin, taskId)).status).toBe(200);
    await flip(admin, false);
    const res = await complete(admin.admin, taskId);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('HELP_AGENT_DISABLED');
  });
});

describe('help agent: failures are clear and leak nothing', () => {
  beforeEach(async () => {
    await flip(admin, true);
  });

  it('says the vendor failed, without its text, and records no usage', async () => {
    const { taskId } = (await start(admin.admin)).body;
    llm.next = new HelpAgentLlmError(401, `bad key ${PLATFORM_KEY} and ${PAGE_TEXT}`);
    const res = await complete(admin.admin, taskId);
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('HELP_AGENT_PROVIDER_UNAVAILABLE');
    expect(res.body.requestId).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toContain(PLATFORM_KEY);
    expect(JSON.stringify(res.body)).not.toContain('Maria');
    expect(
      (
        await h.owner.query(`SELECT count(*)::int AS n FROM ai_token_usage WHERE org_id = $1`, [
          admin.orgId,
        ])
      ).rows[0].n,
    ).toBe(0);
  });

  it('says so when the platform has no active key for the vendor', async () => {
    const { taskId } = (await start(admin.admin)).body;
    await h.owner.query(`UPDATE admin_ai_keys SET is_active = false WHERE provider = 'openai'`);
    try {
      const res = await complete(admin.admin, taskId);
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('HELP_AGENT_PROVIDER_UNAVAILABLE');
      expect(llm.calls).toHaveLength(0);
    } finally {
      await h.owner.query(`UPDATE admin_ai_keys SET is_active = true WHERE provider = 'openai'`);
    }
  });

  it('refuses once the workspace used its monthly AI allowance', async () => {
    await planFeature(admin, true, { ai_token_limit_monthly: 100 });
    await h.owner.query(
      `INSERT INTO ai_token_usage (org_id, provider, total_tokens, billed_against) VALUES ($1,'openai',100,'admin')`,
      [admin.orgId],
    );
    const { taskId } = (await start(admin.admin)).body;
    const res = await complete(admin.admin, taskId);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('PLAN_LIMIT_REACHED');
    expect(llm.calls).toHaveLength(0);
  });

  it('never logs the page text, the answer or the key', async () => {
    const lines: string[] = [];
    const original = ['log', 'warn', 'error', 'debug', 'verbose'].map((m) => {
      const fn = (Logger.prototype as unknown as Record<string, (...a: unknown[]) => void>)[m]!;
      (Logger.prototype as unknown as Record<string, unknown>)[m] = (...a: unknown[]) =>
        void lines.push(JSON.stringify(a));
      return [m, fn] as const;
    });
    try {
      const { taskId } = (await start(admin.admin)).body;
      await complete(admin.admin, taskId);
      llm.next = new HelpAgentLlmError(500, PAGE_TEXT);
      await complete(admin.admin, taskId);
    } finally {
      for (const [m, fn] of original)
        (Logger.prototype as unknown as Record<string, unknown>)[m] = fn;
    }
    const logged = lines.join('\n');
    expect(logged).toContain('help-agent');
    for (const secret of ['Maria', '9876', 'maria@example.com', PLATFORM_KEY, 'rules'])
      expect(logged).not.toContain(secret);
  });
});

describe('help agent: the audit event and tenant isolation', () => {
  beforeEach(async () => {
    await flip(admin, true);
  });

  it('writes one audit event per task with counts and no text, and a second finish changes nothing', async () => {
    const { taskId } = (await start(admin.admin)).body;
    await complete(admin.admin, taskId);
    const a = await api
      .as(admin.admin)
      .post(`/v2/help-agent/tasks/${taskId}/finish`)
      .send({ outcome: 'completed', steps: 99, confirmedActions: 2, deniedActions: 1 });
    const b = await api
      .as(admin.admin)
      .post(`/v2/help-agent/tasks/${taskId}/finish`)
      .send({ outcome: 'failed', steps: 1, confirmedActions: 9, deniedActions: 9 });
    expect(a.body).toEqual({ status: 'completed' });
    expect(b.body).toEqual({ status: 'completed' });
    const rows = await h.owner.query(
      `SELECT actor_id, delta FROM audit_log WHERE org_id = $1 AND module = 'help_agent_task'`,
      [admin.orgId],
    );
    expect(rows.rows).toHaveLength(1);
    expect(Number(rows.rows[0].actor_id)).toBe(admin.adminUserId);
    expect(rows.rows[0].delta).toMatchObject({
      status: { old: 'running', new: 'completed' },
      steps: { new: 1 },
      confirmedActions: { new: 2 },
      deniedActions: { new: 1 },
      taskLength: { new: 24 },
    });
    expect(JSON.stringify(rows.rows[0].delta)).not.toMatch(/Maria|rules/);
  });

  it('keeps tenants apart: another workspace cannot use or close a task id, and sees none of the rows', async () => {
    const other = await api.signup('hlp2');
    await planFeature(other, true);
    await flip(other, true);
    const { taskId } = (await start(admin.admin)).body;

    const use = await complete(other.admin, taskId);
    expect(use.status).toBe(404);
    const close = await api
      .as(other.admin)
      .post(`/v2/help-agent/tasks/${taskId}/finish`)
      .send({ outcome: 'stopped', steps: 0, confirmedActions: 0, deniedActions: 0 });
    expect(close.status).toBe(404);
    expect(llm.calls).toHaveLength(0);

    // a colleague in the SAME workspace cannot either: a task belongs to the person who started it
    const colleague = await api.member(admin, 'colleague', [['help.agent.use']]);
    expect((await complete(colleague.token, taskId)).status).toBe(404);

    await start(other.admin);
    const mine = await h.owner.query(
      `SELECT org_id FROM help_agent_tasks WHERE org_id IN ($1, $2) ORDER BY org_id`,
      [admin.orgId, other.orgId],
    );
    expect(new Set(mine.rows.map((r) => Number(r.org_id)))).toEqual(
      new Set([admin.orgId, other.orgId]),
    );
    // each workspace's own usage ledger holds only its own calls
    expect(
      (
        await h.owner.query(`SELECT count(*)::int AS n FROM ai_token_usage WHERE org_id = $1`, [
          other.orgId,
        ])
      ).rows[0].n,
    ).toBe(0);
  });
});
