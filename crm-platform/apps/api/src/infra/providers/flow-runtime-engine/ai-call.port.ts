/**
 * The AI voice call node's door to WhatsApp calling (WD-FLR-048): place a business-initiated call to the flow's contact, answered by an
 * AI voice assistant. WaDesk's `place-ai-call` endpoint resolved the workspace's WABA sender and its first live assistant, logged the
 * call and handed it to the call bridge. The calling domain owns all of that; the node only asks, with `key` as the idempotency key.
 */
export const AI_CALL = Symbol('AI_CALL');

export interface PlaceAiCallRequest {
  orgId: number;
  /** Digits only, at least 8. */
  to: string;
  /** null = the first active, live assistant. */
  assistantId: number | null;
  conversationId: number | null;
  /** Stable per step: a retried step must not ring twice. */
  key: string;
}

export type PlaceAiCallResult =
  | { ok: true; callId: string }
  /** WaDesk's reasons: `no_waba_sender`, `no_voice_assistant`, `bad_number`; or `calls_unavailable` when nothing can place calls. */
  | { ok: false; error: string };

export interface AiCallPort {
  place(request: PlaceAiCallRequest): Promise<PlaceAiCallResult>;
}

/** The default while the calling domain is not wired to flows: nothing can be placed, and the node says so in the run log. */
export class AiCallUnavailable implements AiCallPort {
  async place(): Promise<PlaceAiCallResult> {
    return { ok: false, error: 'calls_unavailable' };
  }
}
