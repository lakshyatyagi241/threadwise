import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../../../../../infra/db/database.service';
import {
  FLOW_AI_PORT,
  type FlowAiPort,
} from '../../../../../infra/providers/flow-runtime-engine/flow-ai.port';
import { AiKeyResolver, AiTokenMeter } from '../../../../ai-keys-usage-admin';
import { extractionSuffix, providerOfModel } from './ai-rules';

export interface AiCallInput {
  orgId: number;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  temperature: number;
  /** An AI Training assistant whose knowledge base is added to the system prompt. */
  assistantId?: number;
  /** Structured-extraction mode: one JSON object, with these keys. */
  json?: boolean;
  fields?: readonly string[];
  /** The vendor is put in JSON mode but the prompt is left as the caller wrote it (the ordering parser has its own). */
  vendorJsonOnly?: boolean;
}

export type AiCallOutcome =
  | { ok: true; reply: string; provider: string }
  /**
   * `no_key`: neither the workspace nor the platform has an active key for the vendor. `limit_reached`: the workspace used its monthly
   * platform-key allowance. `provider_failed`: the vendor errored, timed out or returned nothing (Reference answered 502).
   */
  | {
      ok: false;
      error: 'no_key' | 'limit_reached' | 'provider_failed';
      provider: string;
      message: string;
    };

/** The knowledge base is cut to this many characters, as the website chatbot does. */
const KNOWLEDGE_BUDGET = 12_000;
/** Laravel validated `max_tokens` to 1..4000 and `temperature` to 0..2. */
const MAX_TOKENS = 4000;

interface SourceRow {
  label: string;
  kind: string;
  content: string | null;
  question: string | null;
  answer: string | null;
}

/**
 * The flow AI node's one door to a model (TW-FLR-030, Reference's `POST /api/flow-node/ai-call`): picks the vendor from the model name,
 * forces JSON in extraction mode, stitches the attached assistant's knowledge base into the system prompt, resolves the key (the
 * workspace's own, else the platform's), asks the monthly allowance before using the platform's key, calls the vendor behind the port,
 * and writes the token ledger. It never throws: every failure is an outcome, so a provider problem never crashes a step.
 */
@Injectable()
export class AiCallService {
  private readonly logger = new Logger(AiCallService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly keys: AiKeyResolver,
    private readonly meter: AiTokenMeter,
    @Inject(FLOW_AI_PORT) private readonly port: FlowAiPort,
  ) {}

  async call(input: AiCallInput): Promise<AiCallOutcome> {
    const provider = providerOfModel(input.model);
    try {
      const resolved = await this.keys.resolve(input.orgId, provider);
      if (resolved.key === null || resolved.source === 'none') {
        return {
          ok: false,
          error: 'no_key',
          provider,
          message: `No active AI key for ${provider}`,
        };
      }
      // Only tokens billed to the platform's key count against the cap.
      if (resolved.source === 'admin') {
        try {
          await this.meter.guard(input.orgId);
        } catch {
          return {
            ok: false,
            error: 'limit_reached',
            provider,
            message: 'The monthly AI token allowance is used up',
          };
        }
      }

      let system = input.systemPrompt;
      if (input.json) system += extractionSuffix(input.fields ?? []);
      if (input.assistantId && input.assistantId > 0) {
        const kb = await this.knowledge(input.orgId, input.assistantId).catch((err: unknown) => {
          this.logger.warn({ err: String(err) }, '[FLR] knowledge base lookup failed');
          return '';
        });
        if (kb !== '') system += `\n\n--- Knowledge base ---\n${kb}\n--- End knowledge base ---`;
      }

      const requested = Math.min(MAX_TOKENS, Math.max(1, Math.trunc(input.maxTokens) || 350));
      const result = await this.port.complete({
        provider,
        model: input.model,
        apiKey: resolved.key,
        systemPrompt: system,
        userPrompt: input.userPrompt,
        maxTokens: await this.keys.capMaxTokens(provider, requested),
        temperature: Math.min(2, Math.max(0, input.temperature)),
        json: input.json === true || input.vendorJsonOnly === true,
      });
      await this.meter
        .record(input.orgId, {
          provider,
          model: input.model,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
          billedAgainst: resolved.source,
        })
        .catch((err: unknown) =>
          this.logger.warn({ err: String(err) }, '[FLR] the AI token ledger write failed'),
        );
      if (result.text.trim() === '') {
        return {
          ok: false,
          error: 'provider_failed',
          provider,
          message: `The ${provider} model returned no content`,
        };
      }
      return { ok: true, reply: result.text, provider };
    } catch (err) {
      this.logger.warn({ provider, err: String(err) }, '[FLR] AI call failed');
      return { ok: false, error: 'provider_failed', provider, message: String(err) };
    }
  }

  /** The assistant's ready training sources (its own and the workspace-wide ones), as one text block. Empty for another tenant's assistant. */
  private async knowledge(orgId: number, assistantId: number): Promise<string> {
    const rows = await this.db.txAs({ orgId, userId: null }, async (tx) => {
      const own = await tx.execute(
        sql`SELECT 1 FROM ai_chat_assistants WHERE org_id = ${orgId} AND id = ${assistantId}`,
      );
      if (own.rows.length === 0) return [] as SourceRow[];
      const res = await tx.execute(sql`
        SELECT label, kind, content, question, answer FROM ai_training_sources
        WHERE org_id = ${orgId} AND status = 'ready' AND (assistant_id = ${assistantId} OR assistant_id IS NULL)
        ORDER BY id`);
      return res.rows as unknown as SourceRow[];
    });
    const parts: string[] = [];
    let budget = KNOWLEDGE_BUDGET;
    for (const s of rows) {
      const text = (
        s.kind === 'qa'
          ? `Q: ${(s.question ?? '').trim()}\nA: ${(s.answer ?? '').trim()}`
          : (s.content ?? '')
      ).trim();
      if (text === '') continue;
      const chunk = `[${s.label}]\n${text}`;
      parts.push(chunk.slice(0, Math.max(500, budget)));
      budget -= chunk.length;
      if (budget <= 0) break;
    }
    return parts.join('\n\n');
  }
}
