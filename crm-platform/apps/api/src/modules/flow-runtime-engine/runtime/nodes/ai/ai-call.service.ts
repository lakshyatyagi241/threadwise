import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../../../../../infra/db/database.service';
import {
  FLOW_AI_PORT,
  type FlowAiPort,
} from '../../../../../infra/providers/flow-runtime-engine/flow-ai.port';
import { AiKeyResolver, AiTokenMeter } from '../../../../ai-keys-usage-admin';
import { GROUNDED_NOTE, KbRetrievalService } from '../../../../knowledge-base';
import { type FlowRef } from '../flow-refs';
import { agentSystemPrompt, extractionSuffix, providerOfModel } from './ai-rules';

export interface AiCallInput {
  orgId: number;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  temperature: number;
  /** An AI Training assistant whose knowledge base is added to the system prompt: its row id (an old flow) or its uuid (the editor). */
  assistantId?: number | FlowRef;
  /**
   * The step runs as that AI agent. `full`: its own model, instructions (with tone and language), reply length and temperature
   * replace the ones above (a custom setup only borrows the agent's knowledge). `model`: only its model and vendor, for a hidden
   * pass with a prompt of its own (no knowledge either). An agent that no longer exists gives `agentMissing` on the outcome and
   * the step's own settings are used.
   */
  agentUse?: 'full' | 'model';
  /** Structured-extraction mode: one JSON object, with these keys. */
  json?: boolean;
  fields?: readonly string[];
  /** The vendor is put in JSON mode but the prompt is left as the caller wrote it (the ordering parser has its own). */
  vendorJsonOnly?: boolean;
}

export type AiCallOutcome = (
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
    }
) & { agentMissing?: boolean };

function assistantRefOf(v: number | FlowRef | undefined): FlowRef | null {
  if (typeof v === 'number') return v > 0 ? { kind: 'id', id: v } : null;
  return v ?? null;
}

/** The knowledge base is cut to this many characters, as the website chatbot does. */
const KNOWLEDGE_BUDGET = 12_000;
/** Laravel validated `max_tokens` to 1..4000 and `temperature` to 0..2. */
const MAX_TOKENS = 4000;

interface Effective {
  model: string;
  provider: string;
  systemPrompt: string;
  maxTokens: number;
  temperature: number;
  agentMissing: boolean;
}

interface AgentRow {
  system_prompt: string | null;
  tone: string | null;
  language: string | null;
  ai_provider: string | null;
  ai_model: string | null;
  reply_max_tokens: number | string | null;
  temperature: number | string | null;
}

interface AgentProfile {
  systemPrompt: string | null;
  tone: string | null;
  language: string | null;
  provider: string;
  model: string;
  maxTokens: number | null;
  temperature: number | null;
}

/**
 * The flow AI node's one door to a model (TW-FLR-030, Reference's `POST /api/flow-node/ai-call`): picks the vendor from the model name,
 * forces JSON in extraction mode, adds what the attached assistant knows about the message (a few passages of its own knowledge base) to the system prompt, resolves the key (the
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
    private readonly retrieval: KbRetrievalService,
  ) {}

  async call(input: AiCallInput): Promise<AiCallOutcome> {
    const eff = await this.effective(input);
    const outcome = await this.complete(input, eff);
    return eff.agentMissing ? { ...outcome, agentMissing: true } : outcome;
  }

  /** What actually runs: the step's own settings, or the AI agent's when the step runs as one. */
  private async effective(input: AiCallInput): Promise<Effective> {
    const own: Effective = {
      model: input.model,
      provider: providerOfModel(input.model),
      systemPrompt: input.systemPrompt,
      maxTokens: input.maxTokens,
      temperature: input.temperature,
      agentMissing: false,
    };
    const ref = input.agentUse ? assistantRefOf(input.assistantId) : null;
    if (!ref) return own;
    const agent = await this.agentProfile(input.orgId, ref).catch((err: unknown) => {
      this.logger.warn({ err: String(err) }, '[FLR] AI agent lookup failed');
      return null;
    });
    if (!agent) return { ...own, agentMissing: true };
    const model = agent.model.trim() || input.model;
    const provider = agent.provider.trim() || providerOfModel(model);
    if (input.agentUse === 'model') return { ...own, model, provider };
    return {
      model,
      provider,
      systemPrompt: agentSystemPrompt(agent, input.systemPrompt, input.json === true),
      // Extraction needs the node's big JSON budget; a reply is as long as the agent allows.
      maxTokens: input.json === true ? input.maxTokens : (agent.maxTokens ?? input.maxTokens),
      temperature: agent.temperature ?? input.temperature,
      agentMissing: false,
    };
  }

  private async complete(input: AiCallInput, eff: Effective): Promise<AiCallOutcome> {
    const provider = eff.provider;
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

      let system = eff.systemPrompt;
      if (input.json) system += extractionSuffix(input.fields ?? []);
      const assistant = input.agentUse === 'model' ? null : assistantRefOf(input.assistantId);
      if (assistant) {
        const kb = await this.knowledge(input.orgId, assistant, input.userPrompt).catch(
          (err: unknown) => {
            this.logger.warn({ err: String(err) }, '[FLR] knowledge base lookup failed');
            return { text: '', grounded: false };
          },
        );
        if (kb.text !== '' || kb.grounded) {
          system += `\n\n--- Knowledge base ---\n${kb.text || '(no matching excerpts)'}\n--- End knowledge base ---`;
        }
        if (kb.grounded) system += `\n\n${GROUNDED_NOTE}`;
      }

      const requested = Math.min(MAX_TOKENS, Math.max(1, Math.trunc(eff.maxTokens) || 350));
      const result = await this.port.complete({
        provider,
        model: eff.model,
        apiKey: resolved.key,
        systemPrompt: system,
        userPrompt: input.userPrompt,
        maxTokens: await this.keys.capMaxTokens(provider, requested),
        temperature: Math.min(2, Math.max(0, eff.temperature)),
        json: input.json === true || input.vendorJsonOnly === true,
      });
      await this.meter
        .record(input.orgId, {
          provider,
          model: eff.model,
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

  /** The workspace's own AI agent by row id or uuid; null for another tenant's (or no) agent. */
  private async agentProfile(orgId: number, ref: FlowRef): Promise<AgentProfile | null> {
    const row = await this.db.txAs({ orgId, userId: null }, async (tx) => {
      const res = await tx.execute(
        ref.kind === 'id'
          ? sql`SELECT system_prompt, tone, language, ai_provider, ai_model, reply_max_tokens, temperature
                FROM ai_chat_assistants WHERE org_id = ${orgId} AND id = ${ref.id}`
          : sql`SELECT system_prompt, tone, language, ai_provider, ai_model, reply_max_tokens, temperature
                FROM ai_chat_assistants WHERE org_id = ${orgId} AND uuid = ${ref.uuid}::uuid`,
      );
      return res.rows[0] as unknown as AgentRow | undefined;
    });
    if (!row) return null;
    const num = (v: number | string | null): number | null =>
      v === null || !Number.isFinite(Number(v)) ? null : Number(v);
    return {
      systemPrompt: row.system_prompt,
      tone: row.tone,
      language: row.language,
      provider: row.ai_provider ?? '',
      model: row.ai_model ?? '',
      maxTokens: num(row.reply_max_tokens),
      temperature: num(row.temperature),
    };
  }

  /**
   * What the assistant reads for this message, as one text block: the few passages of ITS OWN knowledge base that match (`grounded`),
   * or its whole base when the search cannot run. Empty for another tenant's assistant.
   */
  private async knowledge(
    orgId: number,
    ref: FlowRef,
    message: string,
  ): Promise<{ text: string; grounded: boolean }> {
    // The workspace's own assistant by row id or uuid; another tenant's (or no) assistant has no row here, so no knowledge.
    const assistantId = await this.db.txAs({ orgId, userId: null }, async (tx) => {
      const own = await tx.execute(
        ref.kind === 'id'
          ? sql`SELECT id FROM ai_chat_assistants WHERE org_id = ${orgId} AND id = ${ref.id}`
          : sql`SELECT id FROM ai_chat_assistants WHERE org_id = ${orgId} AND uuid = ${ref.uuid}::uuid`,
      );
      return own.rows.length === 0 ? null : Number((own.rows[0] as { id: number | string }).id);
    });
    if (assistantId === null) return { text: '', grounded: false };
    const found = await this.retrieval.retrieve(orgId, assistantId, message);
    const parts: string[] = [];
    let budget = KNOWLEDGE_BUDGET;
    for (const p of found.passages) {
      const text = p.text.trim();
      if (text === '') continue;
      const chunk = `[${p.label}]\n${text}`;
      parts.push(chunk.slice(0, Math.max(500, budget)));
      budget -= chunk.length;
      if (budget <= 0) break;
    }
    return { text: parts.join('\n\n'), grounded: found.grounded };
  }
}
