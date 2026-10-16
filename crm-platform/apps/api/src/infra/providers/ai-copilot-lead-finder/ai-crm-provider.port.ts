/**
 * The AI CRM Copilot's one outbound edge to a model vendor (TW-AICRM-001, Reference's three `AiCrmCopilotService`
 * provider loops). Unlike `FlowAiPort` (one completion), this runs a full multi-step tool-calling turn: it executes
 * READ tools itself (via the caller's `executeReadTool`) and stops at the first WRITE tool call without running it
 * — confirm-before-act is enforced by returning `pendingWrite` rather than by the adapter deciding anything.
 */
export interface AiCrmToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface AiCrmToolCallResult {
  ok: boolean;
  summary: string;
  data: unknown;
  subjectType?: string | null;
  subjectId?: number | null;
}

export interface AiCrmHistoryTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface AiCrmTurnInput {
  apiKey: string;
  model: string;
  systemPrompt: string;
  history: readonly AiCrmHistoryTurn[];
  message: string;
  tools: readonly AiCrmToolDef[];
  isWriteTool: (name: string) => boolean;
  /** Runs a READ tool and returns its result; never called for a write tool. */
  executeReadTool: (name: string, args: Record<string, unknown>) => Promise<AiCrmToolCallResult>;
}

export interface AiCrmExecutedAction {
  tool: string;
  summary: string;
}

export interface AiCrmTurnOutcome {
  /** The model's final prose reply; empty when `pendingWrite` is set (the caller supplies the confirm prompt). */
  reply: string;
  actions: AiCrmExecutedAction[];
  pendingWrite: { tool: string; args: Record<string, unknown> } | null;
  promptTokens: number;
  completionTokens: number;
}

export interface AiCrmProviderPort {
  /** Throws on a vendor error, a timeout or an unknown provider. */
  runTurn(provider: string, input: AiCrmTurnInput): Promise<AiCrmTurnOutcome>;
}

export const AI_CRM_PROVIDER_PORT = Symbol('AICRM_PROVIDER_PORT');
