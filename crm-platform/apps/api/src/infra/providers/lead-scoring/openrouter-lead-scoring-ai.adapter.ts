import { Injectable } from '@nestjs/common';
import {
  LeadScoringAiError,
  type LeadScoreCompletion,
  type LeadScoreRequest,
  type LeadScoringAiPort,
} from './lead-scoring-ai.port';

/** A score is a short JSON answer; a slow vendor is an outage, not a big job. */
const TIMEOUT_MS = 45_000;

const base = (): string =>
  (process.env.LEAD_SCORING_OPENROUTER_BASE_URL?.trim() || 'https://openrouter.ai/api/v1').replace(
    /\/+$/,
    '',
  );

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * OpenRouter `/chat/completions` with JSON output. `usage: { include: true }` makes OpenRouter report what the call cost in USD, which
 * is the figure the scoring log keeps. Every failure is a LeadScoringAiError; the vendor's body is never put in a message (it can echo
 * the request, and the request holds contact data).
 */
@Injectable()
export class OpenRouterLeadScoringAiAdapter implements LeadScoringAiPort {
  async complete(req: LeadScoreRequest): Promise<LeadScoreCompletion> {
    const json = (await this.post(req.apiKey, {
      model: req.model,
      max_tokens: req.maxTokens,
      temperature: 0,
      response_format: { type: 'json_object' },
      // Scoring needs a judgement, not a long chain of thought: keep a reasoning model cheap and quick.
      reasoning: { effort: 'low' },
      usage: { include: true },
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ],
    })) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
    };
    const cost = json.usage?.cost;
    return {
      text: json.choices?.[0]?.message?.content ?? '',
      promptTokens: num(json.usage?.prompt_tokens),
      completionTokens: num(json.usage?.completion_tokens),
      costUsd: typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? cost : null,
    };
  }

  private async post(apiKey: string, body: unknown): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(`${base()}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          'x-title': 'Threadwise lead scoring',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      const name = (err as { name?: string }).name;
      throw new LeadScoringAiError(
        name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'provider',
        'the AI provider could not be reached',
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw new LeadScoringAiError('auth', 'the AI provider refused the key');
    }
    if (res.status === 429) {
      throw new LeadScoringAiError('rate_limited', 'the AI provider is rate limiting');
    }
    if (!res.ok) throw new LeadScoringAiError('provider', `the AI provider answered ${res.status}`);
    try {
      return await res.json();
    } catch {
      throw new LeadScoringAiError('bad_response', 'the AI provider answer was not JSON');
    }
  }
}
