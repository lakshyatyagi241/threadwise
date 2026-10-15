import { Injectable } from '@nestjs/common';
import {
  CampaignAiImageRefusedError,
  type CampaignAiImagePort,
  type CampaignAiImageRequest,
  type CampaignAiImageResult,
} from './campaign-ai-image.port';

/** An image takes the vendor longer than text. */
const TIMEOUT_MS = 90_000;
/** What one picture may weigh: the marketing upload takes 20 MB, a generated PNG is far below it. */
const MAX_BYTES = 10 * 1024 * 1024;

/** Error codes OpenAI uses when its safety system declines a prompt. */
const REFUSAL_CODES = new Set(['content_policy_violation', 'moderation_blocked']);

/**
 * OpenAI's image generation over HTTPS with a hard timeout. The key is the caller's: this class never reads one from the environment.
 * The base URL can be set per deployment (`CAMP_AI_OPENAI_BASE_URL`, the one the text adapter reads) so tests and gateways stand in.
 * `gpt-image-1` always answers base64; the DALL-E models are asked for base64 too, so no address the vendor names is ever fetched.
 */
@Injectable()
export class HttpCampaignAiImageAdapter implements CampaignAiImagePort {
  async generate(req: CampaignAiImageRequest): Promise<CampaignAiImageResult> {
    const base = (
      process.env.CAMP_AI_OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1'
    ).replace(/\/+$/, '');
    const body: Record<string, unknown> = {
      model: req.model,
      prompt: req.prompt,
      n: 1,
      size: req.size,
    };
    if (req.model.toLowerCase().startsWith('dall-e')) body.response_format = 'b64_json';
    const res = await fetch(`${base}/images/generations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${req.apiKey}` },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as {
        error?: { code?: unknown; message?: unknown };
      } | null;
      const code = typeof err?.error?.code === 'string' ? err.error.code : '';
      if (REFUSAL_CODES.has(code)) {
        throw new CampaignAiImageRefusedError(
          typeof err?.error?.message === 'string' ? err.error.message : 'The prompt was refused.',
        );
      }
      throw new Error(`AI image provider answered ${res.status}`);
    }
    const json = (await res.json()) as { data?: Array<{ b64_json?: unknown }> };
    const b64 = json.data?.[0]?.b64_json;
    if (typeof b64 !== 'string' || b64 === '')
      throw new Error('AI image provider returned no image');
    const bytes = Buffer.from(b64, 'base64');
    if (bytes.length === 0 || bytes.length > MAX_BYTES)
      throw new Error('AI image provider returned an unusable image');
    return { bytes, mime: 'image/png' };
  }
}
