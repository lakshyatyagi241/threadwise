import { Injectable } from '@nestjs/common';
import type { FlowAiPort, FlowAiRequest } from './flow-ai.port';

const TIMEOUT_MS = 90_000;

/**
 * The vendor HTTP calls behind FlowAiPort: OpenAI chat completions, Anthropic messages, Gemini generateContent. Every call
 * has a timeout; a non-2xx answer is an error (never swallowed). Not exercised against the live vendors in this repo's
 * tests (no keys): the adapter is tested against a local fake server, see test/unit/flow-builder-editor/flow-ai-adapter.
 */
@Injectable()
export class HttpFlowAiAdapter implements FlowAiPort {
  /** Overridden in tests with a fake server; production uses the platform `fetch`. */
  fetchImpl: typeof fetch = fetch;

  async generate(req: FlowAiRequest): Promise<string | null> {
    switch (req.provider) {
      case 'openai':
        return this.openai(req);
      case 'anthropic':
        return this.anthropic(req);
      case 'gemini':
        return this.gemini(req);
    }
  }

  private async post(url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`provider answered HTTP ${res.status}`);
    return res.json();
  }

  private async openai(r: FlowAiRequest): Promise<string | null> {
    const j = (await this.post(
      'https://api.openai.com/v1/chat/completions',
      { Authorization: `Bearer ${r.apiKey}` },
      {
        model: r.model,
        temperature: r.temperature,
        max_tokens: r.maxTokens,
        ...(r.json ? { response_format: { type: 'json_object' } } : {}),
        messages: [
          { role: 'system', content: r.system },
          { role: 'user', content: r.prompt },
        ],
      },
    )) as { choices?: Array<{ message?: { content?: string } }> };
    return j.choices?.[0]?.message?.content ?? null;
  }

  private async anthropic(r: FlowAiRequest): Promise<string | null> {
    const j = (await this.post(
      'https://api.anthropic.com/v1/messages',
      { 'x-api-key': r.apiKey, 'anthropic-version': '2023-06-01' },
      {
        model: r.model,
        max_tokens: r.maxTokens,
        temperature: r.temperature,
        system: r.system,
        messages: [{ role: 'user', content: r.prompt }],
      },
    )) as { content?: Array<{ type?: string; text?: string }> };
    return j.content?.find((c) => c.type === 'text')?.text ?? null;
  }

  private async gemini(r: FlowAiRequest): Promise<string | null> {
    const j = (await this.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(r.model)}:generateContent`,
      { 'x-goog-api-key': r.apiKey },
      {
        systemInstruction: { parts: [{ text: r.system }] },
        contents: [{ role: 'user', parts: [{ text: r.prompt }] }],
        generationConfig: {
          temperature: r.temperature,
          maxOutputTokens: r.maxTokens,
          ...(r.json ? { responseMimeType: 'application/json' } : {}),
        },
      },
    )) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    return j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') || null;
  }
}
