import { Injectable } from '@nestjs/common';
import {
  FaqAiError,
  type FaqAiPort,
  type FaqEmbedRequest,
  type FaqEmbedResult,
  type FaqSuggestRequest,
  type FaqSuggestResult,
} from './faq-ai.port';

/** An embedding batch is a few hundred characters per text: a slow answer is an outage, not a big job. */
const TIMEOUT_MS = 25_000;
/** One request carries at most this many texts (the vendor's own cap is higher; this keeps a request small and retryable). */
export const EMBED_BATCH = 64;

const base = (): string =>
  (process.env.FAQ_OPENROUTER_BASE_URL?.trim() || 'https://openrouter.ai/api/v1').replace(
    /\/+$/,
    '',
  );

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * OpenRouter: one key reaches every model on the allow-list. Embeddings go to `/embeddings`, suggestions to `/chat/completions`.
 * Every failure is a FaqAiError whose `kind` the service maps to a customer-safe outcome; the vendor's body is never put in a message
 * (it can echo the request).
 */
@Injectable()
export class OpenRouterFaqAiAdapter implements FaqAiPort {
  async embed(req: FaqEmbedRequest): Promise<FaqEmbedResult> {
    const vectors: number[][] = [];
    let promptTokens = 0;
    for (let i = 0; i < req.inputs.length; i += EMBED_BATCH) {
      const batch = req.inputs.slice(i, i + EMBED_BATCH);
      const json = (await this.post('/embeddings', req.apiKey, {
        model: req.model,
        input: batch,
        encoding_format: 'float',
      })) as {
        data?: Array<{ index?: number; embedding?: unknown }>;
        usage?: { prompt_tokens?: number; total_tokens?: number };
      };
      const rows = json.data;
      if (!Array.isArray(rows) || rows.length !== batch.length) {
        throw new FaqAiError('bad_response', 'the embedding answer did not match the request');
      }
      const ordered = [...rows].sort((a, b) => num(a.index) - num(b.index));
      for (const r of ordered) {
        const v = r.embedding;
        if (!Array.isArray(v) || v.some((x) => typeof x !== 'number')) {
          throw new FaqAiError('bad_response', 'the embedding answer held no vector');
        }
        if (v.length !== req.dimensions) {
          throw new FaqAiError(
            'dimension_mismatch',
            `the model answered ${v.length} dimensions, the store needs ${req.dimensions}`,
          );
        }
        vectors.push(v as number[]);
      }
      promptTokens += num(json.usage?.prompt_tokens) || num(json.usage?.total_tokens);
    }
    return { vectors, promptTokens };
  }

  async complete(
    req: FaqSuggestRequest & { system: string; user: string },
  ): Promise<FaqSuggestResult> {
    const json = (await this.post('/chat/completions', req.apiKey, {
      model: req.model,
      max_tokens: 700,
      temperature: 0.8,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ],
    })) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    return {
      text: json.choices?.[0]?.message?.content ?? '',
      promptTokens: num(json.usage?.prompt_tokens),
      completionTokens: num(json.usage?.completion_tokens),
    };
  }

  private async post(path: string, apiKey: string, body: unknown): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(`${base()}${path}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          'x-title': 'WaDesk FAQ',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      const name = (err as { name?: string }).name;
      throw new FaqAiError(
        name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'provider',
        'the AI provider could not be reached',
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw new FaqAiError('auth', 'the AI provider refused the key');
    }
    if (res.status === 429)
      throw new FaqAiError('rate_limited', 'the AI provider is rate limiting');
    if (!res.ok) throw new FaqAiError('provider', `the AI provider answered ${res.status}`);
    try {
      return await res.json();
    } catch {
      throw new FaqAiError('bad_response', 'the AI provider answer was not JSON');
    }
  }
}
