import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  FLB_AI_GENERATE_MAX_EDGES,
  FLB_AI_GENERATE_MAX_NODES,
  ERROR_CODES,
  flbNormalizeAiGraph,
  type FlbAiGenerateRequest,
  type FlbAiGenerateResponse,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { FLOW_AI_PORT, type FlowAiPort } from '../../infra/providers/flow-builder-editor/flow-ai.port';
import { CALL_SYSTEM_PROMPT, CHAT_SYSTEM_PROMPT, extractFlowJson } from './flow-ai-prompts';

type Raw = Record<string, unknown>;

/**
 * "Generate with AI" (TW-FLB-025): plain language to nodes and edges. Key resolution is the workspace's own key first, then
 * the platform's (the AIADM domain will own that resolver; this reads the two tables directly until it exists). The call
 * itself goes through FlowAiPort. Nothing is stored: the builder applies the returned graph to its canvas.
 *
 * Not done here (and not in Reference): metering the call as AI usage; running the call as a queued job.
 */
@Injectable()
export class FlowAiService {
  private readonly logger = new Logger(FlowAiService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly crypto: CryptoService,
    @Inject(FLOW_AI_PORT) private readonly ai: FlowAiPort,
  ) {}

  async generate(input: FlbAiGenerateRequest): Promise<FlbAiGenerateResponse> {
    const apiKey = await this.resolveKey(input.provider);
    if (!apiKey) {
      throw new AppError(
        ERROR_CODES.FLB_AI_NO_KEY,
        'Admin has not enabled this provider in /admin/api-keys. Pick another provider or contact your admin.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    let raw: string | null;
    try {
      raw = await this.ai.generate({
        provider: input.provider,
        model: input.model,
        apiKey,
        system: input.flowType === 'call' ? CALL_SYSTEM_PROMPT : CHAT_SYSTEM_PROMPT,
        prompt: input.prompt,
        // A full flow easily exceeds a few thousand tokens; a JSON object cut off mid-write cannot be parsed.
        maxTokens: 8000,
        temperature: 0.4,
        json: true,
      });
    } catch (err) {
      this.logger.warn(`flow generation failed: ${(err as Error).message}`);
      raw = null;
    }
    if (!raw) {
      throw new AppError(
        ERROR_CODES.FLB_AI_PROVIDER_FAILED,
        'AI provider returned no content — check API key + model id.',
        HttpStatus.BAD_GATEWAY,
      );
    }

    const flow = extractFlowJson(raw);
    if (!flow) {
      this.logger.warn(`bad JSON from model: ${raw.slice(0, 400)}`);
      throw new AppError(
        ERROR_CODES.FLB_AI_BAD_JSON,
        'Model output was not valid flow JSON. Try a clearer prompt.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ path: 'raw', message: raw.slice(0, 600) }],
      );
    }
    const graph = flbNormalizeAiGraph({
      flowNodes: flow.flowNodes.slice(0, FLB_AI_GENERATE_MAX_NODES),
      flowEdges: flow.flowEdges.slice(0, FLB_AI_GENERATE_MAX_EDGES),
    });
    return { flow: graph, model: input.model };
  }

  /** The workspace's own key first, then the platform's. Never returned to the browser. */
  private async resolveKey(provider: string): Promise<string | null> {
    const ctx = RequestContextStore.require();
    const own = await this.db.tx(async (tx) => {
      const res = await tx.execute(
        sql`SELECT api_key FROM ai_provider_keys WHERE org_id = ${ctx.orgId} AND provider = ${provider} AND is_active LIMIT 1`,
      );
      return ((res.rows[0] as Raw | undefined)?.api_key as string | null | undefined) ?? null;
    });
    if (own) return this.plain(own);
    const platform = await this.db.privileged(async (tx) => {
      const res = await tx.execute(
        sql`SELECT api_key FROM admin_ai_keys WHERE provider = ${provider} AND is_active LIMIT 1`,
      );
      return ((res.rows[0] as Raw | undefined)?.api_key as string | null | undefined) ?? null;
    });
    return platform ? this.plain(platform) : null;
  }

  /** Keys are stored encrypted by the AI domains; a value that does not decrypt is taken as stored in the clear. */
  private plain(stored: string): string {
    try {
      return this.crypto.decrypt(stored);
    } catch {
      return stored;
    }
  }
}
