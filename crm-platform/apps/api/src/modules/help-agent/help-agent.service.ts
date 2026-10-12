import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  isHelpAgentRouteDisabled,
  type FinishHelpAgentTaskInput,
  type HelpAgentStatus,
  type HelpAgentTaskStarted,
  type SaveHelpAgentSettingsInput,
  type StartHelpAgentTaskInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import type { HelpAgentEnv } from '../../config/domains/help-agent.env';
import { DatabaseService } from '../../infra/db/database.service';
import { HELP_AGENT_ENV } from '../../infra/providers/help-agent/http-help-agent-llm.adapter';
import { AuditService } from '../../kernel/audit/audit.service';
import {
  DAY_MS,
  MINUTE_MS,
  clampCount,
  normalLocale,
  normalRoute,
  windowStart,
} from './help-agent-rules';
import { HelpAgentRepository, type TaskRow } from './help-agent.repository';

const TASK_MODULE = 'help_agent_task';
const SETTINGS_MODULE = 'help_agent_settings';

/**
 * The Help assistant's settings and task lifecycle (docs/specs/help-agent-assistant.md sections 6 and 8): the workspace switch, starting a
 * task under the caps, and closing it with its one audit event. The model call itself is `HelpAgentProxyService`.
 *
 * The plan feature and the permissions are enforced by the controller's decorators; the workspace switch, the screens it is off on and an
 * operator acting as the owner are enforced here, on every call.
 */
@Injectable()
export class HelpAgentService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: HelpAgentRepository,
    private readonly audit: AuditService,
    @Inject(HELP_AGENT_ENV) private readonly env: HelpAgentEnv,
  ) {}

  /** The workspace switch, for the Settings screen. */
  async settings(): Promise<{ enabled: boolean }> {
    const orgId = RequestContextStore.orgId();
    return { enabled: await this.db.tx((tx) => this.repo.enabled(tx, orgId)) };
  }

  async saveSettings(input: SaveHelpAgentSettingsInput): Promise<{ enabled: boolean }> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const was = await this.repo.saveEnabled(tx, ctx.orgId, ctx.userId, input.enabled);
      if (was !== input.enabled) {
        await this.audit.record(tx, {
          module: SETTINGS_MODULE,
          recordId: ctx.orgId,
          action: 'update',
          delta: { enabled: { old: was, new: input.enabled } },
        });
      }
      return { enabled: input.enabled };
    });
  }

  /** Whether the assistant is on for this person right now, and what is left of today's allowance. */
  async status(canManage: boolean): Promise<HelpAgentStatus> {
    const ctx = RequestContextStore.require();
    const userId = ctx.userId;
    const now = new Date();
    const { enabled, used } = await this.db.tx(async (tx) => ({
      enabled: await this.repo.enabled(tx, ctx.orgId),
      used:
        userId === null
          ? 0
          : await this.repo.countStarts(tx, ctx.orgId, userId, windowStart(now, DAY_MS)),
    }));
    return {
      available: enabled && !ctx.impersonation,
      enabled,
      canManage,
      limits: {
        maxSteps: this.env.HELP_AGENT_MAX_STEPS,
        tasksLeftToday: Math.max(0, this.env.HELP_AGENT_TASKS_PER_USER_DAY - used),
      },
    };
  }

  async start(input: StartHelpAgentTaskInput): Promise<HelpAgentTaskStarted> {
    const ctx = RequestContextStore.require();
    const userId = this.userOrThrow(ctx.userId);
    const route = normalRoute(input.route);
    if (route === null || isHelpAgentRouteDisabled(route)) {
      throw new AppError(
        ERROR_CODES.HELP_AGENT_DISABLED,
        'The assistant is turned off on this screen.',
        HttpStatus.FORBIDDEN,
      );
    }
    const now = new Date();
    const started = await this.db.tx(async (tx) => {
      await this.assertOn(tx, ctx.orgId, ctx.impersonation !== undefined);
      await this.repo.lockUser(tx, ctx.orgId, userId);
      // A new task closes the person's earlier one that was never finished (a closed tab), so there is one running task at a time.
      for (const stale of await this.repo.abandonRunning(tx, ctx.orgId, userId)) {
        await this.recordTaskAudit(tx, stale);
      }
      await this.assertCaps(tx, ctx.orgId, userId, now);
      return this.repo.insert(tx, ctx.orgId, userId, {
        locale: normalLocale(input.locale),
        taskLength: input.taskLength,
        route,
      });
    });
    return {
      taskId: started.uuid,
      maxSteps: this.env.HELP_AGENT_MAX_STEPS,
      expiresAt: new Date(
        started.startedAt.getTime() + this.env.HELP_AGENT_TASK_MINUTES * MINUTE_MS,
      ).toISOString(),
    };
  }

  /** Closes a task and writes its one audit event. A second call for the same task changes nothing. */
  async finish(taskId: string, input: FinishHelpAgentTaskInput): Promise<{ status: string }> {
    const ctx = RequestContextStore.require();
    const userId = this.userOrThrow(ctx.userId);
    return this.db.tx(async (tx) => {
      const task = await this.repo.findOwn(tx, ctx.orgId, userId, taskId);
      if (!task) throw AppError.notFound('Task');
      if (task.status !== 'running') return { status: task.status };
      const closed = await this.repo.close(tx, ctx.orgId, task.id, {
        status: input.outcome,
        confirmedActions: clampCount(input.confirmedActions),
        deniedActions: clampCount(input.deniedActions),
      });
      if (closed) await this.recordTaskAudit(tx, closed);
      return { status: input.outcome };
    });
  }

  // --- shared with the proxy -------------------------------------------------------------------------------------------------

  /** Throws 403 `HELP_AGENT_DISABLED` unless the workspace switch is on and nobody is acting as the owner. */
  async assertOn(tx: Tx, orgId: number, impersonating: boolean): Promise<void> {
    if (impersonating || !(await this.repo.enabled(tx, orgId))) {
      throw new AppError(
        ERROR_CODES.HELP_AGENT_DISABLED,
        'The Help assistant is turned off for this workspace.',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  // --- internals -------------------------------------------------------------------------------------------------------------

  private userOrThrow(userId: number | null): number {
    if (userId === null) throw AppError.unauthenticated();
    return userId;
  }

  private async assertCaps(tx: Tx, orgId: number, userId: number, now: Date): Promise<void> {
    const limit = (message: string) =>
      new AppError(ERROR_CODES.HELP_AGENT_TASK_LIMIT, message, HttpStatus.TOO_MANY_REQUESTS);
    if (
      (await this.repo.countStarts(tx, orgId, userId, windowStart(now, MINUTE_MS))) >=
      this.env.HELP_AGENT_TASKS_PER_MINUTE
    ) {
      throw limit('You are starting tasks too fast. Wait a minute and try again.');
    }
    if (
      (await this.repo.countStarts(tx, orgId, userId, windowStart(now, DAY_MS))) >=
      this.env.HELP_AGENT_TASKS_PER_USER_DAY
    ) {
      throw limit('You have used the assistant as much as is allowed per day. Try again tomorrow.');
    }
    if (
      (await this.repo.countStarts(tx, orgId, null, windowStart(now, DAY_MS))) >=
      this.env.HELP_AGENT_TASKS_PER_ORG_DAY
    ) {
      throw limit('Your workspace has used the assistant as much as is allowed per day.');
    }
  }

  /**
   * The one audit event of a task: who (the actor of the request), the outcome, the steps, the confirmed actions and the length of the
   * task sentence. The sentence itself is never stored (docs/specs/help-agent-assistant.md section 7, decision 3f).
   */
  private async recordTaskAudit(tx: Tx, task: TaskRow): Promise<void> {
    await this.audit.record(tx, {
      module: TASK_MODULE,
      recordId: task.id,
      action: 'update',
      delta: {
        status: { old: 'running', new: task.status },
        steps: { old: 0, new: task.steps },
        confirmedActions: { old: 0, new: task.confirmedActions },
        deniedActions: { old: 0, new: task.deniedActions },
        taskLength: { old: null, new: task.taskLength },
      },
    });
  }
}
