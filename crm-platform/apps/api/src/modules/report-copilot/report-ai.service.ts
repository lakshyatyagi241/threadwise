import { Injectable, Logger } from '@nestjs/common';
import {
  ERROR_CODES,
  findAiProvider,
  type ReportCopilotStatus,
  type ReportScope,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { AiKeyResolver, AiTokenMeter } from '../ai-keys-usage-admin';
import { aiKeyMissing, aiProviderUnsupported } from './report-errors';
import {
  REPORT_PROVIDERS,
  chooseKey,
  modelSpec,
  type KeyCandidate,
  type ReportProvider,
} from './report-rules';

/** Everything one assistant run needs from the key side, resolved before the run starts. */
export interface RunPlan {
  scope: ReportScope;
  /** The workspace the tokens are metered to; 0 on the platform, which has no ledger. */
  orgId: number;
  provider: ReportProvider;
  model: string;
  /** `provider/model` as the runtime reads it. */
  spec: string;
  apiKey: string;
  /** Which side pays: the workspace's own key or the platform's. */
  source: 'workspace' | 'admin';
  maxOutputTokens: number;
}

/** The output size the assistant asks for: a report is a long tool call, so it needs room; the platform's ceiling still caps it. */
const WANTED_OUTPUT_TOKENS = 8192;

export interface UsageRecord {
  promptTokens: number;
  completionTokens: number;
  model: string | null;
}

/**
 * Which vendor, model and key answer a report request, and the token ledger behind it. It reuses the AI keys domain end to end:
 *
 *  - a workspace: `AiKeyResolver.resolve` (the workspace's own key when its plan allows BYOK, else the platform's), then
 *    `AiTokenMeter.guard` before a platform key is used, and `AiTokenMeter.record` afterwards;
 *  - the platform screen: the active key in `admin_ai_keys` (`resolve(null, ...)` considers only the platform's keys). Operator spend
 *    belongs to no workspace, so there is no ledger row to write for it.
 *
 * No key is a 422 `REPORT_AI_KEY_MISSING` ("Add an AI key in Settings"), never a stack and never a call that falls back to a server
 * environment variable.
 */
@Injectable()
export class ReportAiService {
  private readonly logger = new Logger(ReportAiService.name);

  constructor(
    private readonly keys: AiKeyResolver,
    private readonly meter: AiTokenMeter,
  ) {}

  /** The plan for a run, or the problem that stops it. */
  async resolve(scope: ReportScope): Promise<RunPlan> {
    const ctx = RequestContextStore.require();
    const orgId = scope === 'workspace' ? ctx.orgId : 0;
    const candidates: KeyCandidate[] = [];
    for (const provider of REPORT_PROVIDERS) {
      const r = await this.keys.resolve(scope === 'workspace' ? orgId : null, provider);
      candidates.push({
        provider,
        source: r.source,
        model: r.model,
        key: r.key,
      });
    }
    const choice = chooseKey(candidates);
    if (!choice) {
      // Keys that exist only for vendors the assistant cannot drive get their own message in a workspace, where the resolver can list them.
      if (scope === 'workspace' && (await this.hasOnlyOtherVendors(orgId))) {
        throw aiProviderUnsupported();
      }
      throw aiKeyMissing(scope === 'workspace');
    }
    // Only tokens billed to the platform's key count against the monthly allowance (a workspace on its own key is not capped).
    if (scope === 'workspace' && choice.source === 'admin') await this.meter.guard(orgId);
    return {
      scope,
      orgId,
      provider: choice.provider,
      model: choice.model,
      spec: modelSpec(choice.provider, choice.model),
      apiKey: choice.key,
      source: choice.source,
      maxOutputTokens: await this.keys.capMaxTokens(choice.provider, WANTED_OUTPUT_TOKENS),
    };
  }

  /** The answer to "can the assistant answer now": the same resolution, reported instead of thrown. */
  async status(scope: ReportScope): Promise<ReportCopilotStatus> {
    try {
      const plan = await this.resolve(scope);
      return {
        ready: true,
        reason: null,
        provider: plan.provider,
        keySource: plan.source === 'workspace' ? 'workspace' : 'platform',
      };
    } catch (err) {
      if (err instanceof AppError) {
        const reason =
          err.code === ERROR_CODES.REPORT_AI_KEY_MISSING
            ? 'key_missing'
            : err.code === ERROR_CODES.REPORT_AI_PROVIDER_UNSUPPORTED
              ? 'provider_unsupported'
              : err.code === ERROR_CODES.PLAN_LIMIT_REACHED
                ? 'allowance_used'
                : null;
        if (reason) return { ready: false, reason, provider: null, keySource: null };
      }
      throw err;
    }
  }

  /**
   * Writes the ledger row for a finished run. Never throws: a ledger failure must not turn a delivered report into an error. Platform
   * runs are not metered (see the class comment).
   */
  async record(plan: RunPlan, usage: UsageRecord): Promise<void> {
    if (plan.scope !== 'workspace') return;
    try {
      await this.meter.record(plan.orgId, {
        provider: plan.provider,
        model: usage.model ?? plan.model,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        billedAgainst: plan.source,
      });
    } catch (err) {
      this.logger.warn(
        { err: String(err) },
        'the report assistant could not write the AI token ledger',
      );
    }
  }

  private async hasOnlyOtherVendors(orgId: number): Promise<boolean> {
    const { sources } = await this.keys.sourcesFor(orgId);
    // Voice vendors (speech) hold keys too; only a language-model vendor makes "unsupported" the right word.
    return [...sources.keys()].some((slug) => findAiProvider(slug)?.group === 'llm');
  }
}
