import { Injectable } from '@nestjs/common';
import type { CampaignAiPort, CampaignAiRequest, CampaignAiResult } from './campaign-ai.port';

/** Laravel gave the vendor call the request's own time; a vendor slower than this fails the builder's "Build with AI". */
const TIMEOUT_MS = 45_000;

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * Calls the model vendor over HTTPS with a hard timeout: OpenAI chat completions, Anthropic messages, Gemini generateContent (the
 * three vendors Reference's campaign builder offered). The key is the caller's: this class never reads one from the environment.
 * A base-URL environment variable per vendor lets tests and gateways stand in.
 */
@Injectable()
export class HttpCampaignAiAdapter implements CampaignAiPort {
  async complete(req: CampaignAiRequest): Promise<CampaignAiResult> {
    switch (req.provider.trim().toLowerCase()) {
      case 'openai':
        return this.openai(req);
      case 'anthropic':
        return this.anthropic(req);
      case 'gemini':
        return this.gemini(req);
      default:
        throw new Error(`no adapter for the AI provider ${req.provider}`);
    }
  }

  private async post(
    url: string,
    headers: Record<string, string>,
    body: unknown,
  ): Promise<unknown> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`AI provider answered ${res.status}`);
    return res.json();
  }

  private async openai(req: CampaignAiRequest): Promise<CampaignAiResult> {
    const base = (
      process.env.CAMP_AI_OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1'
    ).replace(/\/+$/, '');
    const json = (await this.post(
      `${base}/chat/completions`,
      { authorization: `Bearer ${req.apiKey}` },
      {
        model: req.model,
        max_tokens: req.maxTokens,
        temperature: req.temperature,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: req.systemPrompt },
          { role: 'user', content: req.userPrompt },
        ],
      },
    )) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    return {
      text: json.choices?.[0]?.message?.content ?? '',
      promptTokens: num(json.usage?.prompt_tokens),
      completionTokens: num(json.usage?.completion_tokens),
    };
  }

  private async anthropic(req: CampaignAiRequest): Promise<CampaignAiResult> {
    const base = (
      process.env.CAMP_AI_ANTHROPIC_BASE_URL?.trim() || 'https://api.anthropic.com'
    ).replace(/\/+$/, '');
    const json = (await this.post(
      `${base}/v1/messages`,
      { 'x-api-key': req.apiKey, 'anthropic-version': '2023-06-01' },
      {
        model: req.model,
        max_tokens: req.maxTokens,
        temperature: Math.min(1, req.temperature),
        system: req.systemPrompt,
        messages: [{ role: 'user', content: req.userPrompt }],
      },
    )) as {
      content?: Array<{ type?: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    return {
      text: json.content?.find((c) => c.type === 'text')?.text ?? '',
      promptTokens: num(json.usage?.input_tokens),
      completionTokens: num(json.usage?.output_tokens),
    };
  }

  private async gemini(req: CampaignAiRequest): Promise<CampaignAiResult> {
    const base = (
      process.env.CAMP_AI_GEMINI_BASE_URL?.trim() || 'https://generativelanguage.googleapis.com'
    ).replace(/\/+$/, '');
    const json = (await this.post(
      `${base}/v1beta/models/${encodeURIComponent(req.model)}:generateContent`,
      { 'x-goog-api-key': req.apiKey },
      {
        systemInstruction: { parts: [{ text: req.systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: req.userPrompt }] }],
        generationConfig: {
          maxOutputTokens: req.maxTokens,
          temperature: req.temperature,
          responseMimeType: 'application/json',
        },
      },
    )) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    return {
      text: json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '',
      promptTokens: num(json.usageMetadata?.promptTokenCount),
      completionTokens: num(json.usageMetadata?.candidatesTokenCount),
    };
  }
}
