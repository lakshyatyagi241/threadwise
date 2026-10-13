import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../../src/common/errors/app-error';
import { HelpAgentLlmError } from '../../../src/infra/providers/help-agent/help-agent-llm.port';
import { baseCtx, build, goodBody } from './fixtures';

const codeOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
  } catch (err) {
    if (err instanceof AppError) return err.code;
    throw err;
  }
  return 'NO_ERROR';
};

const startTask = async (t: ReturnType<typeof build>, ctx = baseCtx()) =>
  t.as(() => t.agent.start({ locale: 'en', taskLength: 12, route: '/contacts' }), ctx);

afterEach(() => vi.restoreAllMocks());

describe('help agent: starting a task', () => {
  it('refuses when the workspace switch is off (the default)', async () => {
    const t = build();
    expect(await codeOf(startTask(t))).toBe(ERROR_CODES.HELP_AGENT_DISABLED);
    expect(t.repo.tasks).toHaveLength(0);
  });

  it('opens a task when the switch is on, and reports the budget', async () => {
    const t = build();
    t.repo.enabledByOrg.set(1, true);
    const started = await startTask(t);
    expect(started.maxSteps).toBe(25);
    expect(started.taskId).toMatch(/^[0-9a-f-]{36}$/);
    expect(t.repo.tasks[0]).toMatchObject({
      taskLength: 12,
      route: '/contacts',
      status: 'running',
    });
  });

  it('refuses on the screens where the assistant is off, even with a hand-made request', async () => {
    const t = build();
    t.repo.enabledByOrg.set(1, true);
    for (const route of ['/inbox', '/inbox/5', '/team-chat', '/admin/plans']) {
      const code = await codeOf(t.as(() => t.agent.start({ locale: 'en', taskLength: 3, route })));
      expect(code).toBe(ERROR_CODES.HELP_AGENT_DISABLED);
    }
    expect(t.repo.tasks).toHaveLength(0);
  });

  it('refuses while an operator acts as the owner', async () => {
    const t = build();
    t.repo.enabledByOrg.set(1, true);
    const ctx = baseCtx({
      impersonation: {
        sessionId: 's',
        operatorId: 1,
        operatorUuid: 'u',
        readOnly: false,
        expiresAt: new Date(Date.now() + 1000),
      },
    });
    expect(await codeOf(startTask(t, ctx))).toBe(ERROR_CODES.HELP_AGENT_DISABLED);
  });

  it('caps tasks per minute, per person per day and per workspace per day', async () => {
    const t = build({ HELP_AGENT_TASKS_PER_MINUTE: '2' });
    t.repo.enabledByOrg.set(1, true);
    await startTask(t);
    await startTask(t);
    expect(await codeOf(startTask(t))).toBe(ERROR_CODES.HELP_AGENT_TASK_LIMIT);

    const day = build({ HELP_AGENT_TASKS_PER_USER_DAY: '1' });
    day.repo.enabledByOrg.set(1, true);
    await startTask(day);
    expect(await codeOf(startTask(day))).toBe(ERROR_CODES.HELP_AGENT_TASK_LIMIT);

    const org = build({ HELP_AGENT_TASKS_PER_ORG_DAY: '2' });
    org.repo.enabledByOrg.set(1, true);
    await startTask(org, baseCtx({ userId: 10, actorId: 10 }));
    await startTask(org, baseCtx({ userId: 11, actorId: 11 }));
    expect(await codeOf(startTask(org, baseCtx({ userId: 12, actorId: 12 })))).toBe(
      ERROR_CODES.HELP_AGENT_TASK_LIMIT,
    );
  });

  it('closes the earlier unfinished task of the same person (one running task at a time) and audits it', async () => {
    const t = build();
    t.repo.enabledByOrg.set(1, true);
    await startTask(t);
    await startTask(t);
    expect(t.repo.tasks.map((x) => x.status)).toEqual(['abandoned', 'running']);
    expect(t.audit.rows).toHaveLength(1);
    expect(t.audit.rows[0]).toMatchObject({ module: 'help_agent_task', action: 'update' });
  });
});

describe('help agent: the model proxy', () => {
  async function ready(envOver: Record<string, string> = {}) {
    const t = build(envOver);
    t.repo.enabledByOrg.set(1, true);
    const started = await startTask(t);
    return { t, taskId: started.taskId };
  }

  it("answers through the port with the server's model, key and output size, never the browser's", async () => {
    const { t, taskId } = await ready();
    const body = { ...goodBody, model: 'gpt-expensive', max_tokens: 100000 };
    const out = await t.as(() => t.proxy.complete(taskId, body));
    expect(out).toMatchObject({ id: 'c1' });
    expect(t.port.calls).toHaveLength(1);
    expect(t.port.calls[0]).toMatchObject({
      provider: 'openai',
      model: 'platform-default-model',
      apiKey: 'sk-secret-platform-key',
      maxTokens: 1000,
    });
    expect(JSON.stringify(t.port.calls[0]!.messages)).not.toContain('gpt-expensive');
  });

  it('writes one metering row per call, billed to the side that paid, and counts the tokens on the task', async () => {
    const { t, taskId } = await ready();
    await t.as(() => t.proxy.complete(taskId, goodBody));
    expect(t.meter.guarded).toEqual([1]); // the platform pays, so the monthly allowance is asked
    expect(t.meter.recorded).toHaveLength(1);
    expect(t.meter.recorded[0]).toMatchObject({
      orgId: 1,
      viaTx: true,
      usage: {
        provider: 'openai',
        model: 'platform-default-model',
        promptTokens: 120,
        completionTokens: 30,
        billedAgainst: 'admin',
      },
    });
    expect(t.repo.tasks[0]).toMatchObject({ steps: 1, promptTokens: 120, completionTokens: 30 });
  });

  it('bills a workspace key to the workspace and does not ask the platform allowance', async () => {
    const { t, taskId } = await ready({ HELP_AGENT_MODEL: 'gpt-configured' });
    t.keys.resolved = { key: 'sk-workspace', source: 'workspace', model: null };
    await t.as(() => t.proxy.complete(taskId, goodBody));
    expect(t.meter.guarded).toEqual([]);
    expect(t.meter.recorded[0]!.usage.billedAgainst).toBe('workspace');
  });

  it('is unavailable when a workspace key brings no model and none is configured', async () => {
    const { t, taskId } = await ready();
    t.keys.resolved = { key: 'sk-workspace', source: 'workspace', model: null };
    expect(await codeOf(t.as(() => t.proxy.complete(taskId, goodBody)))).toBe(
      ERROR_CODES.HELP_AGENT_PROVIDER_UNAVAILABLE,
    );
    expect(t.port.calls).toHaveLength(0);
  });

  it('uses the configured model when there is one', async () => {
    const { t, taskId } = await ready({ HELP_AGENT_MODEL: 'gpt-configured' });
    t.keys.resolved = { key: 'sk-workspace', source: 'workspace', model: null };
    await t.as(() => t.proxy.complete(taskId, goodBody));
    expect(t.port.calls[0]!.model).toBe('gpt-configured');
  });

  it('refuses when the switch is turned off in the middle of a task', async () => {
    const { t, taskId } = await ready();
    t.repo.enabledByOrg.set(1, false);
    expect(await codeOf(t.as(() => t.proxy.complete(taskId, goodBody)))).toBe(
      ERROR_CODES.HELP_AGENT_DISABLED,
    );
    expect(t.port.calls).toHaveLength(0);
  });

  it('stops at the step budget, on the server', async () => {
    const { t, taskId } = await ready({ HELP_AGENT_MAX_STEPS: '2' });
    await t.as(() => t.proxy.complete(taskId, goodBody));
    await t.as(() => t.proxy.complete(taskId, goodBody));
    expect(await codeOf(t.as(() => t.proxy.complete(taskId, goodBody)))).toBe(
      ERROR_CODES.HELP_AGENT_STEP_LIMIT,
    );
    expect(t.port.calls).toHaveLength(2);
  });

  it('stops at the token allowance of the task', async () => {
    const { t, taskId } = await ready({ HELP_AGENT_TASK_TOKENS: '1000' });
    t.port.next = { completion: { id: 'big' }, promptTokens: 990, completionTokens: 20 };
    await t.as(() => t.proxy.complete(taskId, goodBody));
    expect(await codeOf(t.as(() => t.proxy.complete(taskId, goodBody)))).toBe(
      ERROR_CODES.HELP_AGENT_STEP_LIMIT,
    );
  });

  it('refuses a finished task and an expired one', async () => {
    const { t, taskId } = await ready();
    await t.as(() =>
      t.agent.finish(taskId, {
        outcome: 'completed',
        steps: 1,
        confirmedActions: 0,
        deniedActions: 0,
      }),
    );
    expect(await codeOf(t.as(() => t.proxy.complete(taskId, goodBody)))).toBe(
      ERROR_CODES.HELP_AGENT_TASK_CLOSED,
    );

    const old = build();
    old.repo.enabledByOrg.set(1, true);
    old.repo.startedAtOverride = new Date(Date.now() - 16 * 60_000);
    const s = await startTask(old);
    expect(await codeOf(old.as(() => old.proxy.complete(s.taskId, goodBody)))).toBe(
      ERROR_CODES.HELP_AGENT_TASK_CLOSED,
    );
  });

  it('keeps tenants apart: another workspace or another person cannot use the task id', async () => {
    const { t, taskId } = await ready();
    const other = baseCtx({ orgId: 2 });
    t.repo.enabledByOrg.set(2, true);
    expect(await codeOf(t.as(() => t.proxy.complete(taskId, goodBody), other))).toBe(
      ERROR_CODES.NOT_FOUND,
    );
    const colleague = baseCtx({ userId: 11, actorId: 11 });
    expect(await codeOf(t.as(() => t.proxy.complete(taskId, goodBody), colleague))).toBe(
      ERROR_CODES.NOT_FOUND,
    );
    expect(
      await codeOf(
        t.as(
          () =>
            t.agent.finish(taskId, {
              outcome: 'stopped',
              steps: 0,
              confirmedActions: 0,
              deniedActions: 0,
            }),
          colleague,
        ),
      ),
    ).toBe(ERROR_CODES.NOT_FOUND);
    expect(t.port.calls).toHaveLength(0);
  });

  it('refuses a call with no task header', async () => {
    const { t } = await ready();
    expect(await codeOf(t.as(() => t.proxy.complete(undefined, goodBody)))).toBe(
      ERROR_CODES.HELP_AGENT_REQUEST_INVALID,
    );
    expect(await codeOf(t.as(() => t.proxy.complete('not-a-uuid', goodBody)))).toBe(
      ERROR_CODES.HELP_AGENT_REQUEST_INVALID,
    );
  });

  it('says so, with a stable code, when no AI key is configured', async () => {
    const { t, taskId } = await ready();
    t.keys.resolved = { key: null, source: 'none', model: null };
    expect(await codeOf(t.as(() => t.proxy.complete(taskId, goodBody)))).toBe(
      ERROR_CODES.HELP_AGENT_PROVIDER_UNAVAILABLE,
    );
    expect(t.port.calls).toHaveLength(0);
    expect(t.meter.recorded).toHaveLength(0);
  });

  it('passes the monthly allowance refusal through unchanged', async () => {
    const { t, taskId } = await ready();
    t.meter.guardError = new AppError(ERROR_CODES.PLAN_LIMIT_REACHED, 'used up', 422);
    expect(await codeOf(t.as(() => t.proxy.complete(taskId, goodBody)))).toBe(
      ERROR_CODES.PLAN_LIMIT_REACHED,
    );
    expect(t.port.calls).toHaveLength(0);
  });

  it('turns a vendor failure into HELP_AGENT_PROVIDER_UNAVAILABLE without the vendor text, and writes no ledger row', async () => {
    const { t, taskId } = await ready();
    t.port.next = new HelpAgentLlmError(429, 'quota: sk-secret-platform-key leaked in vendor text');
    const err = await t.as(() => t.proxy.complete(taskId, goodBody)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe(ERROR_CODES.HELP_AGENT_PROVIDER_UNAVAILABLE);
    expect(JSON.stringify((err as AppError).getResponse())).not.toContain('sk-secret');
    expect(t.meter.recorded).toHaveLength(0);
  });

  it('never logs the request, the answer, the page text or the key', async () => {
    const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map((m) =>
      vi.spyOn(Logger.prototype, m).mockImplementation(() => undefined),
    );
    const { t, taskId } = await ready();
    t.port.next = {
      completion: { id: 'c2', choices: [{ message: { content: 'ANSWER-TEXT-XYZ' } }] },
      promptTokens: 5,
      completionTokens: 5,
    };
    await t.as(() => t.proxy.complete(taskId, goodBody));
    t.port.next = new HelpAgentLlmError(500, 'boom');
    await t.as(() => t.proxy.complete(taskId, goodBody)).catch(() => undefined);

    const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls));
    expect(logged).toContain('help-agent');
    for (const secret of [
      '9876543210',
      'Maria',
      'page text',
      'ANSWER-TEXT-XYZ',
      'sk-secret-platform-key',
      'rules',
    ]) {
      expect(logged).not.toContain(secret);
    }
  });
});

describe('help agent: finishing a task', () => {
  it('writes one audit event with counts and no task text, and a second finish changes nothing', async () => {
    const t = build();
    t.repo.enabledByOrg.set(1, true);
    const started = await startTask(t);
    await t.as(() => t.proxy.complete(started.taskId, goodBody));
    const first = await t.as(() =>
      t.agent.finish(started.taskId, {
        outcome: 'completed',
        steps: 99,
        confirmedActions: 2,
        deniedActions: 1,
      }),
    );
    const second = await t.as(() =>
      t.agent.finish(started.taskId, {
        outcome: 'failed',
        steps: 99,
        confirmedActions: 9,
        deniedActions: 9,
      }),
    );
    expect(first).toEqual({ status: 'completed' });
    expect(second).toEqual({ status: 'completed' });
    expect(t.audit.rows).toHaveLength(1);
    const row = t.audit.rows[0]!;
    expect(row).toMatchObject({ module: 'help_agent_task', action: 'update' });
    expect(row.delta).toMatchObject({
      status: { old: 'running', new: 'completed' },
      // the step count is the server's (one model call), not the browser's claim
      steps: { new: 1 },
      confirmedActions: { new: 2 },
      deniedActions: { new: 1 },
      taskLength: { new: 12 },
    });
    expect(JSON.stringify(row)).not.toMatch(/Maria|page text/);
  });

  it('audits the workspace switch only when it changes', async () => {
    const t = build();
    await t.as(() => t.agent.saveSettings({ enabled: true }));
    await t.as(() => t.agent.saveSettings({ enabled: true }));
    await t.as(() => t.agent.saveSettings({ enabled: false }));
    expect(t.audit.rows.map((r) => r.module)).toEqual([
      'help_agent_settings',
      'help_agent_settings',
    ]);
    expect(t.audit.rows[0]!.delta).toEqual({ enabled: { old: false, new: true } });
  });

  it('reports availability and what is left today', async () => {
    const t = build({ HELP_AGENT_TASKS_PER_USER_DAY: '5' });
    expect((await t.as(() => t.agent.status(false))).available).toBe(false);
    t.repo.enabledByOrg.set(1, true);
    await startTask(t);
    const s = await t.as(() => t.agent.status(true));
    expect(s).toMatchObject({ available: true, enabled: true, canManage: true });
    expect(s.limits).toEqual({ maxSteps: 25, tasksLeftToday: 4 });
  });
});
