/**
 * The one outbound edge of "Build with AI" on the campaign builder (WD-CAMP-002): a single completion against the vendor, with the
 * key the AI keys domain resolved for this workspace. The campaigns module is written against this interface, so a vendor is one adapter.
 */
export interface CampaignAiRequest {
  provider: string;
  model: string;
  apiKey: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  temperature: number;
}

export interface CampaignAiResult {
  /** The model's text; an empty string when the vendor returned nothing. */
  text: string;
  promptTokens: number;
  completionTokens: number;
}

export interface CampaignAiPort {
  /** Throws on a vendor error, a timeout or an unknown provider; the service turns that into CAMP_AI_PROVIDER_FAILED. */
  complete(req: CampaignAiRequest): Promise<CampaignAiResult>;
}

export const CAMPAIGN_AI_PORT = Symbol('CAMP_AI_PORT');
