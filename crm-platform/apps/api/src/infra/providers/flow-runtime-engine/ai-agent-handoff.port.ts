/**
 * The Chatbot node's one outbound edge (WD-FLR-031): hand a conversation to a team-inbox AI agent. WaDesk assigned the agent to the
 * conversation and had it write the first reply (`respondIfAssigned`), after which the agent answered every inbound message.
 *
 * The AI agents domain (the `ai_agents` rows, their persona and knowledge, the reply loop) is not built in this repo yet, so the only
 * binding today is `UnavailableAiAgentHandoff`. The domain that builds it provides this token and the Chatbot node starts working with
 * no change here.
 */
export interface AiAgentHandoffRequest {
  orgId: number;
  /** The agent id as the flow stored it (the builder keeps whatever its picker held). */
  agentId: string;
  channelId: number | null;
  peerKey: string;
  conversationId: number | null;
}

export type AiAgentHandoffResult =
  | { ok: true; agentName: string; replied: boolean }
  /** `agent_not_found`: not an active agent of this workspace. `conversation_not_found`: the customer has no thread. `unavailable`: no AI agent engine is installed. */
  | { ok: false; error: 'agent_not_found' | 'conversation_not_found' | 'unavailable' };

export interface AiAgentHandoffPort {
  /** Never throws for a refusal; a thrown error is treated as a failed hand-off by the node. */
  handOff(req: AiAgentHandoffRequest): Promise<AiAgentHandoffResult>;
}

export const AI_AGENT_HANDOFF_PORT = Symbol('FLR_AI_AGENT_HANDOFF_PORT');

/** The binding while the AI agents domain does not exist: every hand-off is refused with `unavailable`. */
export class UnavailableAiAgentHandoff implements AiAgentHandoffPort {
  handOff(): Promise<AiAgentHandoffResult> {
    return Promise.resolve({ ok: false, error: 'unavailable' });
  }
}
