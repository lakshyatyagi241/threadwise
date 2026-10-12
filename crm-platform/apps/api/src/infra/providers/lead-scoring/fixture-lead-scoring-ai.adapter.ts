import { Injectable } from '@nestjs/common';
import type {
  LeadScoreCompletion,
  LeadScoreRequest,
  LeadScoringAiPort,
} from './lead-scoring-ai.port';

/**
 * An offline stand-in for the vendor, for the automated tests and the browser run (LEAD_SCORING_AI_DRIVER=fixture). The score is a
 * function of the prompt, so the same contact always gets the same number, and a prompt that mentions a won deal scores high.
 * It must never answer in production (the module refuses to boot with it there).
 */
@Injectable()
export class FixtureLeadScoringAiAdapter implements LeadScoringAiPort {
  /** Every request seen, newest last (a test asserts what was sent). */
  readonly requests: LeadScoreRequest[] = [];

  async complete(req: LeadScoreRequest): Promise<LeadScoreCompletion> {
    this.requests.push(req);
    if (req.system.includes('conversation reader')) return this.digest(req);
    let h = 0;
    for (const ch of req.user) h = (h * 31 + ch.charCodeAt(0)) % 41;
    const won = /"dealsWon":\s*[1-9]/.test(req.user);
    const score = Math.min(100, 30 + h + (won ? 25 : 0));
    const reasons = [won ? 'Has a won deal' : 'No won deals yet', 'Fixture scorer'];
    const text = JSON.stringify({ score, reasons });
    const promptTokens = Math.ceil((req.system.length + req.user.length) / 4);
    const completionTokens = Math.ceil(text.length / 4);
    return {
      text,
      promptTokens,
      completionTokens,
      costUsd: (promptTokens * 0.1 + completionTokens * 0.5) / 1_000_000,
    };
  }

  /**
   * The chat reading: the intent from the words in the contact's lines, the first stage the prompt offers when the contact wants to buy
   * or register, and the last line of the contact as evidence. Deterministic, so a test can say what it expects.
   */
  private digest(req: LeadScoreRequest): LeadScoreCompletion {
    const contactLines = [...req.user.matchAll(/\[(m\d+)\] C: (.*)/g)];
    const said = contactLines
      .map((m) => m[2]!)
      .join(' ')
      .toLowerCase();
    const intent = /\b(buy|purchase|order|book)\b/.test(said)
      ? 'ready_to_buy'
      : /\b(register|registration)\b/.test(said)
        ? 'registering'
        : /\b(price|cost|how much|rate)\b/.test(said)
          ? 'asking_price'
          : /\b(repair|warranty|service|battery)\b/.test(said)
            ? 'post_purchase'
            : 'other';
    const wants = intent === 'ready_to_buy' || intent === 'registering';
    const offered = [...req.user.matchAll(/^- (\S+) \| /gm)].map((m) => m[1]!);
    const evidence = contactLines.length ? [contactLines[contactLines.length - 1]![1]!] : [];
    const text = JSON.stringify({
      score: wants ? 78 : 45,
      reasons: [wants ? 'Says they want to buy or register' : 'No clear buying signal'],
      intent,
      signals: {
        askedPrice: intent === 'asking_price',
        readyToBuy: intent === 'ready_to_buy',
        objection: false,
        urgent: false,
      },
      summary: wants
        ? 'The contact is ready to move forward.'
        : 'The contact is asking general questions.',
      suggestedStage: wants && offered.length > 0 ? offered[0] : null,
      confidence: wants ? 0.82 : 0.2,
      evidence,
    });
    const promptTokens = Math.ceil((req.system.length + req.user.length) / 4);
    const completionTokens = Math.ceil(text.length / 4);
    return {
      text,
      promptTokens,
      completionTokens,
      costUsd: (promptTokens * 0.1 + completionTokens * 0.5) / 1_000_000,
    };
  }
}
