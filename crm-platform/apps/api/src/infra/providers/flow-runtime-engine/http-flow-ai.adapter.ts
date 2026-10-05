import { Injectable } from '@nestjs/common';
import type { FlowAiPort, FlowAiRequest, FlowAiResult } from './flow-ai.port';

/** Reference's Node executor gave the Laravel endpoint 30 seconds; a vendor slower than that fails the node's turn. */
const TIMEOUT_MS = 30_000;

/** Vendors that speak the OpenAI chat-completions dialect, with the environment variable that overrides the base URL (tests, gateways). */
const OPENAI_COMPATIBLE: Record<string, { baseEnv: string; baseUrl: string }> = {
  openai: { baseEnv: 'FLR_AI_OPENAI_BASE_URL', baseUrl: 'https://api.openai.com/v1' },
  mistral: { baseEnv: 'FLR_AI_MISTRAL_BASE_URL', baseUrl: 'https://api.mistral.ai/v1' },
  deepseek: { baseEnv: 'FLR_AI_DEEPSEEK_BASE_URL', baseUrl: 'https://api.deepseek.com/v1' },
  groq: { baseEnv: 'FLR_AI_GROQ_BASE_URL', baseUrl: 'https://api.groq.com/openai/v1' },
};

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Calls the model vendor over HTTPS with a hard timeout. The key is the caller's: this class never reads one from the environment. */
@Injectable()
export class HttpFlowAiAdapter implements FlowAiPort {
  async complete(req: FlowAiRequest): Promise<FlowAiResult> {
    const provider = req.provider.trim().toLowerCase();
    if (provider === 'anthropic') return this.anthropic(req);
    if (provider === 'gemini' || provider === 'google') return this.gemini(req);
    const vendor = OPENAI_COMPATIBLE[provider];
    if (!vendor) throw new Error(`no adapter for the AI provider ${provider}`);
    return this.openaiCompatible(req, vendor);
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

  private async openaiCompatible(
    req: FlowAiRequest,
    vendor: { baseEnv: string; baseUrl: string },
  ): Promise<FlowAiResult> {
    const base = (process.env[vendor.baseEnv]?.trim() || vendor.baseUrl).replace(/\/+$/, '');
    const json = (await this.post(
      `${base}/chat/completions`,
      { authorization: `Bearer ${req.apiKey}` },
      {
        model: req.model,
        max_tokens: req.maxTokens,
        temperature: req.temperature,
        ...(req.json ? { response_format: { type: 'json_object' } } : {}),
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

  private async anthropic(req: FlowAiRequest): Promise<FlowAiResult> {
    const base = (
      process.env.FLR_AI_ANTHROPIC_BASE_URL?.trim() || 'https://api.anthropic.com'
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

  private async gemini(req: FlowAiRequest): Promise<FlowAiResult> {
    const base = (
      process.env.FLR_AI_GEMINI_BASE_URL?.trim() || 'https://generativelanguage.googleapis.com'
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
          ...(req.json ? { responseMimeType: 'application/json' } : {}),
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
