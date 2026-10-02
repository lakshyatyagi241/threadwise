import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AiChatPort, AiChatRequest } from './ai-chat.port';

/** The widget answers inside the visitor's open request, so a slow vendor must give up well before the browser does. */
const TIMEOUT_MS = 25_000;

interface Vendor {
  /** Environment variable holding the platform key. Workspace keys (BYOK) arrive with the AI admin domain. */
  keyEnv: string;
  /** Optional environment override of `baseUrl`: an OpenAI-compatible gateway, or a stub in tests. */
  baseEnv: string;
  baseUrl: string;
}

/** Vendors that speak the OpenAI chat-completions dialect. */
const OPENAI_COMPATIBLE: Record<string, Vendor> = {
  openai: {
    keyEnv: 'WGT_AI_OPENAI_API_KEY',
    baseEnv: 'WGT_AI_OPENAI_BASE_URL',
    baseUrl: 'https://api.openai.com/v1',
  },
  mistral: {
    keyEnv: 'WGT_AI_MISTRAL_API_KEY',
    baseEnv: 'WGT_AI_MISTRAL_BASE_URL',
    baseUrl: 'https://api.mistral.ai/v1',
  },
  deepseek: {
    keyEnv: 'WGT_AI_DEEPSEEK_API_KEY',
    baseEnv: 'WGT_AI_DEEPSEEK_BASE_URL',
    baseUrl: 'https://api.deepseek.com/v1',
  },
  groq: {
    keyEnv: 'WGT_AI_GROQ_API_KEY',
    baseEnv: 'WGT_AI_GROQ_BASE_URL',
    baseUrl: 'https://api.groq.com/openai/v1',
  },
};

/**
 * Calls the model vendor over HTTPS with a hard timeout. The keys come from the environment until the AI admin domain
 * exposes workspace and platform keys (see modules/chatbot-widget/_shims/README.md). A provider with no key returns null,
 * which WaDesk also treated as an empty reply.
 */
@Injectable()
export class HttpAiChatAdapter implements AiChatPort {
  private readonly logger = new Logger(HttpAiChatAdapter.name);

  constructor(private readonly config: ConfigService) {}

  async complete(req: AiChatRequest): Promise<string | null> {
    const provider = req.provider.trim().toLowerCase();
    if (provider === 'anthropic') return this.anthropic(req);
    if (provider === 'gemini' || provider === 'google') return this.gemini(req);
    const vendor = OPENAI_COMPATIBLE[provider];
    if (!vendor) {
      this.logger.warn({ provider }, '[WGT] no adapter for this AI provider');
      return null;
    }
    return this.openaiCompatible(req, vendor);
  }

  private env(name: string): string | null {
    const v = this.config.get<string>(name) ?? process.env[name];
    return v && v.trim() !== '' ? v.trim() : null;
  }

  private key(name: string): string | null {
    return this.env(name);
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

  private async openaiCompatible(req: AiChatRequest, vendor: Vendor): Promise<string | null> {
    const key = this.key(vendor.keyEnv);
    if (!key) return null;
    const base = (this.env(vendor.baseEnv) ?? vendor.baseUrl).replace(/\/+$/, '');
    const json = (await this.post(
      `${base}/chat/completions`,
      { authorization: `Bearer ${key}` },
      {
        model: req.model,
        max_tokens: req.maxTokens,
        temperature: req.temperature,
        messages: [
          { role: 'system', content: req.systemPrompt },
          { role: 'user', content: req.userPrompt },
        ],
      },
    )) as { choices?: Array<{ message?: { content?: string } }> };
    return json.choices?.[0]?.message?.content ?? null;
  }

  private async anthropic(req: AiChatRequest): Promise<string | null> {
    const key = this.key('WGT_AI_ANTHROPIC_API_KEY');
    if (!key) return null;
    const json = (await this.post(
      'https://api.anthropic.com/v1/messages',
      { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      {
        model: req.model,
        max_tokens: req.maxTokens,
        temperature: Math.min(1, req.temperature),
        system: req.systemPrompt,
        messages: [{ role: 'user', content: req.userPrompt }],
      },
    )) as { content?: Array<{ type?: string; text?: string }> };
    return json.content?.find((c) => c.type === 'text')?.text ?? null;
  }

  private async gemini(req: AiChatRequest): Promise<string | null> {
    const key = this.key('WGT_AI_GEMINI_API_KEY');
    if (!key) return null;
    const json = (await this.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(req.model)}:generateContent`,
      { 'x-goog-api-key': key },
      {
        systemInstruction: { parts: [{ text: req.systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: req.userPrompt }] }],
        generationConfig: { maxOutputTokens: req.maxTokens, temperature: req.temperature },
      },
    )) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    return json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') || null;
  }
}
