import { randomUUID } from 'node:crypto';
import type { Tx } from '@crm/db';
import {
  RequestContextStore,
  type RequestContext,
} from '../../../src/common/context/request-context';
import { readHelpAgentEnv, type HelpAgentEnv } from '../../../src/config/domains/help-agent.env';
import type {
  HelpAgentLlmPort,
  HelpAgentLlmRequest,
  HelpAgentLlmResult,
} from '../../../src/infra/providers/help-agent/help-agent-llm.port';
import { HelpAgentProxyService } from '../../../src/modules/help-agent/help-agent-proxy.service';
import type {
  HelpAgentRepository,
  TaskRow,
} from '../../../src/modules/help-agent/help-agent.repository';
import { HelpAgentService } from '../../../src/modules/help-agent/help-agent.service';

/** In-memory stand-in for the repository: the same rules as the SQL (own task only, one statement for the budget). */
export class FakeRepo {
  enabledByOrg = new Map<number, boolean>();
  tasks: Array<TaskRow & { orgId: number }> = [];
  startedAtOverride: Date | null = null;
  private seq = 1;

  async enabled(_tx: Tx, orgId: number) {
    return this.enabledByOrg.get(orgId) === true;
  }
  async saveEnabled(_tx: Tx, orgId: number, _user: number | null, enabled: boolean) {
    const was = this.enabledByOrg.get(orgId) === true;
    this.enabledByOrg.set(orgId, enabled);
    return was;
  }
  async lockUser() {
    // the real repository takes an advisory lock here; the in-memory one needs none
    return undefined;
  }
  async countStarts(_tx: Tx, orgId: number, userId: number | null, since: Date) {
    return this.tasks.filter(
      (t) => t.orgId === orgId && (userId === null || t.userId === userId) && t.startedAt >= since,
    ).length;
  }
  async abandonRunning(_tx: Tx, orgId: number, userId: number) {
    const hit = this.tasks.filter(
      (t) => t.orgId === orgId && t.userId === userId && t.status === 'running',
    );
    for (const t of hit) t.status = 'abandoned';
    return hit;
  }
  async insert(
    _tx: Tx,
    orgId: number,
    userId: number,
    input: { taskLength: number; route: string },
  ) {
    const row = {
      orgId,
      id: this.seq++,
      uuid: randomUUID(),
      userId,
      status: 'running',
      steps: 0,
      confirmedActions: 0,
      deniedActions: 0,
      taskLength: input.taskLength,
      route: input.route,
      promptTokens: 0,
      completionTokens: 0,
      startedAt: this.startedAtOverride ?? new Date(),
    };
    this.tasks.push(row);
    return row;
  }
  async findOwn(_tx: Tx, orgId: number, userId: number, uuid: string) {
    return (
      this.tasks.find((t) => t.orgId === orgId && t.userId === userId && t.uuid === uuid) ?? null
    );
  }
  async reserveStep(
    _tx: Tx,
    orgId: number,
    id: number,
    l: { maxSteps: number; maxTokens: number },
  ) {
    const t = this.tasks.find((x) => x.orgId === orgId && x.id === id);
    if (
      !t ||
      t.status !== 'running' ||
      t.steps >= l.maxSteps ||
      t.promptTokens + t.completionTokens >= l.maxTokens
    ) {
      return null;
    }
    t.steps += 1;
    return t.steps;
  }
  async addTokens(_tx: Tx, orgId: number, id: number, k: { prompt: number; completion: number }) {
    const t = this.tasks.find((x) => x.orgId === orgId && x.id === id)!;
    t.promptTokens += k.prompt;
    t.completionTokens += k.completion;
  }
  async close(
    _tx: Tx,
    orgId: number,
    id: number,
    d: { status: string; confirmedActions: number; deniedActions: number },
  ) {
    const t = this.tasks.find((x) => x.orgId === orgId && x.id === id);
    if (!t || t.status !== 'running') return null;
    t.status = d.status;
    t.confirmedActions = d.confirmedActions;
    t.deniedActions = d.deniedActions;
    return t;
  }
}

export class FakeDb {
  async tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return fn({} as Tx);
  }
}

export class FakeAudit {
  rows: Array<{
    module: string;
    recordId: number;
    action: string;
    delta?: Record<string, unknown>;
  }> = [];
  async record(
    _tx: Tx,
    input: { module: string; recordId: number; action: string; delta?: Record<string, unknown> },
  ) {
    this.rows.push(input);
  }
}

export class FakePort implements HelpAgentLlmPort {
  calls: HelpAgentLlmRequest[] = [];
  next: HelpAgentLlmResult | Error = {
    completion: { id: 'c1', choices: [{ message: { role: 'assistant', tool_calls: [] } }] },
    promptTokens: 120,
    completionTokens: 30,
  };
  async complete(req: HelpAgentLlmRequest): Promise<HelpAgentLlmResult> {
    this.calls.push(req);
    if (this.next instanceof Error) throw this.next;
    return this.next;
  }
}

export class FakeKeys {
  resolved: { key: string | null; source: 'admin' | 'workspace' | 'none'; model: string | null } = {
    key: 'sk-secret-platform-key',
    source: 'admin',
    model: 'platform-default-model',
  };
  async resolve() {
    return this.resolved;
  }
  async capMaxTokens(_provider: string, requested: number) {
    return Math.min(requested, 1000);
  }
}

export class FakeMeter {
  guarded: number[] = [];
  recorded: Array<{ orgId: number; usage: Record<string, unknown>; viaTx: boolean }> = [];
  guardError: Error | null = null;
  async guard(orgId: number) {
    this.guarded.push(orgId);
    if (this.guardError) throw this.guardError;
  }
  async record(orgId: number, usage: Record<string, unknown>, tx?: Tx) {
    this.recorded.push({ orgId, usage, viaTx: tx !== undefined });
  }
}

export const baseCtx = (over: Partial<RequestContext> = {}): RequestContext => ({
  requestId: 'req-1',
  orgId: 1,
  actorType: 'user',
  actorId: 10,
  userId: 10,
  ...over,
});

export function build(envOver: Record<string, string> = {}) {
  const env: HelpAgentEnv = readHelpAgentEnv(envOver);
  const repo = new FakeRepo();
  const db = new FakeDb();
  const audit = new FakeAudit();
  const port = new FakePort();
  const keys = new FakeKeys();
  const meter = new FakeMeter();
  const agent = new HelpAgentService(
    db as never,
    repo as unknown as HelpAgentRepository,
    audit as never,
    env,
  );
  const proxy = new HelpAgentProxyService(
    db as never,
    repo as unknown as HelpAgentRepository,
    agent,
    keys as never,
    meter as never,
    port,
    env,
  );
  const as = <T>(fn: () => Promise<T>, ctx: RequestContext = baseCtx()): Promise<T> =>
    RequestContextStore.run(ctx, fn);
  return { env, repo, db, audit, port, keys, meter, agent, proxy, as };
}

export const goodBody = {
  messages: [
    { role: 'system', content: 'rules' },
    { role: 'user', content: 'page text Maria 9876543210' },
  ],
  tools: [{ type: 'function', function: { name: 'AgentOutput', parameters: { type: 'object' } } }],
  tool_choice: { type: 'function', function: { name: 'AgentOutput' } },
};
