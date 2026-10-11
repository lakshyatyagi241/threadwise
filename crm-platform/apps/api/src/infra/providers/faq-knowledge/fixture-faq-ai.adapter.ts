import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  FaqAiError,
  type FaqAiPort,
  type FaqEmbedRequest,
  type FaqEmbedResult,
  type FaqSuggestRequest,
  type FaqSuggestResult,
} from './faq-ai.port';

const STOP = new Set([
  'a',
  'an',
  'the',
  'is',
  'are',
  'do',
  'does',
  'did',
  'i',
  'my',
  'me',
  'we',
  'you',
  'your',
  'to',
  'of',
  'in',
  'on',
  'for',
  'and',
  'or',
  'it',
  'this',
  'that',
  'can',
  'how',
  'what',
  'when',
  'where',
  'please',
  'have',
  'has',
  'be',
]);

/** Light stemming so "refunds", "refunded" and "refund" land on one dimension (a stand-in for what a real model learns). */
const stem = (w: string): string => w.replace(/(ing|ed|es|s)$/u, '');

/**
 * A deterministic stand-in for the vendor, used by the automated tests and by the Playwright run (FAQ_AI_DRIVER=fixture): texts that
 * share words land near each other, texts that share none do not, so the matcher's whole pipeline (scores, thresholds, margin, the
 * playground) is exercised with no network and no cost. It is not a language model and is never the production driver.
 *
 * Test hooks: an input containing `[[fail]]` makes the call throw a provider error; `[[slow]]` is not simulated.
 */
@Injectable()
export class FixtureFaqAiAdapter implements FaqAiPort {
  async embed(req: FaqEmbedRequest): Promise<FaqEmbedResult> {
    if (req.inputs.some((t) => t.includes('[[fail]]'))) {
      throw new FaqAiError('provider', 'fixture provider failure');
    }
    const vectors = req.inputs.map((t) => this.vector(t, req.dimensions));
    return { vectors, promptTokens: req.inputs.reduce((n, t) => n + Math.ceil(t.length / 4), 0) };
  }

  async complete(
    req: FaqSuggestRequest & { system: string; user: string },
  ): Promise<FaqSuggestResult> {
    const q = req.question.replace(/\?+$/, '');
    const all = [
      `${q} please`,
      `I need help: ${q.toLowerCase()}`,
      `Can you tell me about ${q.toLowerCase()}`,
      `${q} - quick question`,
      `Hi, ${q.toLowerCase()}?`,
      `Tell me ${q.toLowerCase()}`,
      `Question about ${q.toLowerCase()}`,
      `Need info on ${q.toLowerCase()}`,
      `${q}??`,
      `Help with ${q.toLowerCase()}`,
    ];
    const text = JSON.stringify({ variations: all.slice(0, req.count) });
    return { text, promptTokens: 40, completionTokens: 60 };
  }

  private vector(text: string, dims: number): number[] {
    const v = new Array<number>(dims).fill(0);
    const words = text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 1 && !STOP.has(w))
      .map(stem);
    for (const w of words) {
      const h = createHash('sha256').update(w).digest();
      // Three dimensions per word: a collision between two different words is then rare.
      for (let k = 0; k < 3; k++) v[h.readUInt16BE(k * 2) % dims] += 1;
    }
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    if (norm === 0) {
      v[0] = 1;
      return v;
    }
    return v.map((x) => x / norm);
  }
}
