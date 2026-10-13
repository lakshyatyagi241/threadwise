import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ERROR_CODES } from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import type { HelpAgentEnv } from '../../config/domains/help-agent.env';
import { DatabaseService } from '../../infra/db/database.service';
import {
  HELP_AGENT_LLM_PORT,
  HelpAgentLlmError,
  type HelpAgentLlmPort,
} from '../../infra/providers/help-agent/help-agent-llm.port';
import { HELP_AGENT_ENV } from '../../infra/providers/help-agent/http-help-agent-llm.adapter';
import { AiKeyResolver, AiTokenMeter } from '../ai-keys-usage-admin';
import { sanitiseCompletionRequest, taskExpired } from './help-agent-rules';
import { HelpAgentRepository } from './help-agent.repository';
import { HelpAgentService } from './help-agent.service';

/**
 * The model door of the Help assistant (docs/specs/help-agent-assistant.md sections 4, 5 and 6.5): the browser's library asks here, and
 * only here is a vendor key ever used.
 *
 * Per call: the task must be the caller's own and open; the workspace switch is read again (turning it off takes effect on the next
 * step); the request is cut down to the parts the proxy trusts; the key is resolved the way every AI domain does it (the workspace's own
 * when its plan allows, else the platform's); the monthly allowance is asked when the platform pays; the step is taken from the budget in
 * one statement; the vendor is called behind the port; the tokens go to the AI usage ledger and onto the task.
 *
 * Nothing in the request or the answer is logged: only ids and counts.
 */
@Injectable()
export class HelpAgentProxyService {
  private readonly logger = new Logger(HelpAgentProxyService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: HelpAgentRepository,
    private readonly agent: HelpAgentService,
    private readonly keys: AiKeyResolver,
    private readonly meter: AiTokenMeter,
    @Inject(HELP_AGENT_LLM_PORT) private readonly port: HelpAgentLlmPort,
    @Inject(HELP_AGENT_ENV) private readonly env: HelpAgentEnv,
  ) {}

  async complete(taskId: string | undefined, body: unknown): Promise<Record<string, unknown>> {
    const ctx = RequestContextStore.require();
    if (ctx.userId === null) throw AppError.unauthenticated();
    const userId = ctx.userId;
    const orgId = ctx.orgId;
    if (!taskId || !/^[0-9a-f-]{36}$/i.test(taskId)) {
      throw new AppError(
        ERROR_CODES.HELP_AGENT_REQUEST_INVALID,
        'Start a task first.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const request = sanitiseCompletionRequest(body, {
      maxChars: this.env.HELP_AGENT_REQUEST_CHARS,
    });
    const provider = this.env.HELP_AGENT_PROVIDER;

    // 1. The task, the switch and the step, in one transaction so a rejected call takes no step.
    const reserved = await this.db.tx(async (tx) => {
      await this.agent.assertOn(tx, orgId, ctx.impersonation !== undefined);
      const task = await this.repo.findOwn(tx, orgId, userId, taskId);
      if (!task) throw AppError.notFound('Task');
      if (
        task.status !== 'running' ||
        taskExpired(task.startedAt, new Date(), this.env.HELP_AGENT_TASK_MINUTES)
      ) {
        throw new AppError(
          ERROR_CODES.HELP_AGENT_TASK_CLOSED,
          'This task has ended. Start a new one.',
          HttpStatus.CONFLICT,
        );
      }
      const step = await this.repo.reserveStep(tx, orgId, task.id, {
        maxSteps: this.env.HELP_AGENT_MAX_STEPS,
        maxTokens: this.env.HELP_AGENT_TASK_TOKENS,
      });
      if (step === null) {
        throw new AppError(
          ERROR_CODES.HELP_AGENT_STEP_LIMIT,
          'This task used up its steps. Start a new one with a smaller request.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      return { taskDbId: task.id, step };
    });

    // 2. The key and the allowance. Nothing is spent yet, and a missing key is the platform's to fix.
    const resolved = await this.keys.resolve(orgId, provider);
    const model = this.env.HELP_AGENT_MODEL || resolved.model;
    if (resolved.key === null || resolved.source === 'none' || !model) {
      throw this.unavailable('The Help assistant is not set up yet. Ask the platform owner.');
    }
    if (resolved.source === 'admin') await this.meter.guard(orgId);

    // 3. The vendor.
    let result;
    try {
      result = await this.port.complete({
        provider,
        model,
        apiKey: resolved.key,
        messages: request.messages,
        tools: request.tools,
        toolChoice: request.toolChoice,
        maxTokens: await this.keys.capMaxTokens(provider, this.env.HELP_AGENT_STEP_MAX_TOKENS),
      });
    } catch (err) {
      const status = err instanceof HelpAgentLlmError ? err.status : 0;
      this.logger.warn(
        { taskId, orgId, step: reserved.step, vendorStatus: status },
        '[help-agent] the AI provider failed',
      );
      throw this.unavailable(
        'The AI provider did not answer. Try again in a moment.',
        HttpStatus.BAD_GATEWAY,
      );
    }

    // 4. The ledger and the task's own count, together.
    await this.db.tx(async (tx) => {
      await this.meter.record(
        orgId,
        {
          provider,
          model,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
          billedAgainst: resolved.source === 'workspace' ? 'workspace' : 'admin',
        },
        tx,
      );
      await this.repo.addTokens(tx, orgId, reserved.taskDbId, {
        prompt: result.promptTokens,
        completion: result.completionTokens,
      });
    });
    this.logger.log(
      {
        taskId,
        orgId,
        step: reserved.step,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
      },
      '[help-agent] step answered',
    );
    return result.completion;
  }

  private unavailable(
    message: string,
    status: HttpStatus = HttpStatus.SERVICE_UNAVAILABLE,
  ): AppError {
    return new AppError(ERROR_CODES.HELP_AGENT_PROVIDER_UNAVAILABLE, message, status);
  }
}
