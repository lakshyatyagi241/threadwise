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
}
