import { Inject, Injectable } from '@nestjs/common';
import { cleanVar } from '../../../graph/compile-graph';
import {
  AI_AGENT_HANDOFF_PORT,
  type AiAgentHandoffPort,
} from '../../../../../infra/providers/flow-runtime-engine/ai-agent-handoff.port';
import type {
  CustomDecision,
  InboundReply,
  NodeContext,
  NodeExecutor,
  NodeResult,
} from '../../types';
import { flbAiSetup } from '@crm/contracts';
import { firstFlowRef, type FlowRef } from '../flow-refs';
import { AiCallService } from './ai-call.service';
import {
  appendTurn,
  conversationPrompt,
  historyOf,
  replyVariables,
  transcriptExtractionPrompt,
  transcriptText,
  transcriptVariables,
  type ChatTurn,
} from './ai-rules';

/** Reference's reply when the model gave nothing. */
export const AI_FALLBACK_REPLY = "Sorry, I couldn't generate a reply right now. Please try again.";

interface AiConfig {
  model: string;
  systemPrompt: string;
  saveAs: string;
  temperature: number;
  extract: boolean;
  fields: string[];
  maxTokens: number;
  /** The attached AI Training assistant: a row id (`assistant_id`, an old flow) or a uuid (`assistant`, the editor); 0 = none. */
  assistantId: number | FlowRef;
  /** The step runs as the attached AI agent (its model, instructions, tone, length and temperature), not as a custom setup. */
  useAgent: boolean;
  conversational: boolean;
  exitKeyword: string;
  silent: boolean;
}

const rec = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const text = (v: unknown, fallback = ''): string => {
  const s = typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v);
  return s.trim() === '' ? fallback : s;
};

/** The node's fields: the compiler keeps the builder's raw `data` for node types it does not shape, so read it from there (or flat). */
const dataOf = (props: Record<string, unknown>): Record<string, unknown> => ({
  ...props,
  ...rec(props.data),
});

function aiConfig(props: Record<string, unknown>): AiConfig {
  const d = dataOf(props);
  const extract = d.extract === true;
  const fields = (Array.isArray(d.fields) ? d.fields : [])
    .map((f) => text(f).trim())
    .filter((f) => f !== '');
  return {
    model: text(d.model, 'gpt-4o-mini'),
    systemPrompt: text(d.prompt, 'You are a helpful assistant.'),
    saveAs: cleanVar(d.variable, 'reply'),
    temperature: typeof d.temperature === 'number' ? d.temperature : 0.7,
    extract,
    fields,
    // A conversation answers in plain language every turn and extracts once on exit, so only a one-shot node gets the big JSON budget.
    maxTokens:
      typeof d.maxTokens === 'number'
        ? d.maxTokens
        : extract && !(d.conversational === true || d.chat_mode === true)
          ? 4000
          : 350,
    assistantId: firstFlowRef(d.assistant_id, d.assistantId, d.assistant) ?? 0,
    // A step saved before the setup choice existed reads as a custom setup, so it keeps its own model and prompt.
    useAgent: flbAiSetup(d) === 'agent',
    conversational: d.conversational === true || d.chat_mode === true,
    exitKeyword: text(d.exit_keyword).trim(),
    silent: d.silent === true || d.noReply === true,
  };
}

/**
 * Node group `ai` (TW-FLR-030, 031): the AI (ChatGPT) node, the Chatbot hand-off and the Sub-flow node.
 *
 * AI node: one model turn per run of the node. The customer's last message (`user_message`) goes to the model with the node's prompt;
 * the reply goes to the customer (unless the node is silent) and into the variables (JSON replies are spread into `<var>.<field>`).
 * Conversation mode keeps the transcript in the wait and parks on the node: every later message comes back here for another turn
 * until the customer types the exit keyword, which leaves by the node's exit (after a hidden extraction pass over the transcript
 * when extraction is on). A provider failure never fails the step: the customer gets Reference's apology line and the flow goes on.
 */
@Injectable()
export class AiNodes implements NodeExecutor {
  readonly types: readonly string[] = ['ChatGPT', 'Chatbot', 'SubFlow'];

  constructor(
    private readonly ai: AiCallService,
    @Inject(AI_AGENT_HANDOFF_PORT) private readonly agents: AiAgentHandoffPort,
  ) {}

  async execute(ctx: NodeContext): Promise<NodeResult> {
    switch (ctx.node.type) {
      case 'ChatGPT':
        return this.aiNode(ctx);
      case 'Chatbot':
        return this.chatbot(ctx);
      default:
        return this.subflow(ctx);
    }
  }

  async onReply(ctx: NodeContext, reply: InboundReply): Promise<CustomDecision> {
    if (reply.kind === 'external') return { action: 'ignore' };
    const cfg = aiConfig(ctx.node.props);
    const message = reply.text;
    // The customer typed the exit keyword: leave by the node's exit (TW-FLR-030 rule 6).
    if (cfg.exitKeyword !== '' && message.trim().toLowerCase() === cfg.exitKeyword.toLowerCase()) {
      const setVars = await this.extractOnExit(ctx, cfg);
      return { action: 'route', port: 1, setVars };
    }
    const history = historyOf(ctx.run.wait?.data);
    const turn = await this.turn(ctx, cfg, message, history);
    if (turn.halt) return { action: 'ignore' };
    return {
      action: 'stay',
      setVars: { user_message: message, ...turn.vars },
      data: { history: turn.history },
    };
  }

  // --- AI node --------------------------------------------------------------------------------------------------------------

  private async aiNode(ctx: NodeContext): Promise<NodeResult> {
    const cfg = aiConfig(ctx.node.props);
    const userMessage = text(ctx.run.vars.user_message);
    const turn = await this.turn(ctx, cfg, userMessage, []);
    if (turn.halt) return { kind: 'halt', reason: turn.halt };
    Object.assign(ctx.run.vars, turn.vars);
    if (cfg.conversational && !cfg.silent) {
      return {
        kind: 'wait',
        wait: {
          nodeId: ctx.node.id,
          variable: 'user_message',
          kind: 'Custom',
          handler: 'ChatGPT',
          data: { history: turn.history },
        },
      };
    }
    return { kind: 'advance', port: 1 };
  }

  /** One turn: ask the model, send its answer, and work out the variables and the transcript. A halted send changes nothing. */
  private async turn(
    ctx: NodeContext,
    cfg: AiConfig,
    userMessage: string,
    history: ChatTurn[],
  ): Promise<{ halt: string | null; vars: Record<string, unknown>; history: ChatTurn[] }> {
    const prompt = cfg.conversational ? conversationPrompt(history, userMessage) : userMessage;
    const out = await this.ai.call({
      orgId: ctx.run.orgId,
      model: cfg.model,
      systemPrompt: cfg.systemPrompt,
      userPrompt: prompt,
      maxTokens: cfg.maxTokens,
      temperature: cfg.temperature,
      assistantId: cfg.assistantId,
      agentUse: cfg.useAgent ? 'full' : undefined,
      // Deviation from Reference's code, which forced JSON on every turn too and so sent the customer raw JSON: its own comments say
      // a conversation's turns are natural language and the fields are read from the transcript on exit.
      json: cfg.extract && !cfg.conversational,
      fields: cfg.fields,
    });
    let reply = AI_FALLBACK_REPLY;
    if (out.agentMissing) ctx.note('the AI agent no longer exists: the step used its own settings');
    if (out.ok) reply = out.reply;
    else ctx.note(`AI call failed (${out.error}): ${out.message}`);

    if (cfg.silent) {
      ctx.note('silent: extraction only, nothing sent');
    } else {
      const sent = await ctx.send({ kind: 'text', body: reply });
      if (!sent.ok) {
        if (sent.halt) return { halt: sent.error, vars: {}, history };
        ctx.note(`the reply could not be sent: ${sent.error}`);
      }
    }
    const vars = replyVariables(cfg.saveAs, reply);
    if (cfg.extract && !cfg.conversational && !out.ok)
      ctx.note('extraction is on but the model gave no JSON: no fields set');
    return {
      halt: null,
      vars,
      history:
        cfg.conversational && !cfg.silent ? appendTurn(history, userMessage, reply) : history,
    };
  }

  /** Conversation mode plus extraction: one hidden JSON pass over the whole transcript, so later nodes read `<var>.<field>`. */
  private async extractOnExit(ctx: NodeContext, cfg: AiConfig): Promise<Record<string, unknown>> {
    if (!cfg.extract || !cfg.conversational || cfg.fields.length === 0) return {};
    const history = historyOf(ctx.run.wait?.data);
    if (history.length === 0) {
      ctx.note('extract on exit: empty transcript, nothing to extract');
      return {};
    }
    const out = await this.ai.call({
      orgId: ctx.run.orgId,
      model: cfg.model,
      systemPrompt: transcriptExtractionPrompt(cfg.fields),
      userPrompt: `Conversation transcript:\n${transcriptText(history)}`,
      maxTokens: 4000,
      temperature: 0,
      assistantId: cfg.useAgent ? cfg.assistantId : 0,
      agentUse: cfg.useAgent ? 'model' : undefined,
      json: true,
      fields: cfg.fields,
    });
    if (!out.ok) {
      ctx.note(`extract on exit failed (${out.error})`);
      return {};
    }
    const vars = transcriptVariables(cfg.saveAs, out.reply);
    if (!vars) ctx.note('extract on exit: the reply was not a JSON object, no fields set');
    return vars ?? {};
  }

  // --- Chatbot and Sub-flow -------------------------------------------------------------------------------------------------

  /**
   * Chatbot (TW-FLR-031): with an agent id the conversation is handed to that AI agent and the run ends (`takeover`) so the agent
   * answers the next messages, as Reference does even when the hand-off fails. Without one the node is the old sub-flow node.
   * Deviation: while no AI agent engine exists (`unavailable`) the run is not ended, the node is passed, so the customer is not
   * left with a flow that stopped and nobody answering.
   */
  private async chatbot(ctx: NodeContext): Promise<NodeResult> {
    const d = dataOf(ctx.node.props);
    const agentId = text(d.agentId ?? d.botId).trim();
    if (agentId === '' || agentId === '0') return this.subflow(ctx);
    try {
      const r = await this.agents.handOff({
        orgId: ctx.run.orgId,
        agentId,
        channelId: ctx.run.channelId,
        peerKey: ctx.run.peerKey,
        conversationId: ctx.run.conversationId,
      });
      if (r.ok) {
        ctx.note(`handed over to AI agent ${r.agentName}${r.replied ? ' (first reply sent)' : ''}`);
      } else if (r.error === 'unavailable') {
        ctx.note('no AI agent engine is installed: the hand-off was skipped, the flow goes on');
        return { kind: 'advance', port: 1 };
      } else {
        ctx.note(`AI agent hand-off refused (${r.error}): the flow ends`);
      }
    } catch (err) {
      ctx.note(`AI agent hand-off failed: ${String(err)}`);
    }
    return { kind: 'end', reason: 'takeover' };
  }

  /** Sub-flow (TW-FLR-031): the engine swaps the graph; no id means the node is passed. */
  private async subflow(ctx: NodeContext): Promise<NodeResult> {
    const d = dataOf(ctx.node.props);
    const raw = text(d.selectedFlowId ?? d.flowId).trim();
    const n = Math.trunc(Number(raw));
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw);
    if (!uuid && !(Number.isFinite(n) && n > 0)) {
      ctx.note('no sub-flow chosen: moved on');
      return { kind: 'advance', port: 1 };
    }
    return { kind: 'subflow', flowId: uuid ? raw : n };
  }
}
