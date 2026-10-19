/**
 * The outbound edge of "Build with AI"'s picture (an addition to the campaign builder): one image from a prompt, with the key the AI keys
 * domain resolved for this workspace. The campaigns module is written against this interface, so a vendor is one adapter.
 */
export interface CampaignAiImageRequest {
  provider: 'openai';
  model: string;
  apiKey: string;
  prompt: string;
  size: '1024x1024' | '1536x1024' | '1024x1536';
}

export interface CampaignAiImageResult {
  bytes: Buffer;
  mime: string;
}

/** The vendor's safety system refused the prompt (nothing was drawn, nothing was charged). */
export class CampaignAiImageRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CampaignAiImageRefusedError';
  }
}

export interface CampaignAiImagePort {
  /** Throws `CampaignAiImageRefusedError` for a refusal; any other error is a vendor failure. */
  generate(req: CampaignAiImageRequest): Promise<CampaignAiImageResult>;
}

export const CAMPAIGN_AI_IMAGE_PORT = Symbol('CAMP_AI_IMAGE_PORT');
